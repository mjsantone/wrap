'use strict';

const { app } = require('@azure/functions');
const fs = require('fs');
const path = require('path');
const { getContainer } = require('../lib/cosmos');
const { buildMeta, esc } = require('../lib/preview');

/* GET /b/{id} (rewritten here by staticwebapp.config) — serves the viewer
 * shell with per-book OG tags injected so shared links unfurl with the
 * book's cover and title. Any failure degrades to the plain shell or a
 * redirect to the static viewer: previews are garnish, reading is not. */

const SHELL_PATH = path.join(__dirname, '..', '..', 'static', 'b.html');
let shellCache = null;
function shell() {
  if (!shellCache) shellCache = fs.readFileSync(SHELL_PATH, 'utf8');
  return shellCache;
}

app.http('bpage', {
  route: 'bpage',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const orig = request.headers.get('x-ms-original-url') || '';
    let id = '', origin = '', pageUrl = '';
    try {
      const u = new URL(orig);
      origin = u.origin;
      pageUrl = u.origin + u.pathname;
      const m = u.pathname.match(/\/b\/([1-9A-HJ-NP-Za-km-z]{8,24})/);
      id = m ? m[1] : '';
    } catch {}

    let html;
    try {
      html = shell();
    } catch (err) {
      context.error('bpage shell missing', err);
      return { status: 302, headers: { Location: '/b.html' + (id ? '?id=' + encodeURIComponent(id) : '') } };
    }

    let meta = '';
    let title = '';
    if (id) {
      try {
        const { resource } = await getContainer().item(id, id).read();
        if (resource && !resource.kind && resource.story) {
          meta = buildMeta(resource.story, origin, pageUrl);
          title = resource.story.name || '';
        }
      } catch (err) {
        context.log('bpage: preview skipped (' + ((err && err.code) || 'error') + ')');
      }
    }
    if (meta) {
      html = html.replace('<title>BOOK</title>', meta + '<title>' + esc(title ? title + ' — BOOK' : 'BOOK') + '</title>');
    }
    return {
      status: 200,
      body: html,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
    };
  },
});
