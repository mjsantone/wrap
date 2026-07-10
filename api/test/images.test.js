'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const images = require('../src/lib/images');

const STORY = {
  name: 'The Lighthouse Summer',
  cards: [
    { type: 'cover', title: 'The Lighthouse Summer', image: { h1: 210, h2: 250, label: 'lighthouse at dusk' } },
    { type: 'prose', title: 'The Arrival', body: 'x', image: { h1: 195, h2: 220, label: 'ferry crossing' } },
    { type: 'gallery', items: [
      { title: 'The Light', image: { h1: 45, h2: 25, label: 'lamp room' } },
      { title: 'The Storm', image: { h1: 230, h2: 260, label: 'storm' } },
    ] },
    { type: 'map', title: 'WREN ISLAND', address: 'somewhere' },
  ],
};

test('listImageSlots enumerates card and gallery-item images in reading order', () => {
  const keys = images.listImageSlots(STORY).map((s) => s.key);
  assert.deepEqual(keys, ['0', '1', '2.0', '2.1']);
});

test('listImageSlots caps gallery items at what the compiler renders (5)', () => {
  const story = { cards: [{ type: 'gallery', items: Array.from({ length: 6 }, () => ({ image: { h1: 1 } })) }] };
  assert.equal(images.listImageSlots(story).length, 5);
});

test('findSlot resolves keys and rejects junk', () => {
  assert.equal(images.findSlot(STORY, '0').card.type, 'cover');
  assert.equal(images.findSlot(STORY, '2.1').item.title, 'The Storm');
  assert.equal(images.findSlot(STORY, '3'), null);      // map has no image
  assert.equal(images.findSlot(STORY, '9'), null);
  assert.equal(images.findSlot(STORY, '2.9'), null);
  assert.equal(images.findSlot(STORY, '0/../x'), null);
  assert.equal(images.findSlot(STORY, ''), null);
});

test('patchPath builds the Cosmos partial-update path', () => {
  assert.equal(images.patchPath('1'), '/story/cards/1/image/url');
  assert.equal(images.patchPath('2.1'), '/story/cards/2/items/1/image/url');
  assert.equal(images.patchPath('nope'), null);
});

test('buildPrompt uses the slot label, book title, hue mood, and forbids text', () => {
  const p = images.buildPrompt(STORY, images.findSlot(STORY, '2.0'));
  assert.match(p, /lamp room/);
  assert.match(p, /The Lighthouse Summer/);
  assert.match(p, /an amber-leaning palette/); // h1 45 → amber
  assert.match(p, /No text/);
  assert.match(p, /2:3/);
});

test('providerConfig picks Azure over OpenAI, and null when neither', () => {
  const azure = images.providerConfig({
    AZURE_OPENAI_ENDPOINT: 'https://res.openai.azure.com/',
    AZURE_OPENAI_KEY: 'k',
    AZURE_OPENAI_IMAGE_DEPLOYMENT: 'img-deploy',
    OPENAI_API_KEY: 'also-set',
  });
  assert.equal(azure.name, 'azure');
  assert.equal(azure.url, 'https://res.openai.azure.com/openai/deployments/img-deploy/images/generations?api-version=2025-04-01-preview');
  assert.equal(azure.headers['api-key'], 'k');
  assert.equal(azure.model, null);

  const openai = images.providerConfig({ OPENAI_API_KEY: 'sk-x' });
  assert.equal(openai.name, 'openai');
  assert.equal(openai.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(openai.headers.Authorization, 'Bearer sk-x');
  assert.equal(openai.model, 'gpt-image-1');

  assert.equal(images.providerConfig({}), null);
});

test('requestBody: portrait webp, model only for the direct API', () => {
  const openai = images.providerConfig({ OPENAI_API_KEY: 'k' });
  const body = images.requestBody(openai, 'a scene', {});
  assert.equal(body.size, '1024x1536');
  assert.equal(body.output_format, 'webp');
  assert.equal(body.quality, 'medium');
  assert.equal(body.model, 'gpt-image-1');
  assert.equal(body.n, 1);

  const azure = images.providerConfig({ AZURE_OPENAI_ENDPOINT: 'https://r.x', AZURE_OPENAI_KEY: 'k' });
  assert.equal('model' in images.requestBody(azure, 'a scene', {}), false);
});

function fetchStub(status, payload) {
  return async (url, opts) => {
    fetchStub.last = { url, opts };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  };
}

test('generateImage sends the prompt and returns the base64 payload', async () => {
  const env = { OPENAI_API_KEY: 'sk-x' };
  const result = await images.generateImage('a lighthouse', {
    env,
    fetch: fetchStub(200, { data: [{ b64_json: 'aGVsbG8=' }] }),
  });
  assert.equal(result.data, 'aGVsbG8=');
  assert.equal(result.contentType, 'image/webp');
  const sent = JSON.parse(fetchStub.last.opts.body);
  assert.equal(sent.prompt, 'a lighthouse');
  assert.equal(sent.size, '1024x1536');
});

test('generateImage error mapping: not configured / 429 / content policy / empty', async () => {
  await assert.rejects(images.generateImage('x', { env: {} }), (e) => e.code === 'NOT_CONFIGURED');

  const env = { OPENAI_API_KEY: 'sk-x' };
  await assert.rejects(
    images.generateImage('x', { env, fetch: fetchStub(429, { error: { message: 'slow down' } }) }),
    (e) => e.code === 'RATE_LIMITED'
  );
  await assert.rejects(
    images.generateImage('x', { env, fetch: fetchStub(400, { error: { message: 'rejected by content policy', code: 'moderation_blocked' } }) }),
    (e) => e.code === 'REJECTED'
  );
  await assert.rejects(
    images.generateImage('x', { env, fetch: fetchStub(200, { data: [] }) }),
    (e) => e.code === 'UPSTREAM'
  );
});

test('generateImage maps an aborted request to TIMEOUT', async () => {
  const env = { OPENAI_API_KEY: 'sk-x' };
  await assert.rejects(
    images.generateImage('x', {
      env,
      fetch: async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; },
    }),
    (e) => e.code === 'TIMEOUT'
  );
});
