'use strict';

const { app } = require('@azure/functions');
const { validateStory, newId, ID_PATTERN, MAX_BODY_BYTES } = require('../lib/story');
const { getContainer } = require('../lib/cosmos');
const { listImageSlots } = require('../lib/images');
const moderation = require('../lib/moderation');

function json(status, body) {
  return { status, jsonBody: body };
}

/* POST /api/books  { story: {...} }  →  201 { id }
 * Stores a validated story as an unlisted document. Share links are
 * /b/{id}; nothing is listed publicly (the gallery is a later phase). */
app.http('books-create', {
  route: 'books',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const len = Number(request.headers.get('content-length') || 0);
    if (len > MAX_BODY_BYTES * 2) return json(413, { error: 'payload too large' });

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'request body must be JSON' });
    }

    const result = validateStory(body && body.story);
    if (!result.ok) return json(400, { error: result.error });

    const doc = {
      id: newId(),
      formatVersion: 1,
      visibility: 'unlisted',
      story: result.story,
      createdAt: new Date().toISOString(),
    };
    await getContainer().items.create(doc);
    context.log(`book stored id=${doc.id} cards=${result.story.cards.length}`);
    /* imageSlots: which slots the composer may fan out image generation
     * for (POST /api/books/{id}/images) — see lib/images.js */
    return json(201, { id: doc.id, imageSlots: listImageSlots(result.story).map((s) => s.key) });
  },
});

/* GET /api/books/{id}  →  200 { id, formatVersion, story, createdAt } */
app.http('books-get', {
  route: 'books/{id}',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request) => {
    const id = request.params.id || '';
    if (!ID_PATTERN.test(id)) return json(400, { error: 'malformed book id' });

    try {
      const { resource } = await getContainer().item(id, id).read();
      /* kind marks non-book docs (stored images) sharing the container */
      if (!resource || resource.kind) return json(404, { error: 'book not found' });
      return json(200, {
        id: resource.id,
        formatVersion: resource.formatVersion,
        story: resource.story,
        createdAt: resource.createdAt,
      });
    } catch (err) {
      if (err && err.code === 404) return json(404, { error: 'book not found' });
      throw err;
    }
  },
});

/* POST /api/books/{id}/publish  →  200 { id, visibility: 'published' }
 * Promotes an unlisted book into the public gallery feed. Runs the
 * Content Safety gate when configured; a service failure refuses to
 * publish rather than failing open. Idempotent. */
app.http('books-publish', {
  route: 'books/{id}/publish',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const id = request.params.id || '';
    if (!ID_PATTERN.test(id)) return json(400, { error: 'malformed book id' });

    let resource;
    try {
      ({ resource } = await getContainer().item(id, id).read());
    } catch (err) {
      if (err && err.code === 404) return json(404, { error: 'book not found' });
      throw err;
    }
    if (!resource || resource.kind) return json(404, { error: 'book not found' });
    if (resource.visibility === 'published') {
      return json(200, { id, visibility: 'published' });
    }

    let verdict;
    try {
      verdict = await moderation.check(resource.story);
    } catch (err) {
      context.error('moderation failed', err);
      return json(502, { error: 'Couldn’t review this book right now — try again in a bit.' });
    }
    if (!verdict.allowed) {
      context.log(`publish rejected id=${id} category=${verdict.category} severity=${verdict.severity}`);
      return json(422, { error: 'This book can’t be published to the public gallery.' });
    }

    resource.visibility = 'published';
    resource.publishedAt = new Date().toISOString();
    resource.moderated = Boolean(verdict.moderated);
    await getContainer().item(id, id).replace(resource);
    context.log(`book published id=${id} moderated=${resource.moderated}`);
    return json(200, { id, visibility: 'published' });
  },
});
