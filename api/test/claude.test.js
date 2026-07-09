'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { generateStory, setClient, STORY_SCHEMA, SYSTEM_PROMPT } = require('../src/lib/claude');

function stubClient(response, capture) {
  return {
    messages: {
      create: async (params, options) => {
        if (capture) { capture.params = params; capture.options = options; }
        return response;
      },
    },
  };
}

beforeEach(() => setClient(null));

test('sends the shared contract and parses the story', async () => {
  const capture = {};
  const story = { name: 'Test Book', cards: [{ type: 'cover', title: 'Test Book' }] };
  const client = stubClient(
    { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(story) }] },
    capture
  );

  const out = await generateStory('a story about a test', client);
  assert.deepEqual(out, story);
  assert.equal(capture.params.model, 'claude-opus-4-8');
  assert.deepEqual(capture.params.thinking, { type: 'adaptive' });
  assert.equal(capture.params.output_config.format.type, 'json_schema');
  assert.deepEqual(capture.params.output_config.format.schema, STORY_SCHEMA);
  assert.equal(capture.params.system, SYSTEM_PROMPT);
  assert.match(capture.params.messages[0].content, /a story about a test/);
  assert.equal(capture.options.maxRetries, 0);
  assert.ok(capture.options.timeout <= 45000, 'must stay under the SWA response cap');
});

test('concatenates multiple text blocks', async () => {
  const client = stubClient({
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: '{"name":"A",' },
      { type: 'text', text: '"cards":[]}' },
    ],
  });
  const out = await generateStory('x', client);
  assert.deepEqual(out, { name: 'A', cards: [] });
});

test('maps refusal and max_tokens to coded errors', async () => {
  await assert.rejects(
    generateStory('x', stubClient({ stop_reason: 'refusal', content: [] })),
    (e) => e.code === 'REFUSAL'
  );
  await assert.rejects(
    generateStory('x', stubClient({ stop_reason: 'max_tokens', content: [] })),
    (e) => e.code === 'TOO_LONG'
  );
});

test('throws NOT_CONFIGURED without keys or injected client', async () => {
  const saved = {};
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_FOUNDRY_RESOURCE', 'ANTHROPIC_FOUNDRY_API_KEY']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    await assert.rejects(generateStory('x'), (e) => e.code === 'NOT_CONFIGURED');
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
});

test('contract files are well-formed', () => {
  assert.equal(STORY_SCHEMA.type, 'object');
  assert.ok(STORY_SCHEMA.properties.cards.items.properties.type.enum.includes('cover'));
  assert.match(SYSTEM_PROMPT, /story designer for BOOK/);
  assert.match(SYSTEM_PROMPT, /exactly one cover/);
});
