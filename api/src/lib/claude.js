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
 * said about structured-outputs / server-tools support). */
function setClient(client) {
  cachedClient = client;
  schemaSupported = null;
  toolsSupported = null;
}

/* Which optional API features this deployment accepts. Foundry's
 * "Hosted on Azure" model version rejects structured outputs (400,
 * "structured_outputs not supported in your workspace") and may reject
 * server-side tools the same way — each discovery is remembered per
 * instance so later generations skip the failing attempt. */
let schemaSupported = null;
let toolsSupported = null;

function buildRequest(storyText, useSchema, useTools) {
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
  if (useTools) {
    /* Server-side web search: grounds business/place stories in real
     * hours, addresses, and URLs (the system prompt says when to use it;
     * personal stories never trigger a search). max_uses bounds latency
     * and cost — searches bill per use. */
    req.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }];
  }
  return req;
}

function isSchemaUnsupported(err) {
  return err && err.status === 400 && /structured.?outputs?/i.test(err.message || '');
}

function isToolsUnsupported(err) {
  return err && err.status === 400 && /web.?search|server.?side.?tool|\btools?\b/i.test(err.message || '');
}

/* The fallback's text may wrap the JSON in fences or a stray sentence;
 * with web search, narration can precede the final JSON. */
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

/* Pull the story JSON out of a response. With search in play the content
 * mixes text with server_tool_use/result blocks — the final text block
 * carries the answer; concatenation covers multi-block JSON output. */
function storyJson(response) {
  const texts = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text);
  for (const candidate of [texts.join(''), texts[texts.length - 1] || '']) {
    try { return JSON.parse(candidate); } catch {}
    const inner = extractJson(candidate);
    if (inner) {
      try { return JSON.parse(inner); } catch {}
    }
  }
  const err = new Error('The model returned no usable story JSON — try again.');
  err.code = 'MALFORMED';
  throw err;
}

async function generateStory(storyText, client) {
  client = client || getClient();
  // Abort below the SWA managed-functions cap so callers get a real
  // error message instead of a platform-severed connection. The deadline
  // is shared across feature-fallback retries and pause_turn resumes.
  const deadline = Date.now() + Number(process.env.GENERATION_TIMEOUT_MS || 40000);
  const callOpts = () => ({ timeout: Math.max(1000, deadline - Date.now()), maxRetries: 0 });

  let useSchema = schemaSupported !== false;
  let useTools = process.env.GENERATION_WEB_SEARCH !== '0' && toolsSupported !== false;

  let response = null;
  for (let attempt = 0; attempt < 3 && !response; attempt++) {
    try {
      response = await client.messages.create(buildRequest(storyText, useSchema, useTools), callOpts());
      if (useSchema) schemaSupported = true;
      if (useTools) toolsSupported = true;
    } catch (err) {
      /* Downgrade one unsupported feature per attempt and try again —
       * order matters: the schema message also mentions "outputs". */
      if (useSchema && isSchemaUnsupported(err)) {
        schemaSupported = false;
        useSchema = false;
      } else if (useTools && isToolsUnsupported(err)) {
        toolsSupported = false;
        useTools = false;
      } else {
        throw err;
      }
    }
  }

  /* Server-side tools pause after enough iterations; resend with the
   * assistant turn appended and the server resumes where it left off. */
  let resumes = 0;
  while (response.stop_reason === 'pause_turn' && resumes < 3) {
    if (Date.now() > deadline - 3000) {
      const err = new Error('generation timed out');
      err.name = 'APIConnectionTimeoutError';
      throw err;
    }
    resumes += 1;
    const req = buildRequest(storyText, useSchema, useTools);
    req.messages = req.messages.concat([{ role: 'assistant', content: response.content }]);
    response = await client.messages.create(req, callOpts());
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

  return storyJson(response);
}

module.exports = { generateStory, getClient, setClient, foundryResource, MAX_STORY_CHARS, STORY_SCHEMA, SYSTEM_PROMPT };
