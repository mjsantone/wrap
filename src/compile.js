/* BookCompiler — semantic story cards → primitive layout nodes.
 * The generation contract lives here in one place: the JSON schema the model
 * must emit (STORY_SCHEMA), the prompt that teaches it the card types
 * (SYSTEM_PROMPT), the compiler that maps those cards onto the layouts
 * reverse-engineered from real wrap.co examples, and a schema-exercising SAMPLE.
 * Depends on BookRuntime (escapeHtml). */
(function (global) {
  'use strict';

  var escapeHtml = global.BookRuntime.escapeHtml;

  function fitFont(text, base, perChar) {
    var len = (text || '').length;
    if (len <= perChar) return base;
    return Math.max(30, Math.round(base * perChar / len));
  }
  function num(v, d) { var n = parseInt(v, 10); return isNaN(n) ? d : ((n % 360) + 360) % 360; }
  function img(css, image) {
    image = image || {};
    return { t: 'image', css: css, hue: [num(image.h1, 220), num(image.h2, 260)], lbl: image.label || '' };
  }
  function tb(text, css) { return { t: 'textbox', text: text, css: css }; }

  var MONT = "'Montserrat', sans-serif", SLAB = "'Josefin Slab', Georgia, serif", OPEN = "'Open Sans', sans-serif";
  var WHITE = 'rgba(253,254,255,1)';

  function center(top, size, family, opts) {
    opts = opts || {};
    return {
      position: 'absolute', top: top + 'px', left: (opts.left != null ? opts.left : 0) + 'px',
      width: (opts.width != null ? opts.width : 640) + 'px',
      'text-align': 'center', color: WHITE, 'font-family': family,
      'font-size': size + 'px', 'line-height': String(opts.lh || 1.1),
      'padding-top': '10px', 'padding-bottom': '10px', 'z-index': '10'
    };
  }
  var FULL = { position: 'absolute', top: '0px', left: '0px', width: '640px', height: '910px' };

  /* Card background for full-bleed image cards: a deep tone of the image's
   * primary hue, so the screen-fill area on tall phones blends with the
   * image instead of showing white bars. */
  function inkBg(image) {
    return 'hsl(' + num(image && image.h1, 220) + ', 30%, 10%)';
  }

  /* Layout constants below (30px cover inset, headline at y=590, gallery text at
   * 555/615/700, ...) are the geometry reverse-engineered from real wrap.co examples. */
  function compileCard(c) {
    var k = [];
    var t = c.type;
    var title = c.title || '', body = c.body || '', kicker = c.kicker || '';

    if (t === 'cover') {
      k.push(img({ position: 'absolute', top: '30px', left: '30px', width: '580px', height: '855px' }, c.image));
      k.push({ t: 'gradation', css: { position: 'absolute', top: '61px', left: '31px', width: '579px', height: '823px' } });
      var tsize = fitFont(title, 80, 12);
      k.push(tb(escapeHtml(title), center(590 + (80 - tsize), tsize, MONT, { left: 31, width: 580, lh: 1.02 })));
      if (kicker) k.push(tb(escapeHtml(kicker), center(700, fitFont(kicker, 40, 26), SLAB, { left: 30, width: 580 })));
      return { bg: '#fff', k: k };
    }
    if (t === 'quote') {
      k.push(img(FULL, c.image));
      k.push({ t: 'veil', css: FULL });
      k.push({ t: 'outline', css: FULL });
      var lines = (c.lines || []).map(escapeHtml);
      if (c.attribution) lines.push('<i>— ' + escapeHtml(c.attribution) + '</i>');
      var qtop = title ? 250 : 200;
      if (title) k.push(tb(escapeHtml(title), center(120, fitFont(title, 64, 14), MONT)));
      k.push(tb('<p>' + lines.join('<br>') + '</p>',
        center(qtop, lines.length > 10 ? 26 : 30, SLAB, { left: 80, width: 480, lh: 1.5 })));
      return { bg: inkBg(c.image), k: k };
    }
    if (t === 'prose') {
      k.push(img(FULL, c.image));
      k.push({ t: 'veil', css: FULL });
      k.push({ t: 'gradation', css: FULL });
      if (kicker) k.push(tb(escapeHtml(kicker), center(150, fitFont(kicker, 34, 26), SLAB)));
      k.push(tb(escapeHtml(title), center(kicker ? 215 : 170, fitFont(title, 60, 16), MONT, { left: 30, width: 580, lh: 1.05 })));
      k.push(tb(escapeHtml(body), center(kicker ? 360 : 320, body.length > 330 ? 26 : 30, SLAB, { left: 60, width: 520, lh: 1.45 })));
      return { bg: inkBg(c.image), k: k };
    }
    if (t === 'gallery') {
      var items = (c.items || []).slice(0, 5).map(function (it) {
        var ik = [];
        ik.push(img({ position: 'absolute', top: '10px', left: '10px', width: '620px', height: '890px' }, it.image));
        ik.push({ t: 'gradation', css: { position: 'absolute', top: '19px', left: '12px', width: '616px', height: '876px' } });
        if (it.kicker) ik.push(tb(escapeHtml(it.kicker), center(555, fitFont(it.kicker, 38, 26), SLAB, { left: 30, width: 580 })));
        var isize = fitFont(it.title || '', 60, 15);
        ik.push(tb(escapeHtml(it.title || ''), center(615 + (60 - isize), isize, MONT)));
        ik.push(tb(escapeHtml(it.body || ''), center(700, 26, SLAB, { left: 45, width: 550, lh: 1.35 })));
        return { k: ik };
      });
      return { bg: '#fff', k: [{ t: 'gallery', k: items }] };
    }
    if (t === 'product') {
      k.push(img(FULL, c.image));
      k.push({ t: 'gradation', css: FULL });
      if (kicker) k.push(tb(escapeHtml(kicker), center(540, fitFont(kicker, 34, 26), SLAB)));
      k.push(tb(escapeHtml(title), center(600, fitFont(title, 50, 18), MONT, { left: 30, width: 580 })));
      var pbody = escapeHtml(body) + (c.price ? ' <b>' + escapeHtml(c.price) + '</b>' : '');
      k.push(tb(pbody, center(680, 26, SLAB, { left: 60, width: 520, lh: 1.35 })));
      if (c.button) {
        k.push({ t: 'button', label: (c.button || '').toUpperCase(), css: {
          position: 'absolute', top: '800px', left: '100px', width: '440px', height: '68px',
          color: '#fff', border: '3px solid #fff', 'font-family': OPEN, 'font-size': '24px',
          'letter-spacing': '0.08em', 'z-index': '20'
        }});
        k.push({ t: 'action', url: c.url || '', css: { position: 'absolute', top: '796px', left: '97px', width: '446px', height: '76px' } });
      }
      return { bg: inkBg(c.image), k: k };
    }
    if (t === 'video') {
      k.push(img(FULL, c.image));
      k.push({ t: 'veil', css: FULL });
      k.push({ t: 'youtube', url: c.url || '', css: { position: 'absolute', top: '355px', left: '270px', width: '100px', height: '100px', 'z-index': '100' } });
      if (title) k.push(tb(escapeHtml(title), center(560, fitFont(title, 50, 18), MONT, { left: 30, width: 580 })));
      if (body) k.push(tb(escapeHtml(body), center(650, 26, SLAB, { left: 60, width: 520, lh: 1.35 })));
      return { bg: inkBg(c.image), k: k };
    }
    if (t === 'map') {
      k.push({ t: 'map', value: c.address || '', css: FULL });
      if (title) k.push(tb(escapeHtml(title), center(70, fitFont(title, 56, 16), MONT)));
      return { bg: '#161718', k: k };
    }
    return null;
  }

  function compileBook(story) {
    var out = { name: story.name || 'Untitled', cards: [] };
    (story.cards || []).forEach(function (c) {
      var compiled = compileCard(c || {});
      if (compiled) out.cards.push(compiled);
    });
    // end-of-book card, always appended
    out.cards.push({
      bg: '#2e2d2c',
      k: [{ t: 'end', css: { position: 'absolute', top: '215px', left: '0px', width: '640px', height: '480px' } }]
    });
    return out;
  }

  /* ---------- the generation contract ---------- */

  /* The generation contract is shared with the server API — single source in api/src/contract/. */
  var STORY_SCHEMA = /*@inline api/src/contract/story-schema.json*/;

  var SYSTEM_PROMPT = (/*@inline api/src/contract/system-prompt.json*/).join('\n');

  /* Built-in sample — exercises every layout without an API call */
  var SAMPLE = {
    name: 'The Lighthouse Summer',
    cards: [
      { type: 'cover', title: 'The Lighthouse Summer', kicker: 'Three months on Wren Island',
        image: { h1: 210, h2: 250, label: 'lighthouse at dusk' } },
      { type: 'prose', kicker: 'June', title: 'The Arrival',
        body: 'The ferry only runs twice a week, so when I stepped onto the dock with two suitcases and a typewriter, I knew there was no changing my mind. The keeper’s cottage smelled of salt and cedar.',
        image: { h1: 195, h2: 220, label: 'ferry crossing gray water' } },
      { type: 'gallery', items: [
        { kicker: 'Week One', title: 'The Light', body: 'Forty-two steps up. I counted them every night at eight, and every night the sea looked different.',
          image: { h1: 45, h2: 25, label: 'lamp room at golden hour' } },
        { kicker: 'Week Four', title: 'The Storm', body: 'Three days of wind that bent the grass flat. I read every book in the cottage twice.',
          image: { h1: 230, h2: 260, label: 'storm over the north cliffs' } },
        { kicker: 'Week Nine', title: 'The Whales', body: 'A pod of grays passed so close I could hear them breathe. I forgot to take a single photo.',
          image: { h1: 180, h2: 210, label: 'whale spouts offshore' } }
      ]},
      { type: 'quote',
        lines: ['The sea does not reward', 'those who are too anxious,', 'too greedy, or too impatient.', 'Patience, patience, patience,', 'is what the sea teaches.'],
        attribution: 'Anne Morrow Lindbergh',
        image: { h1: 250, h2: 290, label: 'night sea under stars' } },
      { type: 'map', title: 'WREN ISLAND', address: 'Wren Island Lighthouse, San Juan Islands, WA' }
    ]
  };

  global.BookCompiler = {
    compileBook: compileBook,
    STORY_SCHEMA: STORY_SCHEMA,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    SAMPLE: SAMPLE
  };
})(window);
