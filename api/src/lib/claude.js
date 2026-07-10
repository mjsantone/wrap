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

/* The Foundry SDK wants the bare resource *name* — it builds
 * https://{name}.services.ai.azure.com itself. Accept whatever shape got
 * pasted from the portal (full endpoint URL, hostname, or the name) and
 * normalize to the first hostname label; a full URL passed through raw
 * yields an unresolvable host and an opaque "Connection error." */
function foundryResource(raw) {
  return String(raw).trim().replace(/^https?:\/\//i, '').split(/[/.]/)[0];
}

function getClient() {
  if (cachedClient) return cachedClient;

  if (process.env.ANTHROPIC_FOUNDRY_RESOURCE && process.env.ANTHROPIC_FOUNDRY_API_KEY) {
    const AnthropicFoundry = require('@anthropic-ai/foundry-sdk');
    cachedClient = new AnthropicFoundry({
      resource: foundryResource(process.env.ANTHROPIC_FOUNDRY_RESOURCE),
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

/* For tests: inject a stub client (and forget what the last deployment
 * said about structured-outputs support). */
function setClient(client) {
  cachedClient = client;
  schemaSupported = null;
}

/* Whether this deployment accepts structured outputs. Foundry's
 * "Hosted on Azure" model version rejects them (400, "structured_outputs
 * not supported in your workspace") — remembered per instance so every
 * generation after the first skips the failing attempt. */
let schemaSupported = null;

function buildRequest(storyText, useSchema) {
  const req = {
    model: process.env.GENERATION_MODEL || 'claude-opus-4-8',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: 'Create a book for this story:\n\n' + storyText }],
  };
  if (useSchema) {
    req.output_config = {
      effort: process.env.GENERATION_EFFORT || 'medium',
      format: { type: 'json_schema', schema: STORY_SCHEMA },
    };
  } else {
    /* Prompt-enforced fallback: no output_config at all (it's the same
     * API surface the workspace rejects). The caller validates the JSON. */
    req.system +=
      '\n\nReturn ONLY a single JSON object conforming to this JSON Schema — no prose, no markdown fences:\n' +
      JSON.stringify(STORY_SCHEMA);
  }
  return req;
}

function isSchemaUnsupported(err) {
  return err && err.status === 400 && /structured.?outputs?/i.test(err.message || '');
}

/* The fallback's text may wrap the JSON in fences or a stray sentence. */
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    const err = new Error('The model returned no usable story JSON — try again.');
    err.code = 'MALFORMED';
    throw err;
  }
  return text.slice(start, end + 1);
}

async function generateStory(storyText, client) {
  client = client || getClient();
  // Abort below the SWA managed-functions cap so callers get a real
  // error message instead of a platform-severed connection.
  const callOpts = { timeout: Number(process.env.GENERATION_TIMEOUT_MS || 40000), maxRetries: 0 };

  let useSchema = schemaSupported !== false;
  let response;
  try {
    response = await client.messages.create(buildRequest(storyText, useSchema), callOpts);
    if (useSchema) schemaSupported = true;
  } catch (err) {
    if (!useSchema || !isSchemaUnsupported(err)) throw err;
    schemaSupported = false;
    useSchema = false;
    response = await client.messages.create(buildRequest(storyText, false), callOpts);
  }

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
  if (!useSchema) text = extractJson(text);
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error('The model returned no usable story JSON — try again.');
    err.code = 'MALFORMED';
    throw err;
  }
}

module.exports = { generateStory, getClient, setClient, foundryResource, MAX_STORY_CHARS, STORY_SCHEMA, SYSTEM_PROMPT };
