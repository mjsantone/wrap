'use strict';

/* Image generation for stored books.
 *
 * The compiler emits an image *slot* per card (label + duotone hues); this
 * module fills slots with real photographs. Two funding paths, picked by
 * environment — the request/response shape is the same Images API either way:
 *   - Azure OpenAI (bills Azure credits, needs image-model quota):
 *       AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY
 *       (+ AZURE_OPENAI_IMAGE_DEPLOYMENT, default "gpt-image-1")
 *   - OpenAI direct (pay-per-image, works with any OpenAI key):
 *       OPENAI_API_KEY (+ OPENAI_IMAGE_MODEL, default "gpt-image-1")
 * Neither configured → NOT_CONFIGURED, and books keep their duotone
 * placeholders — there is no broken state.
 *
 * Fan-out is client-driven: the composer requests one image per HTTP call
 * (POST /api/books/{id}/images), because SWA managed functions support
 * neither Durable Functions nor multi-minute responses. One image per call
 * stays under the ~45s platform cap and makes progress observable. */

const IMAGE_SIZE = '1024x1536'; // 2:3 portrait, cover-cropped into the adaptive canvas

/* How many image slots one book exposes: every card image plus up to five
 * gallery items per gallery card — mirrors what the compiler renders. */
const MAX_GALLERY_IMAGES = 5;

function providerConfig(env) {
  env = env || process.env;
  if (env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_KEY) {
    return {
      name: 'azure',
      url:
        env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '') +
        '/openai/deployments/' +
        encodeURIComponent(env.AZURE_OPENAI_IMAGE_DEPLOYMENT || 'gpt-image-1') +
        '/images/generations?api-version=' +
        (env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview'),
      headers: { 'api-key': env.AZURE_OPENAI_KEY, 'Content-Type': 'application/json' },
      model: null, // the deployment name in the URL picks the model
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      name: 'openai',
      url: 'https://api.openai.com/v1/images/generations',
      headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      model: env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    };
  }
  return null;
}

function requestBody(cfg, prompt, env) {
  env = env || process.env;
  const body = {
    prompt,
    n: 1,
    size: IMAGE_SIZE,
    quality: env.IMAGE_QUALITY || 'medium',
    output_format: 'webp',
    output_compression: 80,
  };
  if (cfg.model) body.model = cfg.model;
  return body;
}

/* ---------- slots ---------- */

/* Slot keys address an image inside the story: "3" is card 3's image,
 * "2.1" is gallery card 2, item 1. Enumeration order is reading order. */
function listImageSlots(story) {
  const slots = [];
  ((story && story.cards) || []).forEach((c, i) => {
    if (!c || typeof c !== 'object') return;
    if (c.image) slots.push({ key: String(i), card: c, item: null });
    if (Array.isArray(c.items)) {
      c.items.slice(0, MAX_GALLERY_IMAGES).forEach((it, j) => {
        if (it && it.image) slots.push({ key: i + '.' + j, card: c, item: it });
      });
    }
  });
  return slots;
}

const SLOT_KEY = /^(\d{1,2})(?:\.(\d))?$/;

function findSlot(story, key) {
  const m = SLOT_KEY.exec(key || '');
  if (!m) return null;
  return listImageSlots(story).find((s) => s.key === m[0]) || null;
}

/* Cosmos partial-update path for a slot's url — patch is atomic per path,
 * so concurrent per-image requests can't clobber each other's writes. */
function patchPath(key) {
  const m = SLOT_KEY.exec(key || '');
  if (!m) return null;
  return m[2] == null
    ? '/story/cards/' + m[1] + '/image/url'
    : '/story/cards/' + m[1] + '/items/' + m[2] + '/image/url';
}

/* ---------- prompt ---------- */

function hueName(h) {
  h = ((Number(h) || 0) % 360 + 360) % 360;
  if (h < 20) return 'crimson';
  if (h < 50) return 'amber';
  if (h < 70) return 'golden';
  if (h < 160) return 'green';
  if (h < 200) return 'teal';
  if (h < 260) return 'blue';
  if (h < 300) return 'violet';
  if (h < 340) return 'magenta';
  return 'crimson';
}

function buildPrompt(story, slot) {
  const holder = slot.item || slot.card;
  const image = holder.image || {};
  const scene = image.label || holder.title || slot.card.title || story.name || '';
  const mood = hueName(image.h1);
  return (
    'An editorial photograph for a page of a small story book titled "' +
    (story.name || 'Untitled') + '". Scene: ' + scene + '. ' +
    'Vertical 2:3 composition, cinematic natural light, ' +
    (/^[aeiou]/.test(mood) ? 'an ' : 'a ') + mood +
    '-leaning palette, quiet and evocative, photographic realism. ' +
    'No text, no lettering, no borders, no watermarks.'
  );
}

/* ---------- generation ---------- */

/* deps (tests): { env, fetch }. Resolves { data: base64, contentType }. */
async function generateImage(prompt, deps) {
  const env = (deps && deps.env) || process.env;
  const cfg = providerConfig(env);
  if (!cfg) {
    const e = new Error('image generation is not configured');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  const doFetch = (deps && deps.fetch) || fetch;
  let res;
  try {
    res = await doFetch(cfg.url, {
      method: 'POST',
      headers: cfg.headers,
      body: JSON.stringify(requestBody(cfg, prompt, env)),
      signal: AbortSignal.timeout(Number(env.IMAGE_TIMEOUT_MS || 40000)),
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      const e = new Error('image generation timed out');
      e.code = 'TIMEOUT';
      throw e;
    }
    throw err;
  }
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch {}
    const msg = (body && body.error && body.error.message) || 'HTTP ' + res.status;
    const code = (body && body.error && body.error.code) || '';
    const e = new Error(msg);
    e.status = res.status;
    if (res.status === 429) e.code = 'RATE_LIMITED';
    else if (res.status === 400 && /safety|moderation|content.?(policy|filter)/i.test(msg + ' ' + code)) e.code = 'REJECTED';
    else e.code = 'UPSTREAM';
    throw e;
  }
  const data = await res.json();
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) {
    const e = new Error('image response had no data');
    e.code = 'UPSTREAM';
    throw e;
  }
  return { data: b64, contentType: 'image/webp' };
}

module.exports = {
  providerConfig,
  requestBody,
  listImageSlots,
  findSlot,
  patchPath,
  buildPrompt,
  hueName,
  generateImage,
  IMAGE_SIZE,
};
