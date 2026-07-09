/* WrapRuntime — shared renderer + flip engine for all WRAP pages.
 * Single source of truth: consumed by index.html (composer) and player.html (library).
 * Node vocabulary is the union of the two producers:
 *   - reverse-engineered wrap JSON (player): textbox, image(url), box, gallery,
 *     button(css content label), action, location, youtube, widget, flow, background, end
 *   - the story compiler (composer): image(hue/lbl), gradation, veil, outline,
 *     textbox, button(label), action, youtube, map, gallery, end
 */
(function (global) {
  'use strict';

  var GRADATION_ASSET = '26e27ad1';   /* wrap.co's shared dark-gradient overlay PNG */
  var OUTLINE_ASSET   = '66f61527';   /* wrap.co's shared white outline-frame PNG  */

  /* ---------- helpers ---------- */

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Only allow safe link schemes — model- or JSON-supplied URLs must never
   * become javascript:/data: sinks (they'd run with access to localStorage). */
  function safeUrl(url) {
    if (typeof url !== 'string') return null;
    var u = url.trim();
    if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
    return null;
  }

  function applyCss(el, css) {
    if (!css) return;
    for (var k in css) {
      if (k === 'content') continue; /* button labels ride in css.content; render() reads it as text */
      el.style.setProperty(k, css[k]);
    }
    if (!css.position || css.position !== 'absolute') el.style.position = 'absolute';
  }

  function grad(h1, h2) {
    return 'linear-gradient(160deg, hsl(' + h1 + ',30%,36%), hsl(' + h2 + ',34%,14%))';
  }

  function hashHue(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return h % 360;
  }

  function extLink(el, url) {
    var u = safeUrl(url);
    if (!u) return false;
    el.href = u;
    if (u.indexOf('tel:') !== 0 && u.indexOf('mailto:') !== 0) {
      el.target = '_blank'; el.rel = 'noopener noreferrer';
    }
    return true;
  }

  /* ---------- component renderer ---------- */
  /* ctx: { wrapName, player } — player provides showCard(i) for the end-card replay. */

  function render(node, parent, ctx) {
    var t = node.t, el;

    if (t === 'image') {
      var url = node.url || '';
      var isGrad = url.indexOf(GRADATION_ASSET) !== -1 || /gradation|overlay/i.test(node.n || '');
      var isOutline = url.indexOf(OUTLINE_ASSET) !== -1 || /outline/i.test(node.n || '');
      el = document.createElement('div');
      el.className = 'cmp ' + (isGrad ? 'cmp-gradation' : isOutline ? 'cmp-outline' : 'cmp-image');
      applyCss(el, node.css);
      if (!isGrad && !isOutline) {
        var h1 = (node.hue && node.hue[0] != null) ? node.hue[0] : hashHue(url || node.n || 'x');
        var h2 = (node.hue && node.hue[1] != null) ? node.hue[1] : (h1 + 40) % 360;
        var ph = document.createElement('div');
        ph.className = 'img-ph';
        ph.style.background = grad(h1, h2);
        var tag = document.createElement('span');
        tag.textContent = node.lbl || 'image';
        ph.appendChild(tag);
        el.appendChild(ph);
      }
    }
    else if (t === 'gradation' || t === 'veil') {
      el = document.createElement('div');
      el.className = 'cmp ' + (t === 'veil' ? 'cmp-veil' : 'cmp-gradation');
      applyCss(el, node.css);
    }
    else if (t === 'outline') {
      el = document.createElement('div');
      el.className = 'cmp cmp-outline';
      applyCss(el, node.css);
    }
    else if (t === 'textbox') {
      el = document.createElement('div');
      el.className = 'cmp';
      applyCss(el, node.css);
      el.innerHTML = (node.text || '').replace(/\n/g, ' ');
    }
    else if (t === 'box' || t === 'background') {
      el = document.createElement('div');
      el.className = 'cmp';
      applyCss(el, node.css);
    }
    else if (t === 'button') {
      el = document.createElement('div');
      el.className = 'cmp cmp-button';
      applyCss(el, node.css);
      var label = node.label;
      if (label == null && node.css && node.css.content) {
        label = String(node.css.content).replace(/^['"]|['"]$/g, '');
      }
      el.textContent = label || '';
    }
    else if (t === 'action') {
      el = document.createElement('a');
      el.className = 'cmp cmp-action';
      applyCss(el, node.css);
      var au = safeUrl(node.url);
      if (au && au !== 'http://' && au !== 'https://') extLink(el, au);
      el.setAttribute('aria-label', node.n || 'link');
    }
    else if (t === 'youtube') {
      el = document.createElement('a');
      el.className = 'cmp cmp-youtube';
      applyCss(el, node.css);
      extLink(el, node.url);
      el.setAttribute('aria-label', 'Play video');
      el.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true">' +
        '<circle cx="50" cy="50" r="46" fill="rgba(0,0,0,0.45)" stroke="#fff" stroke-width="5"/>' +
        '<polygon points="40,30 74,50 40,70" fill="#fff"/></svg>';
    }
    else if (t === 'widget') {
      el = document.createElement('a');
      el.className = 'cmp cmp-widget';
      applyCss(el, node.css);
      extLink(el, node.url);
      var wlabel = /typeform/i.test(node.n || '') ? 'Open Form' : (node.n || 'Open');
      el.innerHTML = '<span>' + escapeHtml(wlabel) + '</span>';
      el.title = node.n || '';
    }
    else if (t === 'flow') {
      el = document.createElement('div');
      el.className = 'cmp cmp-flow';
      applyCss(el, node.css);
      el.innerHTML = '<svg width="24" height="29" viewBox="0 0 35 42" fill="none" aria-hidden="true">' +
        '<rect x="2" y="2" width="31" height="38" rx="4" stroke="#fff" stroke-width="3"/>' +
        '<path d="M9 12 H26 M9 20 H26 M9 28 H18" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>' +
        '<span>' + escapeHtml(node.n || 'Form') + '</span>';
      el.title = 'WRAP native form (service offline)';
    }
    else if (t === 'location' || t === 'map') {
      var isMap = t === 'map' || (node.b || []).indexOf('locationMap') !== -1;
      el = document.createElement('a');
      el.href = 'https://maps.google.com/?q=' + encodeURIComponent(node.value || '');
      el.target = '_blank'; el.rel = 'noopener noreferrer';
      el.title = node.value || '';
      applyCss(el, node.css);
      if (isMap) {
        el.className = 'cmp cmp-map';
        el.innerHTML =
          '<svg class="map-bg" viewBox="0 0 640 910" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
          '<rect width="640" height="910" fill="#2a2d31"/>' +
          '<g stroke="#3c4046" stroke-width="10"><path d="M-20 200 H660 M-20 430 H660 M-20 660 H660 M120 -20 V930 M330 -20 V930 M520 -20 V930"/></g>' +
          '<g stroke="#43474d" stroke-width="22"><path d="M-20 320 H660 M240 -20 V930"/></g>' +
          '<path d="M-20 780 Q320 700 660 800" stroke="#39546b" stroke-width="26" fill="none"/></svg>' +
          '<div class="map-pin"><svg width="52" height="66" viewBox="0 0 20 26" fill="none">' +
          '<path d="M10 1 C5 1 1.5 4.8 1.5 9.4 C1.5 15.6 10 25 10 25 C10 25 18.5 15.6 18.5 9.4 C18.5 4.8 15 1 10 1 Z" fill="#e8534a"/>' +
          '<circle cx="10" cy="9.4" r="3.4" fill="#fff"/></svg>' +
          '<span>' + escapeHtml(node.value || '') + '</span></div>';
      } else {
        el.className = 'cmp cmp-location';
        el.innerHTML = '<svg width="20" height="26" viewBox="0 0 20 26" fill="none" aria-hidden="true">' +
          '<path d="M10 1 C5 1 1.5 4.8 1.5 9.4 C1.5 15.6 10 25 10 25 C10 25 18.5 15.6 18.5 9.4 C18.5 4.8 15 1 10 1 Z" fill="#fff"/>' +
          '<circle cx="10" cy="9.4" r="3.4" fill="#212121"/></svg>' +
          '<span>Store Locator</span>';
      }
    }
    else if (t === 'end') {
      el = document.createElement('div');
      el.className = 'cmp cmp-end';
      applyCss(el, node.css);
      el.innerHTML = '<p>' + escapeHtml(ctx.wrapName || '') + '</p>' +
        '<div class="end-wordmark">WR<b>A</b>P</div>';
      var rb = document.createElement('button');
      rb.className = 'replay'; rb.type = 'button'; rb.textContent = 'Replay';
      rb.addEventListener('click', function () { if (ctx.player) ctx.player.showCard(0); });
      el.appendChild(rb);
    }
    else if (t === 'gallery') {
      el = document.createElement('div');
      el.className = 'cmp-gallery';
      if ((node.b || []).indexOf('vertical-freescroll') !== -1) el.style.scrollSnapType = 'none';
      (node.k || []).forEach(function (item) {
        var it = document.createElement('div');
        it.className = 'cmp-gallery-item';
        if (item.css) {
          applyCss(it, item.css);
          it.style.position = 'relative'; it.style.top = ''; it.style.left = '';
        }
        (item.k || []).forEach(function (ch) { render(ch, it, ctx); });
        el.appendChild(it);
      });
      parent.appendChild(el);
      if ((node.k || []).length > 1) {
        var hint = document.createElement('div');
        hint.className = 'gallery-hint';
        hint.innerHTML = '<svg width="46" height="24" viewBox="0 0 46 24" fill="none"><path d="M4 4 L23 19 L42 4" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        parent.appendChild(hint);
        el.addEventListener('scroll', function () {
          hint.classList.toggle('hidden', el.scrollTop > 60);
        }, { passive: true });
      }
      return;
    }
    else { return; }

    parent.appendChild(el);
    (node.k || []).forEach(function (ch) { render(ch, el, ctx); });
  }

  /* ---------- player factory: flip mechanics (verbatim from wrap.co main.css) ---------- */
  /* opts: { screen, container, prevBtn, nextBtn, pageBar, tapLeft, tapRight,
   *         keyGate()  -> bool   (should arrow keys act right now)
   *         onLoaded(wrap)       (page hook: set title, chrome, ...) }        */

  function createPlayer(opts) {
    var screenEl = opts.screen, container = opts.container;
    var prevBtn = opts.prevBtn, nextBtn = opts.nextBtn, pageBar = opts.pageBar;
    var cards = [], total = 0, current = 0, animating = false;
    var api = {};

    function rescale() {
      var s = screenEl.clientWidth / 640;
      Array.prototype.forEach.call(screenEl.querySelectorAll('.canvas'), function (cv) {
        cv.style.transform = 'scale(' + s + ')';
      });
    }
    if (window.ResizeObserver) new ResizeObserver(rescale).observe(screenEl);
    else window.addEventListener('resize', rescale);

    function update() {
      if (current > 0 && cards[0]) cards[0].classList.remove('animate-swipe-hint');
      cards.forEach(function (c, i) { c.classList.toggle('turned', i < current); });
      pageBar.style.left = (current * 100 / total) + '%';
      prevBtn.hidden = current === 0;
      nextBtn.hidden = current === total - 1;
    }

    function go(dir) {
      if (animating) return;
      var next = current + dir;
      if (next < 0 || next >= total) return;
      animating = true; current = next; update();
      setTimeout(function () { animating = false; }, 420);
    }

    api.loadWrap = function (w) {
      container.innerHTML = '';
      cards = []; current = 0;
      var ctx = { wrapName: w.name, player: api };
      (w.cards || []).forEach(function (cardNode, i) {
        var card = document.createElement('section');
        card.className = 'card';
        card.style.zIndex = String(500 - i);
        var bg = cardNode.bg || (cardNode.css && cardNode.css['background-color']);
        if (bg) card.style.background = bg;
        var canvas = document.createElement('div');
        canvas.className = 'canvas';
        (cardNode.k || []).forEach(function (ch) { render(ch, canvas, ctx); });
        card.appendChild(canvas);
        var fold = document.createElement('div');
        fold.className = 'fold';
        card.appendChild(fold);
        container.appendChild(card);
        cards.push(card);
      });
      total = cards.length;
      pageBar.style.width = (100 / total) + '%';
      rescale();
      /* wrap.co's first-time "flip me" hint, verbatim keyframes in runtime.css */
      cards[0].classList.add('animate-swipe-hint');
      cards[0].addEventListener('animationend', function () {
        cards[0].classList.remove('animate-swipe-hint');
      });
      update();
      if (opts.onLoaded) opts.onLoaded(w);
    };
    api.go = go;
    api.showCard = function (i) { current = Math.max(0, Math.min(total - 1, i)); update(); };
    api.cardCount = function () { return total; };

    nextBtn.addEventListener('click', function () { go(1); });
    prevBtn.addEventListener('click', function () { go(-1); });
    if (opts.tapRight) opts.tapRight.addEventListener('click', function () { go(1); });
    if (opts.tapLeft) opts.tapLeft.addEventListener('click', function () { go(-1); });
    document.addEventListener('keydown', function (e) {
      if (opts.keyGate && !opts.keyGate()) return;
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    });

    /* live drag flip around the left spine */
    var drag = null;
    screenEl.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button') || e.target.closest('a')) return;
      if (opts.dragGate && !opts.dragGate()) return;
      drag = { x: e.clientX, y: e.clientY, mode: null, card: null, fwd: true, dx: 0 };
    });
    screenEl.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.mode) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (Math.abs(dx) <= Math.abs(dy)) { drag = null; return; } // vertical → galleries scroll natively
        drag.mode = 'h'; drag.fwd = dx < 0;
        if (!drag.fwd && current === 0) { drag = null; return; }
        drag.card = drag.fwd ? cards[current] : cards[current - 1];
        drag.card.style.transition = 'none';
        var f0 = drag.card.querySelector('.fold');
        if (f0) f0.style.transition = 'none';
        try { screenEl.setPointerCapture(e.pointerId); } catch (err) {}
      }
      if (drag.mode !== 'h' || !drag.card) return;
      var w = screenEl.clientWidth, rot;
      if (drag.fwd) {
        if (current >= total - 1) rot = Math.max(-8, dx / w * 30); // edge resistance
        else rot = Math.max(-90, Math.min(0, dx / w * 110));
      } else {
        rot = Math.min(0, Math.max(-90, -90 + dx / w * 110));
      }
      drag.card.style.transform = 'rotateY(' + rot + 'deg)';
      var fd = drag.card.querySelector('.fold');
      if (fd) fd.style.opacity = String(Math.min(1, -rot / 90));
      drag.dx = dx;
    });
    function endDrag() {
      if (!drag) return;
      if (drag.mode === 'h' && drag.card) {
        var w = screenEl.clientWidth;
        var commit = Math.abs(drag.dx) > w * 0.18;
        drag.card.style.transition = '';
        var fd = drag.card.querySelector('.fold');
        if (fd) { fd.style.transition = ''; fd.style.opacity = ''; }
        drag.card.style.transform = '';
        if (commit) {
          if (drag.fwd && current < total - 1) current += 1;
          else if (!drag.fwd && current > 0) current -= 1;
        }
        update();
      }
      drag = null;
    }
    screenEl.addEventListener('pointerup', endDrag);
    screenEl.addEventListener('pointercancel', endDrag);

    return api;
  }

  global.WrapRuntime = {
    render: render,
    createPlayer: createPlayer,
    escapeHtml: escapeHtml,
    safeUrl: safeUrl,
    applyCss: applyCss,
    grad: grad,
    hashHue: hashHue
  };
})(window);
