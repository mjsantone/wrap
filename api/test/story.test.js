'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateStory, newId, ID_PATTERN } = require('../src/lib/story');

const goodStory = () => ({
  name: 'The Lighthouse Summer',
  cards: [
    { type: 'cover', title: 'The Lighthouse Summer', kicker: 'Three months on Wren Island',
      image: { h1: 210, h2: 250, label: 'lighthouse at dusk' } },
    { type: 'gallery', items: [
      { kicker: 'Week One', title: 'The Light', body: 'Forty-two steps up.', image: { h1: 45, h2: 25, label: 'lamp room' } },
    ] },
    { type: 'map', title: 'WREN ISLAND', address: 'Wren Island Lighthouse, WA' },
  ],
});

test('accepts a well-formed story and preserves content', () => {
  const r = validateStory(goodStory());
  assert.equal(r.ok, true);
  assert.equal(r.story.name, 'The Lighthouse Summer');
  assert.equal(r.story.cards.length, 3);
  assert.equal(r.story.cards[0].image.h1, 210);
  assert.equal(r.story.cards[1].items[0].title, 'The Light');
  assert.equal(r.story.cards[2].address, 'Wren Island Lighthouse, WA');
});

test('strips unknown fields instead of storing them', () => {
  const s = goodStory();
  s.injected = 'nope';
  s.cards[0].__proto__pollution = 'nope';
  s.cards[0].onclick = 'alert(1)';
  const r = validateStory(s);
  assert.equal(r.ok, true);
  assert.equal('injected' in r.story, false);
  assert.equal('onclick' in r.story.cards[0], false);
  assert.equal('__proto__pollution' in r.story.cards[0], false);
});

test('rejects non-objects, missing name, empty cards', () => {
  assert.equal(validateStory(null).ok, false);
  assert.equal(validateStory([]).ok, false);
  assert.equal(validateStory({ cards: [{ type: 'cover' }] }).ok, false);
  assert.equal(validateStory({ name: 'x', cards: [] }).ok, false);
});

test('rejects unknown card types with a useful message', () => {
  const r = validateStory({ name: 'x', cards: [{ type: 'iframe' }] });
  assert.equal(r.ok, false);
  assert.match(r.error, /card 0/);
  assert.match(r.error, /iframe/);
});

test('caps card count, gallery items, quote lines, and string lengths', () => {
  const many = { name: 'x', cards: Array.from({ length: 13 }, () => ({ type: 'prose', title: 't' })) };
  assert.equal(validateStory(many).ok, false);

  const r = validateStory({
    name: 'y'.repeat(500),
    cards: [
      { type: 'gallery', items: Array.from({ length: 20 }, () => ({ title: 't', body: 'b' })) },
      { type: 'quote', lines: Array.from({ length: 40 }, () => 'line') },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.story.name.length, 120);
  assert.equal(r.story.cards[0].items.length, 6);
  assert.equal(r.story.cards[1].lines.length, 16);
});

test('normalizes hues and tolerates junk images', () => {
  const r = validateStory({
    name: 'x',
    cards: [
      { type: 'prose', title: 't', image: { h1: -30, h2: 725, label: 42 } },
      { type: 'prose', title: 't', image: 'not-an-object' },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.story.cards[0].image.h1, 330);
  assert.equal(r.story.cards[0].image.h2, 5);
  assert.equal(r.story.cards[0].image.label, '');
  assert.equal(r.story.cards[1].image, null);
});

test('rejects oversized stories', () => {
  const r = validateStory({
    name: 'big',
    cards: Array.from({ length: 12 }, () => ({ type: 'prose', title: 't', body: 'b'.repeat(1000) })),
  });
  // 12 KB of body — fine. Now force it over 64 KB via many long gallery bodies.
  assert.equal(r.ok, true);
  const huge = {
    name: 'big',
    cards: Array.from({ length: 12 }, () => ({
      type: 'gallery',
      items: Array.from({ length: 6 }, () => ({ title: 't'.repeat(160), body: 'b'.repeat(1000) })),
    })),
  };
  assert.equal(validateStory(huge).ok, false);
});

test('newId produces distinct ids matching ID_PATTERN', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const id = newId();
    assert.match(id, ID_PATTERN);
    seen.add(id);
  }
  assert.equal(seen.size, 200);
});
