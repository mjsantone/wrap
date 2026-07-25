'use strict';

/* Link previews for shared books: the OG/Twitter meta block injected into
 * the viewer shell when /b/{id} is served by the bpage Function, so a
 * pasted link unfurls as the book's cover and title. */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[c]));
}

function buildMeta(story, origin, url) {
  if (!story || typeof story !== 'object') return '';
  const cover = (Array.isArray(story.cards) && story.cards[0]) || {};
  const title = story.name || 'BOOK';
  const desc = cover.kicker || 'A little book to flip through.';
  const image = cover.image && cover.image.url && origin ? origin + cover.image.url : '';
  let out =
    '<meta property="og:type" content="article">\n' +
    '<meta property="og:site_name" content="BOOK">\n' +
    '<meta property="og:title" content="' + esc(title) + '">\n' +
    '<meta property="og:description" content="' + esc(desc) + '">\n';
  if (url) out += '<meta property="og:url" content="' + esc(url) + '">\n';
  if (image) {
    out +=
      '<meta property="og:image" content="' + esc(image) + '">\n' +
      '<meta name="twitter:card" content="summary_large_image">\n' +
      '<meta name="twitter:image" content="' + esc(image) + '">\n';
  } else {
    out += '<meta name="twitter:card" content="summary">\n';
  }
  out += '<meta name="twitter:title" content="' + esc(title) + '">\n';
  return out;
}

module.exports = { buildMeta, esc };
