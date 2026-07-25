'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMeta } = require('../src/lib/preview');

test('buildMeta unfurls title, kicker, and absolute cover image', () => {
  const story = {
    name: 'The Lighthouse Summer',
    cards: [{ type: 'cover', title: 'The Lighthouse Summer', kicker: 'Three months on Wren Island',
      image: { h1: 1, h2: 2, label: 'x', url: '/api/images/AbCdEfGh1234' } }],
  };
  const m = buildMeta(story, 'https://book.example', 'https://book.example/b/XyZ');
  assert.match(m, /og:title" content="The Lighthouse Summer"/);
  assert.match(m, /og:description" content="Three months on Wren Island"/);
  assert.match(m, new RegExp('og:image" content="https://book.example/api/images/AbCdEfGh1234"'));
  assert.match(m, /summary_large_image/);
  assert.match(m, new RegExp('og:url" content="https://book.example/b/XyZ"'));
});

test('buildMeta escapes and degrades without a painted cover', () => {
  const m = buildMeta({ name: 'A "Quoted" <Tale>', cards: [{ type: 'cover' }] }, 'https://x.example', '');
  assert.match(m, /A &quot;Quoted&quot; &lt;Tale&gt;/);
  assert.doesNotMatch(m, /og:image/);
  assert.match(m, /twitter:card" content="summary"/);
  assert.equal(buildMeta(null, 'https://x.example', ''), '');
});
