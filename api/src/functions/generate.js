'use strict';

const { app } = require('@azure/functions');
const { generateStory, MAX_STORY_CHARS } = require('../lib/claude');

function json(status, body) {
  return { status, jsonBody: body };
}

/* Best-effort per-IP rate limit. Function instances are ephemeral, so this
 * is per-instance and resets on scale/recycle — a speed bump until accounts
 * exist (APIM tiers are the durable answer, per ARCHITECTURE.md). */
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.GENERATION_RATE_LIMIT || 10);
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const times = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= MAX_PER_WINDOW) return true;
  times.push(now);
  hits.set(ip, times);
  if (hits.size > 10000) hits.clear(); // crude memory bound
  return false;
}

/* POST /api/generate  { story: "free text" }  →  200 { story: {...} }
 * Turns a visitor's story text into the semantic story JSON via Claude.
 * The compiled layout stays client-side — the composer compiles and plays it. */
app.http('generate', {
  route: 'generate',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'request body must be JSON' });
    }

    const text = body && typeof body.story === 'string' ? body.story.trim() : '';
    if (!text) return json(400, { error: 'story text is required' });
    if (text.length > MAX_STORY_CHARS) {
      return json(400, { error: `story text is limited to ${MAX_STORY_CHARS} characters` });
    }

    const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    if (rateLimited(ip)) {
      return json(429, { error: 'Too many books for now — try again in a bit.' });
    }

    try {
      const story = await generateStory(text);
      context.log(`book generated cards=${(story.cards || []).length}`);
      return json(200, { story });
    } catch (err) {
      if (err.code === 'NOT_CONFIGURED') {
        return json(503, { error: 'NOT_CONFIGURED' });
      }
      if (err.code === 'REFUSAL' || err.code === 'TOO_LONG') {
        return json(422, { error: err.message });
      }
      if (err.name === 'APIConnectionTimeoutError' || err.status === 408) {
        return json(504, { error: 'Generation took too long — try a shorter or simpler story.' });
      }
      if (err.status === 429) {
        return json(429, { error: 'The model is busy — try again in a minute.' });
      }
      context.error('generation failed', err);
      /* Say *which* upstream failure this was — SWA managed functions have
       * no easily reachable logs, so the response is the debugging surface.
       * Each hint names the app setting to check. */
      const upstream = Number(err.status) || 0;
      let msg = 'Generation failed — try again.';
      if (upstream === 401 || upstream === 403) {
        msg = 'The model rejected our credentials — check the ANTHROPIC_FOUNDRY_API_KEY / ANTHROPIC_API_KEY app setting.';
      } else if (upstream === 404) {
        msg = 'The model deployment wasn’t found — the GENERATION_MODEL app setting (default claude-opus-4-8) must match your Foundry deployment name.';
      } else if (upstream === 400) {
        msg = 'The model rejected the request (HTTP 400). On Foundry this usually means the deployment is the “Hosted on Azure” model version, which doesn’t support structured outputs — redeploy the “Hosted on Anthropic” version.';
      } else if (upstream) {
        msg = 'The model returned HTTP ' + upstream + ' — try again.';
      } else if (err.name === 'APIConnectionError' || err.code === 'ENOTFOUND' || (err.cause && err.cause.code === 'ENOTFOUND')) {
        msg = 'Couldn’t reach the model endpoint — check the ANTHROPIC_FOUNDRY_RESOURCE app setting (it should be just the first label of your Foundry endpoint hostname).';
      }
      return json(502, { error: msg, detail: String(err.message || '').slice(0, 300) });
    }
  },
});
