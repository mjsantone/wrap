# WRAP — reborn

A revival of [wrap.co](https://www.wrap.co)'s mobile flip-book format, reverse-engineered
from the original player and rebuilt as dependency-free single-file pages.

**Live site:** https://mjsantone.github.io/wrap/

| Page | What it is |
| --- | --- |
| [`index.html`](index.html) | **Wrap Composer** — type a story, an LLM (Claude) writes a wrap from the format's primitives, and it renders instantly in the player. Bring-your-own API key (stored in your browser only); "Try a sample" works without one. |
| [`player.html`](player.html) | **Wrap Library** — a generic player that renders any original wrap from its JSON. Seven reverse-engineered wraps embedded (`#w0`–`#w6`). |
| [`howwemet.html`](howwemet.html) | **How We Met** — a full-fidelity handcrafted reconstruction of the original example wrap. |
| `w.html` (`/w/{id}`) | **Wrap Viewer** — plays a shared wrap fetched from the API. Share links work on the Azure deployment (see below); on GitHub Pages the Share button explains itself. |

## How generation works

The homepage sends your story to the Anthropic API (`claude-opus-4-8`) directly from
the browser, with a structured-output JSON schema so the response is guaranteed-valid.
The model writes a **semantic story schema** — card types like `cover`, `prose`,
`gallery`, `quote`, `product`, `video`, `map`, each with copy and a color mood — and a
deterministic compiler in the page maps every card onto the exact layouts
reverse-engineered from real wraps (the 640 × 910 canvas, headline at y=590, gallery
text at 555/615/700, and so on). The LLM never emits pixel coordinates, so wraps
always come out looking designed.

Scaling note: for public use without per-visitor API keys, put a small serverless
proxy (e.g. a Cloudflare Worker) in front of the Anthropic API and point the page's
fetch URL at it — the rest of the page is unchanged.

## About the original format

### What a wrap is

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

`index.html` and `player.html` are **generated** — edit the sources in `src/`
and rebuild:

```
python3 build.py          # writes index.html and player.html
python3 build.py --check  # what CI runs: fails if outputs are stale
```

| Source | What it is |
| --- | --- |
| `src/runtime.js` | `WrapRuntime` — the shared renderer (all component types) and flip engine |
| `src/compile.js` | `WrapCompiler` — story JSON schema, system prompt, and the semantic→layout compiler |
| `src/runtime.css` | Player stage, card mechanics, and component styles |
| `src/fonts.css` | The three families as data-URI woff2 |
| `src/data/wraps-data.js` | The embedded library wraps |
| `src/pages/*.html` | Per-page templates (chrome + wiring); `/*@inline path*/` tokens mark where sources are embedded |
| `api/` | Azure Functions API (persistence + share links) — `node --test` in `api/` runs its unit tests |
| `staticwebapp.config.json` | Azure Static Web Apps config: `/w/{id}` rewrite, API runtime |

The outputs stay committed so GitHub Pages serves them directly; the
`build-check` workflow rejects commits where they drift from `src/`.
`howwemet.html` is a hand-crafted reconstruction and is not built.

Where this is heading — hosting, server-side generation, the discovery
gallery, image generation — is written up in [`ARCHITECTURE.md`](ARCHITECTURE.md).
