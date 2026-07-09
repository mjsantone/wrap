# How We Met — a WRAP flip-book reconstruction

A single-file, dependency-free reconstruction of **"Storytelling: How We Met"**, an
example *wrap* from [wrap.co](https://www.wrap.co) — the mobile-first "flip-book"
messaging format. Everything lives in [`index.html`](index.html): fonts, artwork,
and the card-flip engine. It works offline, on any phone or desktop browser.

**Live site:** https://mjsantone.github.io/wrap/

**Generic player:** https://mjsantone.github.io/wrap/player.html — renders any
wrap from its JSON. Seven wraps are embedded (How We Met, Timberland Holiday
Lookbook, QVC, Express Buy – Raiders, Assurance Auto Insurance, Portfolio:
Designer, Akris Pre-Fall 2015); switch between them with the ≡ Library button
or a `#w0`–`#w6` URL hash.

## What a wrap is

A wrap is a phone-sized stack of full-bleed cards you flip through like a small
book. This one tells an eight-card love story: a cover, a poem, a prologue, three
vertically-scrolling photo galleries, a closing "Forever" card, and an end card.

## How this was reconstructed

The original player is a defunct Angular app that loaded its content at runtime,
so the reconstruction was reverse-engineered from three sources:

1. **The player page shell** (`wrap.co/wraps/{id}` HTML) — revealed the
   architecture: content is fetched as JSON from
   `publisher.wrap.co/api/wraps/{id}/public`, and the flip engine lives in
   `wraps/main.css` + `main.js`.
2. **The wrap's public JSON** — every card, all copy, the component tree
   (textboxes, images, masks, galleries), exact geometry (`top/left/width/height`
   on a 640 × 910 design canvas), fonts, sizes, and colors.
3. **The player stylesheet (`main.css`)** — the real mechanics, ported verbatim:
   - Cards pivot around a **left-edge spine**: container
     `perspective: 2000px; perspective-origin: left center`, turned cards rest at
     `rotateY(-90deg)`, easing `cubic-bezier(0.26, 0.65, 0.37, 1.07)` at 0.7 s.
   - The **green pagination bar** (`#9fcc3a`) sliding along the bottom.
   - Edge chevrons at the player's original 15 % resting opacity.
   - The first-time **"flip me" bounce hint** (`bounceCardHintAnimation`),
     keyframe-for-keyframe.
   - Galleries use the original `vertical-snap-to-card` behavior — they scroll
     down inside a card.

### What's faithful

- All copy, card order, and per-element layout coordinates from the JSON
- Typography: **Montserrat** (headlines) and **Josefin Slab** (body), embedded as
  data-URI woff2 so no network requests are made
- Colors, overlay gradients, the inset photo frames, the outline-frame cards,
  even a template headline that the original leaves hidden behind a photo
- Flip mechanics, pagination, hints, and end-of-wrap widget styling

### What's a stand-in

The original photographs (18 assets on `assets.wrap.co`) are replaced with
illustrated SVG scenes, each tagged "photo stand-in" in the corner. Swap them by
replacing the corresponding `<svg>` blocks (or embedding real images as data
URIs).

## Controls

| Input | Action |
| --- | --- |
| ← / → keys | flip cards |
| Drag horizontally | turn the page live under your finger |
| Tap screen edges / chevrons | flip cards |
| Scroll ↓ | move through a gallery card |

## The generic player

`player.html` is a schema-driven renderer: it walks a wrap's JSON component
tree and reproduces each card at its exact geometry on the 640 × 910 canvas,
inside the same flip mechanics. Component types supported — decoded across the
seven embedded wraps:

`card`, `textbox`, `image`, `box`, `gallery`, `gallery-item` (snap and
free-scroll), `button`, `action` (hyperlink / `tel:` / `mailto:`), `location`
(launcher button and full-card inline map), `youtube` (play button),
`widget` (e.g. Typeform forms), `flow` (WRAP's native form), `background`,
and `end`.

To add a wrap: fetch `https://publisher.wrap.co/api/wraps/{id}/public`, slim
it, and append it to the `window.WRAPS` array embedded in the file. Original
photos live on assets.wrap.co and are replaced with deterministic gradient
placeholders.

## Development

There is no build step. Edit `index.html` or `player.html`, open in a browser.
