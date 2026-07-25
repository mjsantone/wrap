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
  /* slot is the image's address in the story ("3" = card 3, "2.1" =
   * gallery card 2 item 1) — how the API's image fan-out targets it.
   * image.url is set server-side once a photograph is generated. */
  function img(css, image, slot) {
    image = image || {};
    return {
      t: 'image', css: css, hue: [num(image.h1, 220), num(image.h2, 260)],
      lbl: image.label || '', url: image.url || '', slot: slot
    };
  }
  function tb(text, css) { return { t: 'textbox', text: text, css: css }; }

  /* Typographic punctuation: curly quotes, em dashes, real ellipses —
   * applied to every human-readable string before it reaches a page. */
  function smarten(s) {
    return String(s == null ? '' : s)
      .replace(/---?/g, '\u2014')
      .replace(/\.\.\./g, '\u2026')
      .replace(/(^|[\s([{\u2014"])'/g, '$1\u2018')
      .replace(/'/g, '\u2019')
      .replace(/(^|[\s([{\u2014])"/g, '$1\u201C')
      .replace(/"/g, '\u201D');
  }

  /* Editorial drop cap for left-set prose: the first letter, oversized. */
  function dropCap(text) {
    var m = /^([\u2018\u201C]?)([A-Za-z])([\s\S]*)$/.exec(text);
    if (!m) return escapeHtml(text);
    return escapeHtml(m[1]) + '<span class="dropcap">' + escapeHtml(m[2]) + '</span>' + escapeHtml(m[3]);
  }

  var MONT = "'Montserrat', sans-serif", SLAB = "'Josefin Slab', Georgia, serif", OPEN = "'Open Sans', sans-serif";
  var FRAUNCES = "'Fraunces', Georgia, serif";
  var WHITE = 'rgba(253,254,255,1)';

  /* ---------- the type ramp ----------
   * Every size on a page comes from this scale: Fraunces carries display
   * and titles, Montserrat small tracked caps carries labels, Josefin
   * Slab carries reading text. fitFont shrinks a step for long copy but
   * always starts from a ramp value. */
  var RAMP = {
    display: 76,  // cover title
    title: 54,    // card titles
    gtitle: 44,   // gallery item titles
    quote: 30,    // quote lines
    body: 27,     // prose body
    small: 24,    // gallery/video body
    kicker: 15,   // tracked caps labels
    caption: 13   // attributions, gallery kickers
  };

  function typo(top, size, family, opts) {
    opts = opts || {};
    var css = {
      position: 'absolute', top: top + 'px', left: (opts.left != null ? opts.left : 0) + 'px',
      width: (opts.width != null ? opts.width : 640) + 'px',
      'text-align': opts.align || 'center', color: WHITE, 'font-family': family,
      'font-size': size + 'px', 'line-height': String(opts.lh || 1.1),
      'padding-top': '10px', 'padding-bottom': '10px', 'z-index': '10'
    };
    if (opts.weight) css['font-weight'] = String(opts.weight);
    if (opts.ls) css['letter-spacing'] = opts.ls;
    if (opts.caps) css['text-transform'] = 'uppercase';
    /* modern text wrapping: balance kills one-word second lines on
     * titles; pretty kills widows in reading text (older browsers ignore) */
    if (opts.wrap) css['text-wrap'] = opts.wrap;
    return css;
  }
  function ext(a, b) {
    var o = {}, key;
    for (key in a) o[key] = a[key];
    for (key in b) o[key] = b[key];
    return o;
  }
  /* Card background for full-bleed image cards: a deep tone of the image's
   * primary hue, so the screen-fill area on tall phones blends with the
   * image instead of showing hard seams. */
  function inkBg(image) {
    return 'hsl(' + num(image && image.h1, 220) + ', 30%, 10%)';
  }

  /* ---------- the adaptive canvas + model art direction ----------
   * Layouts are anchored bands, not fixed coordinates. The logical canvas
   * is 640 wide and H tall (910 classic, up to 1390 on a tall phone).
   *   top(y)  — fixed distance from the top edge
   *   mid(y)  — the element group stays optically centered
   *   bot(y)  — fixed distance from the bottom edge (y as designed at 910)
   * The model may art-direct each card with layout {band, align, scale}:
   * band picks which anchor the text cluster hangs from, align switches
   * the column, scale steps the title along the ramp. Null means the
   * classic default for that card type. */
  function compileCard(c, H, idx) {
    var k = [];
    var t = c.type;
    var slot = String(idx);
    var title = smarten(c.title), body = smarten(c.body), kicker = smarten(c.kicker);
    var midShift = Math.round((H - 910) / 2);
    var botShift = H - 910;
    function mid(y) { return y + midShift; }
    function bot(y) { return y + botShift; }
    var FULL = { position: 'absolute', top: '0px', left: '0px', width: '640px', height: H + 'px' };

    var L = c.layout || {};
    var scaleMul = L.scale === 'loud' ? 1.2 : L.scale === 'quiet' ? 0.82 : 1;
    var aOpts = L.align === 'left' ? { align: 'left', left: 44, width: 552 } : {};
    /* bands: designed-at-910 cluster origins per band; d = the default band */
    function origin(bands) {
      var band = L.band || bands.d;
      var y = bands[band] != null ? bands[band] : bands[bands.d];
      return band === 'top' ? y : band === 'middle' ? mid(y) : bot(y);
    }

    if (t === 'cover') {
      k.push(img(FULL, c.image, slot));
      k.push({ t: 'gradation', css: FULL });
      var dsize = Math.round(RAMP.display * scaleMul);
      var tsize = fitFont(title, dsize, 12);
      var O = origin({ top: 110, middle: 360, bottom: 590, d: 'bottom' });
      k.push(tb(escapeHtml(title), typo(O + (dsize - tsize), tsize, FRAUNCES, ext({ left: 31, width: 580, lh: 1.04, weight: 550, wrap: 'balance' }, aOpts))));
      if (kicker) k.push(tb(escapeHtml(kicker), typo(O + (dsize - tsize) + Math.round(tsize * 1.2) + 30, RAMP.kicker, MONT, ext({ ls: '0.3em', caps: 1, lh: 1.6 }, aOpts))));
      return { bg: inkBg(c.image), k: k };
    }
    if (t === 'quote') {
      k.push(img(FULL, c.image, slot));
      k.push({ t: 'veil', css: FULL });
      var lines = (c.lines || []).map(function (l) { return escapeHtml(smarten(l)); });
      if (c.attribution) lines.push('<i>— ' + escapeHtml(c.attribution) + '</i>');
      var qO = origin({ top: 110, middle: title ? 120 : 200, bottom: title ? 380 : 470, d: 'middle' });
      if (title) k.push(tb(escapeHtml(title), typo(qO, Math.round(40 * scaleMul), FRAUNCES, ext({ weight: 550, wrap: 'balance' }, aOpts))));
      k.push(tb('<p>' + lines.join('<br>') + '</p>',
        typo(qO + (title ? 120 : 0), lines.length > 10 ? RAMP.small : RAMP.quote, SLAB, ext({ left: 80, width: 480, lh: 1.55, wrap: 'pretty' }, aOpts))));
      return { bg: inkBg(c.image), k: k };
    }
    if (t === 'prose') {
      k.push(img(FULL, c.image, slot));
      k.push({ t: 'veil', css: FULL });
      var psize = fitFont(title, Math.round(RAMP.title * scaleMul), 16);
      var pO = origin({ top: 100, middle: kicker ? 150 : 170, bottom: 460, d: 'middle' });
      if (kicker) k.push(tb(escapeHtml(kicker), typo(pO, RAMP.kicker, MONT, ext({ ls: '0.3em', caps: 1 }, aOpts))));
      k.push(tb(escapeHtml(title), typo(pO + (kicker ? 46 : 0), psize, FRAUNCES, ext({ left: 30, width: 580, lh: 1.08, weight: 550, wrap: 'balance' }, aOpts))));
      k.push(tb(L.align === 'left' && body.length > 90 ? dropCap(body) : escapeHtml(body),
        typo(pO + (kicker ? 46 : 0) + Math.round(psize * 1.25) + 42, body.length > 330 ? RAMP.small : RAMP.body, SLAB, ext({ left: 60, width: 520, lh: 1.52, wrap: 'pretty' }, aOpts))));
      return { bg: inkBg(c.image), k: k };
    }
    if (t === 'product') {
      k.push(img(FULL, c.image, slot));
      k.push({ t: 'gradation', css: FULL });
      var prsize = fitFont(title, Math.round(50 * scaleMul), 18);
      var prO = origin({ top: 120, middle: 320, bottom: 540, d: 'bottom' });
      if (kicker) k.push(tb(escapeHtml(kicker), typo(prO, RAMP.kicker, MONT, ext({ ls: '0.3em', caps: 1 }, aOpts))));
      k.push(tb(escapeHtml(title), typo(prO + 46, prsize, FRAUNCES, ext({ left: 30, width: 580, weight: 550, wrap: 'balance' }, aOpts))));
      var pbody = escapeHtml(body) + (c.price ? ' <b>' + escapeHtml(c.price) + '</b>' : '');
      k.push(tb(pbody, typo(prO + 128, RAMP.body - 1, SLAB, ext({ left: 60, width: 520, lh: 1.4, wrap: 'pretty' }, aOpts))));
      if (c.button) {
        k.push({ t: 'button', label: (c.button || '').toUpperCase(), css: {
          position: 'absolute', top: (prO + 252) + 'px', left: '100px', width: '440px', height: '68px',
          color: '#fff', border: '3px solid #fff', 'font-family': OPEN, 'font-size': '24px',
          'letter-spacing': '0.08em', 'z-index': '20'
        }});
        k.push({ t: 'action', url: c.url || '', css: { position: 'absolute', top: (prO + 248) + 'px', left: '97px', width: '446px', height: '76px' } });
      }
      return { bg: inkBg(c.image), k: k };
    }
    if (t === 'video') {
      k.push(img(FULL, c.image, slot));
      k.push({ t: 'veil', css: FULL });
      k.push({ t: 'youtube', url: c.url || '', css: { position: 'absolute', top: mid(355) + 'px', left: '270px', width: '100px', height: '100px', 'z-index': '100' } });
      var vO = origin({ top: 110, middle: 500, bottom: 560, d: 'bottom' });
      if (title) k.push(tb(escapeHtml(title), typo(vO, fitFont(title, Math.round(46 * scaleMul), 18), FRAUNCES, ext({ left: 30, width: 580, weight: 550, wrap: 'balance' }, aOpts))));
      if (body) k.push(tb(escapeHtml(body), typo(vO + 92, RAMP.small, SLAB, ext({ left: 60, width: 520, lh: 1.4, wrap: 'pretty' }, aOpts))));
      return { bg: inkBg(c.image), k: k };
    }
    if (t === 'map') {
      k.push({ t: 'map', value: c.address || '', css: FULL });
      if (title) k.push(tb(escapeHtml(title), typo(70, fitFont(title, RAMP.title, 16), FRAUNCES, { weight: 550, wrap: 'balance' })));
      return { bg: '#161718', k: k };
    }
    return null;
  }

  /* Vertical scrolling is retired: a stored gallery card flattens into
   * one flip card per moment, keeping the whole book on the horizontal
   * axis. Slot keys stay "i.j" so stored image urls and the fan-out
   * still land on the right page. */
  function compileItemCard(it, H, slot) {
    var botShift = H - 910;
    function bot(y) { return y + botShift; }
    var FULL = { position: 'absolute', top: '0px', left: '0px', width: '640px', height: H + 'px' };
    var k = [];
    k.push(img(FULL, it.image, slot));
    k.push({ t: 'gradation', css: FULL });
    var ikicker = smarten(it.kicker), ititle = smarten(it.title), ibody = smarten(it.body);
    if (ikicker) k.push(tb(escapeHtml(ikicker), typo(bot(555), RAMP.caption, MONT, { ls: '0.3em', caps: 1, left: 30, width: 580 })));
    var isize = fitFont(ititle, RAMP.gtitle, 15);
    k.push(tb(escapeHtml(ititle), typo(bot(615) + (RAMP.gtitle - isize), isize, FRAUNCES, { weight: 550, wrap: 'balance' })));
    if (ibody) k.push(tb(escapeHtml(ibody), typo(bot(700), RAMP.small, SLAB, { left: 45, width: 550, lh: 1.4, wrap: 'pretty' })));
    return { bg: inkBg(it.image), k: k };
  }

  /* opts.height: the logical canvas height (default the classic 910).
   * Pages pass BookRuntime.canvasHeight() so books compile to the
   * viewer's screen; the shelf pins 910 for consistent thumbnails. */
  function compileBook(story, opts) {
    var H = (opts && opts.height) || 910;
    var out = { name: smarten(story.name) || 'Untitled', height: H, date: (opts && opts.date) || null, cards: [] };
    (story.cards || []).forEach(function (c, i) {
      c = c || {};
      if (c.type === 'gallery') {
        (c.items || []).slice(0, 5).forEach(function (it, j) {
          out.cards.push(compileItemCard(it || {}, H, i + '.' + j));
        });
        return;
      }
      var compiled = compileCard(c, H, i);
      if (compiled) out.cards.push(compiled);
    });
    // end-of-book card, always appended
    out.cards.push({
      bg: '#2e2d2c',
      k: [{ t: 'end', css: { position: 'absolute', top: (Math.round((H - 910) / 2) + 215) + 'px', left: '0px', width: '640px', height: '480px' } }]
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
        layout: { band: 'bottom', align: 'left', scale: 'standard' },
        image: { h1: 195, h2: 220, label: 'ferry crossing gray water at dawn' } },
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
        layout: { band: 'middle', align: 'center', scale: 'quiet' },
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
