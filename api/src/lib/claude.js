'use strict';

/* Server-side story generation.
 *
 * Two funding paths, picked by environment:
 *   - Claude on Microsoft Foundry (bills Azure credits, beta):
 *       ANTHROPIC_FOUNDRY_RESOURCE + ANTHROPIC_FOUNDRY_API_KEY
 *   - Anthropic API direct:
 *       ANTHROPIC_API_KEY
 * Both clients expose the same messages.create surface, so the request —
 * structured outputs against the shared story schema, adaptive thinking —
 * is identical either way.
 *
 * Azure Static Web Apps managed functions cap responses at ~45 seconds,
 * so the request runs at a configurable effort (default "medium") and a
 * deadline below the platform cap; see GENERATION_* env vars. */

const STORY_SCHEMA = require('../contract/story-schema.json');
const SYSTEM_PROMPT = require('../contract/system-prompt.json').join('\n');

const MAX_STORY_CHARS = 2000; // matches the composer textarea's maxlength

let cachedClient = null;

function getClient() {
  if (cachedClient) return cachedClient;

  if (process.env.ANTHROPIC_FOUNDRY_RESOURCE && process.env.ANTHROPIC_FOUNDRY_API_KEY) {
    const AnthropicFoundry = require('@anthropic-ai/foundry-sdk');
    cachedClient = new AnthropicFoundry({
      resource: process.env.ANTHROPIC_FOUNDRY_RESOURCE,
      apiKey: process.env.ANTHROPIC_FOUNDRY_API_KEY,
    });
  } else if (process.env.ANTHROPIC_API_KEY) {
    const Anthropic = require('@anthropic-ai/sdk');
    cachedClient = new Anthropic();
  } else {
    const err = new Error('generation is not configured');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  return cachedClient;
}

/* For tests: inject a stub client. */
function setClient(client) {
  cachedClient = client;
}

async function generateStory(storyText, client) {
  client = client || getClient();

  const response = await client.messages.create(
    {
      model: process.env.GENERATION_MODEL || 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: process.env.GENERATION_EFFORT || 'medium',
        format: { type: 'json_schema', schema: STORY_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: 'Create a book for this story:\n\n' + storyText }],
    },
    // Abort below the SWA managed-functions cap so callers get a real
    // error message instead of a platform-severed connection.
    { timeout: Number(process.env.GENERATION_TIMEOUT_MS || 40000), maxRetries: 0 }
  );

  if (response.stop_reason === 'refusal') {
    const err = new Error('The model declined this request. Try rephrasing your story.');
    err.code = 'REFUSAL';
    throw err;
  }
  if (response.stop_reason === 'max_tokens') {
    const err = new Error('The story came out too long — try a shorter prompt.');
    err.code = 'TOO_LONG';
    throw err;
  }

  let text = '';
  for (const block of response.content || []) {
    if (block.type === 'text') text += block.text;
  }
  return JSON.parse(text);
}

module.exports = { generateStory, getClient, setClient, MAX_STORY_CHARS, STORY_SCHEMA, SYSTEM_PROMPT };
