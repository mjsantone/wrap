'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gate, storyText, isConfigured, check } = require('../src/lib/moderation');

const story = {
  name: 'The Lighthouse Summer',
  cards: [
    { type: 'cover', title: 'The Lighthouse Summer', kicker: 'Three months on Wren Island',
      image: { h1: 210, h2: 250, label: 'lighthouse at dusk' } },
    { type: 'quote', lines: ['The sea does not reward', 'the impatient.'], attribution: 'A. M. Lindbergh' },
    { type: 'gallery', items: [
      { kicker: 'Week One', title: 'The Light', body: 'Forty-two steps up.', image: { h1: 45, h2: 25, label: 'lamp room' } },
    ] },
  ],
};

test('storyText collects every human-readable field', () => {
  const text = storyText(story);
  for (const expected of [
    'The Lighthouse Summer', 'Three months on Wren Island', 'lighthouse at dusk',
    'The sea does not reward', 'A. M. Lindbergh', 'Week One', 'Forty-two steps up.', 'lamp room',
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
});

test('gate passes clean analyses and rejects at the severity threshold', () => {
  const clean = { categoriesAnalysis: [
    { category: 'Hate', severity: 0 }, { category: 'Violence', severity: 0 },
  ] };
  assert.deepEqual(gate(clean, 2), { allowed: true });

  const flagged = { categoriesAnalysis: [
    { category: 'Hate', severity: 0 }, { category: 'Violence', severity: 4 },
  ] };
  assert.deepEqual(gate(flagged, 2), { allowed: false, category: 'Violence', severity: 4 });

  // severity exactly at threshold rejects; below passes
  assert.equal(gate({ categoriesAnalysis: [{ category: 'Sexual', severity: 2 }] }, 2).allowed, false);
  assert.equal(gate({ categoriesAnalysis: [{ category: 'Sexual', severity: 1 }] }, 2).allowed, true);
  // malformed/empty analyses fail open at the gate level (service errors are handled upstream)
  assert.equal(gate({}, 2).allowed, true);
  assert.equal(gate(null, 2).allowed, true);
});

test('check allows unmoderated publish when Content Safety is not configured', async () => {
  const saved = {};
  for (const k of ['CONTENT_SAFETY_ENDPOINT', 'CONTENT_SAFETY_KEY']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    assert.equal(isConfigured(), false);
    assert.deepEqual(await check(story), { allowed: true, moderated: false });
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
});
