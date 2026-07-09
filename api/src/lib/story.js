'use strict';

/* Story validation for stored books.
 *
 * We persist the *semantic* story JSON (the same shape the composer's
 * STORY_SCHEMA enforces at generation time), not the compiled layout —
 * documents stay tiny and the viewer recompiles with the current layouts.
 * Because this API is an open write endpoint until accounts exist, the
 * validator rebuilds a clean copy field-by-field: unknown properties are
 * dropped, strings are length-capped, and anything structurally wrong
 * rejects the request. */

const crypto = require('crypto');

const CARD_TYPES = ['cover', 'quote', 'prose', 'gallery', 'product', 'video', 'map'];
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CARDS = 12;
const MAX_GALLERY_ITEMS = 6;
const MAX_QUOTE_LINES = 16;

const LIMITS = {
  name: 120,
  kicker: 120,
  title: 160,
  body: 1000,
  line: 200,
  attribution: 120,
  price: 40,
  button: 60,
  url: 500,
  address: 250,
  imageLabel: 120,
};

function str(v, max) {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}

function hue(v, fallback) {
  return Number.isInteger(v) ? ((v % 360) + 360) % 360 : fallback;
}

function cleanImage(img) {
  if (!img || typeof img !== 'object') return null;
  return {
    h1: hue(img.h1, 220),
    h2: hue(img.h2, 260),
    label: str(img.label, LIMITS.imageLabel) || '',
  };
}

function cleanCard(c, index) {
  if (!c || typeof c !== 'object') return { error: `card ${index} is not an object` };
  if (!CARD_TYPES.includes(c.type)) return { error: `card ${index} has unknown type ${JSON.stringify(c.type)}` };

  const card = {
    type: c.type,
    kicker: str(c.kicker, LIMITS.kicker),
    title: str(c.title, LIMITS.title),
    body: str(c.body, LIMITS.body),
    lines: null,
    attribution: str(c.attribution, LIMITS.attribution),
    price: str(c.price, LIMITS.price),
    button: str(c.button, LIMITS.button),
    url: str(c.url, LIMITS.url),
    address: str(c.address, LIMITS.address),
    image: cleanImage(c.image),
    items: null,
  };

  if (Array.isArray(c.lines)) {
    card.lines = c.lines
      .slice(0, MAX_QUOTE_LINES)
      .map((l) => str(l, LIMITS.line))
      .filter(Boolean);
  }

  if (Array.isArray(c.items)) {
    card.items = [];
    for (const it of c.items.slice(0, MAX_GALLERY_ITEMS)) {
      if (!it || typeof it !== 'object') continue;
      card.items.push({
        kicker: str(it.kicker, LIMITS.kicker),
        title: str(it.title, LIMITS.title),
        body: str(it.body, LIMITS.body),
        image: cleanImage(it.image),
      });
    }
  }

  return { card };
}

/* Returns { ok: true, story } with a freshly-built clean story,
 * or { ok: false, error } describing the first structural problem. */
function validateStory(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'story must be an object' };
  }
  const name = str(input.name, LIMITS.name);
  if (!name) return { ok: false, error: 'story.name must be a non-empty string' };
  if (!Array.isArray(input.cards) || input.cards.length === 0) {
    return { ok: false, error: 'story.cards must be a non-empty array' };
  }
  if (input.cards.length > MAX_CARDS) {
    return { ok: false, error: `story.cards is limited to ${MAX_CARDS} cards` };
  }

  const cards = [];
  for (let i = 0; i < input.cards.length; i++) {
    const { card, error } = cleanCard(input.cards[i], i);
    if (error) return { ok: false, error };
    cards.push(card);
  }

  const story = { name, cards };
  if (Buffer.byteLength(JSON.stringify(story), 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, error: `story exceeds ${MAX_BODY_BYTES} bytes` };
  }
  return { ok: true, story };
}

/* URL-safe share id. 12 chars of base58 ≈ 70 bits — unguessable enough
 * for unlisted links, short enough to read aloud. */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function newId() {
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

const ID_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{8,24}$/;

module.exports = { validateStory, newId, ID_PATTERN, MAX_BODY_BYTES, CARD_TYPES };
