/* BookChrome — page plumbing shared by the composer, viewer, and editor.
 * One source for the pieces that used to be copy-pasted per page:
 *   - apiFetch: long-call host first (no ~45s cap), same-origin fallback
 *   - isPhone:  the sheet/gesture breakpoint, matching chrome.css
 *   - toaster:  a toast function bound to a page's .share-toast element
 *   - sheet:    the pull-up action sheet — open/close with focus and the
 *               first-run peek hint, scrim dismissal, drag-down dismissal
 * Inlined by build.py, so the LONG_API token resolves here too. */
(function (global) {
  'use strict';

  /* Story and image generation run long; SWA severs responses at ~45s.
   * A standalone Functions app (baked in at build time from the LONG_API
   * file) hosts the same API without that cap. Try it first and fall
   * back to same-origin when it's unreachable or not yet deployed —
   * the site keeps working on managed functions alone. */
  var LONG_API = '@LONGAPI@';
  async function apiFetch(path, opts) {
    if (LONG_API) {
      try {
        var r = await fetch(LONG_API + path, opts);
        if (r.status !== 404) return r;
      } catch (e) { /* CORS not set / app down — same-origin still works */ }
    }
    return fetch(path, opts);
  }

  function isPhone() {
    return global.matchMedia('(max-width: 640px), (hover: none) and (pointer: coarse)').matches;
  }

  /* toast(html, sticky) bound to one element; non-sticky fades in 8s */
  function toaster(el) {
    var timer = null;
    return function toast(html, sticky) {
      el.innerHTML = html;
      el.hidden = false;
      clearTimeout(timer);
      if (!sticky) timer = setTimeout(function () { el.hidden = true; }, 8000);
    };
  }

  /* The phone action sheet. bar = the .chrome element, screenNode = the
   * player .screen it sits over. Returns { set, hint, isOpen }. */
  function sheet(bar, screenNode) {
    function set(open) {
      bar.classList.remove('peek');
      bar.classList.toggle('open', open);
      /* the book pushes back and locks while the sheet is up */
      screenNode.classList.toggle('sheet-open', open);
      if (open) {
        try { localStorage.setItem('book.sheetHinted', '1'); } catch (e) {}
        var first = bar.querySelector('button:not([hidden])');
        if (first && isPhone()) first.focus();
      }
    }

    /* first book on a phone: the grab bar peeks so the sheet is discoverable */
    function hint() {
      if (!isPhone()) return;
      try { if (localStorage.getItem('book.sheetHinted')) return; } catch (e) {}
      bar.classList.add('peek');
      setTimeout(function () { bar.classList.remove('peek'); }, 2800);
    }

    /* using one of the sheet's actions closes it */
    bar.addEventListener('click', function (e) {
      if (e.target.closest('button') || e.target.closest('a')) set(false);
    });

    /* the dimmed book is a scrim: any touch on it — tap or sideways
     * swipe — dismisses the sheet instead of flipping pages */
    var scrimDismissed = false;
    screenNode.addEventListener('pointerdown', function (e) {
      scrimDismissed = false;
      if (!bar.classList.contains('open')) return;
      if (e.target.closest('.chrome')) return;
      set(false);
      scrimDismissed = true;
      e.stopPropagation(); /* the player never sees it — no flip, no drag */
    }, true);
    screenNode.addEventListener('click', function (e) {
      if (scrimDismissed) {
        scrimDismissed = false;
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    /* swipe: drag the open sheet down to dismiss */
    var drag = null;
    bar.addEventListener('pointerdown', function (e) {
      if (bar.classList.contains('open')) drag = { y: e.clientY, moved: false };
    });
    bar.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dy = e.clientY - drag.y;
      if (dy > 6 && !drag.moved) {
        drag.moved = true;
        /* capture so the drag survives crossing overlays (e.g. the toast) */
        try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      }
      if (drag.moved) {
        bar.style.transition = 'none';
        bar.style.transform = 'translateY(' + Math.max(0, dy) + 'px)';
      }
    });
    function end(e) {
      if (!drag) return;
      var dy = e.clientY - drag.y;
      bar.style.transition = '';
      bar.style.transform = '';
      if (drag.moved && dy > 55) set(false);
      drag = null;
    }
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);

    return {
      set: set,
      hint: hint,
      isOpen: function () { return bar.classList.contains('open'); }
    };
  }

  global.BookChrome = { apiFetch: apiFetch, isPhone: isPhone, toaster: toaster, sheet: sheet };
})(window);
