'use strict';

const { app } = require('@azure/functions');
const { getContainer } = require('../lib/cosmos');
const { newId, ID_PATTERN } = require('../lib/story');
const images = require('../lib/images');

function json(status, body) {
  return { status, jsonBody: body };
}

/* Best-effort per-IP limit, same shape as /api/generate's. Images cost real
 * money per call, so the ceiling is what a couple of full books need. */
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.IMAGE_RATE_LIMIT || 40);
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const times = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= MAX_PER_WINDOW) return true;
  times.push(now);
  hits.set(ip, times);
  if (hits.size > 10000) hits.clear();
  return false;
}

/* Cosmos docs top out at 2 MB; a webp at our compression is ~100–400 KB
 * base64, so this guard should never fire — it protects the book doc's
 * container from a provider surprise, not a normal path. */
const MAX_IMAGE_B64 = 1.4 * 1024 * 1024;

/* POST /api/books/{id}/images  { slot: "3" | "2.1" }  →  201 { slot, url }
 * Generates the photograph for one image slot of a stored book, saves it,
 * and writes the url into the book's story. One image per call — the
 * composer fans out client-side (see lib/images.js). Idempotent per slot. */
app.http('books-images', {
  route: 'books/{id}/images',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const id = request.params.id || '';
    if (!ID_PATTERN.test(id)) return json(400, { error: 'malformed book id' });

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'request body must be JSON' });
    }
    const key = body && typeof body.slot === 'string' ? body.slot : '';

    let resource;
    try {
      ({ resource } = await getContainer().item(id, id).read());
    } catch (err) {
      if (err && err.code === 404) return json(404, { error: 'book not found' });
      throw err;
    }
    if (!resource || resource.kind) return json(404, { error: 'book not found' });

    const slot = images.findSlot(resource.story, key);
    if (!slot) return json(400, { error: 'no such image slot' });

    const existing = (slot.item || slot.card).image.url;
    if (existing) return json(200, { slot: slot.key, url: existing });

    const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    if (rateLimited(ip)) {
      return json(429, { error: 'Too many pictures for now — try again in a bit.' });
    }

    let result;
    try {
      result = await images.generateImage(images.buildPrompt(resource.story, slot));
    } catch (err) {
      if (err.code === 'NOT_CONFIGURED') return json(503, { error: 'NOT_CONFIGURED' });
      if (err.code === 'REJECTED') return json(422, { error: 'This picture can’t be generated.' });
      if (err.code === 'TIMEOUT') return json(504, { error: 'The picture took too long — try again.' });
      if (err.code === 'RATE_LIMITED') return json(429, { error: 'The image model is busy — try again in a minute.' });
      context.error('image generation failed', err);
      return json(502, { error: 'Image generation failed — try again.' });
    }
    if (result.data.length > MAX_IMAGE_B64) {
      context.error(`image too large to store bytes=${result.data.length}`);
      return json(502, { error: 'Image generation failed — try again.' });
    }

    const imageId = newId();
    await getContainer().items.create({
      id: imageId,
      kind: 'image',
      bookId: id,
      slot: slot.key,
      contentType: result.contentType,
      data: result.data,
      createdAt: new Date().toISOString(),
    });

    const url = '/api/images/' + imageId;
    /* patch, not replace — concurrent slot requests each set only their path */
    await getContainer().item(id, id).patch([{ op: 'set', path: images.patchPath(slot.key), value: url }]);
    context.log(`image stored book=${id} slot=${slot.key} id=${imageId}`);
    return json(201, { slot: slot.key, url });
  },
});

/* GET /api/images/{id}  →  the image bytes, cacheable forever.
 * Images are immutable content — a slot regenerates under a fresh id. */
app.http('images-get', {
  route: 'images/{id}',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request) => {
    const id = request.params.id || '';
    if (!ID_PATTERN.test(id)) return json(400, { error: 'malformed image id' });

    let resource;
    try {
      ({ resource } = await getContainer().item(id, id).read());
    } catch (err) {
      if (err && err.code === 404) return json(404, { error: 'image not found' });
      throw err;
    }
    if (!resource || resource.kind !== 'image') return json(404, { error: 'image not found' });

    return {
      status: 200,
      body: Buffer.from(resource.data, 'base64'),
      headers: {
        'Content-Type': resource.contentType || 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    };
  },
});
