'use strict';

/* Moderation gate for publishing to the public gallery, backed by Azure AI
 * Content Safety when configured:
 *   CONTENT_SAFETY_ENDPOINT   e.g. https://<name>.cognitiveservices.azure.com
 *   CONTENT_SAFETY_KEY
 *   CONTENT_SAFETY_MAX_SEVERITY  reject at/above this severity (0-7, default 2)
 *
 * Unlisted share links skip this gate entirely — it guards only the
 * gallery feed. When Content Safety isn't configured, publishing is
 * allowed and the document records moderated: false. */

const MAX_SEVERITY = () => Number(process.env.CONTENT_SAFETY_MAX_SEVERITY || 2);

function isConfigured() {
  return Boolean(process.env.CONTENT_SAFETY_ENDPOINT && process.env.CONTENT_SAFETY_KEY);
}

/* Every human-readable string in a story, joined for one analyze call.
 * (Content Safety caps text at 10K chars; stories cap well under that.) */
function storyText(story) {
  const parts = [story.name];
  for (const card of story.cards || []) {
    parts.push(card.kicker, card.title, card.body, card.attribution, card.price, card.button, card.address);
    for (const line of card.lines || []) parts.push(line);
    if (card.image) parts.push(card.image.label);
    for (const item of card.items || []) {
      parts.push(item.kicker, item.title, item.body);
      if (item.image) parts.push(item.image.label);
    }
  }
  return parts.filter(Boolean).join('\n');
}

/* Decide from a Content Safety analyze response. Exported for tests. */
function gate(analysis, maxSeverity) {
  for (const entry of (analysis && analysis.categoriesAnalysis) || []) {
    if (entry.severity >= maxSeverity) {
      return { allowed: false, category: entry.category, severity: entry.severity };
    }
  }
  return { allowed: true };
}

/* Returns { allowed, moderated, category?, severity? }. Throws on service
 * failure — callers should refuse to publish rather than fail open. */
async function check(story) {
  if (!isConfigured()) return { allowed: true, moderated: false };

  const endpoint = process.env.CONTENT_SAFETY_ENDPOINT.replace(/\/$/, '');
  const res = await fetch(`${endpoint}/contentsafety/text:analyze?api-version=2024-09-01`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': process.env.CONTENT_SAFETY_KEY,
    },
    body: JSON.stringify({ text: storyText(story).slice(0, 10000) }),
  });
  if (!res.ok) {
    throw new Error(`content safety analyze failed: HTTP ${res.status}`);
  }
  const verdict = gate(await res.json(), MAX_SEVERITY());
  verdict.moderated = true;
  return verdict;
}

module.exports = { check, gate, storyText, isConfigured };
