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
  assert.match(SYSTEM_PROMPT, /Never invent facts/);
  assert.match(SYSTEM_PROMPT, /web search is available/);
  assert.match(SYSTEM_PROMPT, /brief a photographer/);
});

test('attaches the web search tool, bounded', async () => {
  const capture = {};
  const story = { name: 'T', cards: [{ type: 'cover', title: 'T' }] };
  const client = stubClient(
    { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(story) }] },
    capture
  );
  await generateStory('a bakery launch', client);
  assert.deepEqual(capture.params.tools, [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }]);
});

test('GENERATION_WEB_SEARCH=0 disables the search tool', async () => {
  process.env.GENERATION_WEB_SEARCH = '0';
  try {
    const capture = {};
    const client = stubClient(
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"name":"T","cards":[]}' }] },
      capture
    );
    await generateStory('x', client);
    assert.equal(capture.params.tools, undefined);
  } finally {
    delete process.env.GENERATION_WEB_SEARCH;
  }
});

test('falls back without tools when the workspace rejects them, and remembers', async () => {
  const story = { name: 'T', cards: [{ type: 'cover', title: 'T' }] };
  const calls = [];
  const client = {
    messages: {
      create: async (params) => {
        calls.push(params);
        if (params.tools) {
          const e = new Error('web_search not supported in your workspace.');
          e.status = 400;
          throw e;
        }
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(story) }] };
      },
    },
  };
  const out = await generateStory('x', client);
  assert.deepEqual(out, story);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].tools, undefined);
  assert.ok(calls[1].output_config, 'structured outputs kept — only tools dropped');

  await generateStory('y', client);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].tools, undefined);
});

test('downgrades both features when the workspace rejects each in turn', async () => {
  const story = { name: 'T', cards: [{ type: 'cover', title: 'T' }] };
  const calls = [];
  const client = {
    messages: {
      create: async (params) => {
        calls.push(params);
        if (params.output_config) {
          const e = new Error('structured_outputs not supported in your workspace.');
          e.status = 400;
          throw e;
        }
        if (params.tools) {
          const e = new Error('web_search not supported in your workspace.');
          e.status = 400;
          throw e;
        }
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(story) }] };
      },
    },
  };
  const out = await generateStory('x', client);
  assert.deepEqual(out, story);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].output_config, undefined);
  assert.equal(calls[2].tools, undefined);
});

test('resumes a pause_turn from server-side search and parses the final text', async () => {
  const story = { name: 'T', cards: [{ type: 'cover', title: 'T' }] };
  const calls = [];
  const paused = {
    stop_reason: 'pause_turn',
    content: [
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'bakery hours' } },
    ],
  };
  const client = {
    messages: {
      create: async (params) => {
        calls.push(params);
        if (calls.length === 1) return paused;
        return {
          stop_reason: 'end_turn',
          content: [
            { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [] },
            { type: 'text', text: 'Here is the book: ' },
            { type: 'text', text: JSON.stringify(story) },
          ],
        };
      },
    },
  };
  const out = await generateStory('a bakery launch', client);
  assert.deepEqual(out, story);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].messages.length, 2);
  assert.equal(calls[1].messages[1].role, 'assistant');
  assert.deepEqual(calls[1].messages[1].content, paused.content);
});

test('foundryResource normalizes any pasted shape to the resource name', () => {
  const { foundryResource } = require('../src/lib/claude');
  assert.equal(foundryResource('myproj'), 'myproj');
  assert.equal(foundryResource('myproj.services.ai.azure.com'), 'myproj');
  assert.equal(foundryResource('https://myproj.services.ai.azure.com'), 'myproj');
  assert.equal(foundryResource('https://myproj.services.ai.azure.com/api/projects/thing'), 'myproj');
  assert.equal(foundryResource(' https://myproj.cognitiveservices.azure.com/ '), 'myproj');
});
