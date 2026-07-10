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

/* Foundry's "Hosted on Azure" model version rejects structured outputs:
 * 400 "structured_outputs not supported in your workspace". */
function schemalessClient(story, calls) {
  return {
    messages: {
      create: async (params) => {
        calls.push(params);
        if (params.output_config) {
          const e = new Error('structured_outputs not supported in your workspace.');
          e.status = 400;
          throw e;
        }
        return {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Here is the book:\n```json\n' + JSON.stringify(story) + '\n```' }],
        };
      },
    },
  };
}

test('falls back to prompt-enforced JSON when structured outputs are unsupported', async () => {
  const story = { name: 'B', cards: [{ type: 'cover', title: 'B' }] };
  const calls = [];
  const client = schemalessClient(story, calls);

  const out = await generateStory('x', client);
  assert.deepEqual(out, story);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].output_config, undefined);
  assert.match(calls[1].system, /JSON Schema/);

  // the discovery is remembered — the next generation skips the failing attempt
  const out2 = await generateStory('y', client);
  assert.deepEqual(out2, story);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].output_config, undefined);
});

test('other 400s are not swallowed by the fallback', async () => {
  const client = {
    messages: {
      create: async () => {
        const e = new Error('max_tokens: value too large');
        e.status = 400;
        throw e;
      },
    },
  };
  await assert.rejects(generateStory('x', client), /max_tokens/);
});

test('fallback text without a JSON object maps to MALFORMED', async () => {
  const calls = [];
  const client = schemalessClient({}, calls);
  client.messages.create = async (params) => {
    calls.push(params);
    if (params.output_config) {
      const e = new Error('structured_outputs not supported in your workspace.');
      e.status = 400;
      throw e;
    }
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sorry, I cannot help with that.' }] };
  };
  await assert.rejects(generateStory('x', client), (e) => e.code === 'MALFORMED');
});

test('contract files are well-formed', () => {
  assert.equal(STORY_SCHEMA.type, 'object');
  assert.ok(STORY_SCHEMA.properties.cards.items.properties.type.enum.includes('cover'));
  assert.match(SYSTEM_PROMPT, /story designer for BOOK/);
  assert.match(SYSTEM_PROMPT, /exactly one cover/);
});

test('foundryResource normalizes any pasted shape to the resource name', () => {
  const { foundryResource } = require('../src/lib/claude');
  assert.equal(foundryResource('myproj'), 'myproj');
  assert.equal(foundryResource('myproj.services.ai.azure.com'), 'myproj');
  assert.equal(foundryResource('https://myproj.services.ai.azure.com'), 'myproj');
  assert.equal(foundryResource('https://myproj.services.ai.azure.com/api/projects/thing'), 'myproj');
  assert.equal(foundryResource(' https://myproj.cognitiveservices.azure.com/ '), 'myproj');
});
