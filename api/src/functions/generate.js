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
      return json(502, { error: 'Generation failed — try again.' });
    }
  },
});
