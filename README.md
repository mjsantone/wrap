# BOOK

**BOOK** is a phone-sized flip-book for telling stories — type a few sentences,
an LLM writes the cards, and you flip through them like a small book.

**Live site:** https://mjsantone.github.io/wrap/ (static) · Azure Static Web
Apps (hosted generation, sharing, and the library)

| Page | What it is |
| --- | --- |
| [`index.html`](index.html) | **The Composer** — type a story, Claude writes a book from the format's primitives, and it plays instantly. Hosted generation on Azure (no key needed); bring-your-own-key fallback elsewhere; "Try a sample" always works. |
| `library.html` (`/library`) | **The Library** — books people have told and put on the shelf, as live mini-render cover thumbnails. Hosted deployment only. |
| `b.html` (`/b/{id}`) | **The Viewer** — plays a shared book fetched from the API. |

## How generation works

On the hosted (Azure) deployment, the homepage POSTs your story to
`/api/generate`, which calls Claude (`claude-opus-4-8`) server-side — visitors
don't need an API key. Where no API exists (GitHub Pages) or no model key is
configured, the page falls back to calling the Anthropic API directly from the
browser with your own key. Either way the request uses a structured-output JSON
schema so the response is guaranteed-valid.

The model writes a **semantic story schema** — card types like `cover`, `prose`,
`gallery`, `quote`, `product`, `video`, `map`, each with copy and a color mood —
and a deterministic compiler in the page maps every card onto designed layouts.
The LLM never emits pixel coordinates, so books always come out looking
composed. The generation contract (schema + system prompt) lives once in
`api/src/contract/` and is inlined into the pages at build time.

## The adaptive canvas

Books lay out on a logical canvas 640 wide and **H** tall, where H follows the
viewer's screen aspect (910 on a classic 0.70 frame, up to 1390 on a modern
tall phone) — so a book fills the whole screen wherever it's opened. Layouts
are **anchored bands**, not fixed coordinates: covers and product cards anchor
their text to the bottom edge, quotes and prose stay optically centered, and
full-bleed backgrounds span whatever H is. Stored books are the semantic story,
recompiled at view time, so every book — including ones shared before a layout
change — always renders with the current compiler.

Sharing stores the story in Cosmos DB behind `/b/{id}` links; **Add to the
library** publishes it to the public shelf (with an Azure AI Content Safety
gate when configured).

## The pictures

Every card carries an image *slot* — a scene label plus duotone hues — and
books render instantly with those gradient placeholders. On the hosted
deployment, sharing a book also generates real photographs: after Share, the
composer requests one image per slot (`POST /api/books/{id}/images`),
`gpt-image-1` paints a 1024×1536 portrait, and each picture fades in over its
placeholder as it lands — on the shared page, in the library thumbnails, and
in the composer preview. The provider is picked by environment:
`AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_KEY` (+
`AZURE_OPENAI_IMAGE_DEPLOYMENT`) for Azure OpenAI, else `OPENAI_API_KEY` for
the OpenAI API directly. With neither set, books simply keep their duotone
placeholders.

## Controls

| Input | Action |
| --- | --- |
| ← / → keys | flip cards |
| Drag horizontally | turn the page live under your finger |
| Tap screen edges / chevrons | flip cards |
| Scroll ↓ | move through a gallery card |

## Development

`index.html`, `b.html`, and `library.html` are **generated** — edit the
sources in `src/` and rebuild:

```
python3 build.py          # writes the root pages
python3 build.py --check  # what CI runs: fails if outputs are stale
```

| Source | What it is |
| --- | --- |
| `src/runtime.js` | `BookRuntime` — the renderer, the flip engine, and the adaptive-canvas math |
| `src/compile.js` | `BookCompiler` — story JSON schema, system prompt, and the semantic→layout compiler (band-anchored, height-parameterized) |
| `src/runtime.css` | Player stage, card mechanics, and component styles |
| `src/fonts.css` | All families as data-URI woff2 — Fraunces (brand), Montserrat, Josefin Slab, Open Sans |
| `src/pages/*.html` | Per-page templates (chrome + wiring); `/*@inline path*/` tokens mark where sources are embedded |
| `api/` | Azure Functions API (generation, persistence, share links, library + publish) — `node --test` in `api/` runs its unit tests |
| `staticwebapp.config.json` | Azure Static Web Apps config: `/b/{id}` + `/library` rewrites, API runtime |

The outputs stay committed so GitHub Pages serves them directly; the
`build-check` workflow rejects commits where they drift from `src/`.

## Provenance

The flip mechanics — cards pivoting around a left-edge spine
(`perspective: 2000px`, `rotateY(-90deg)`, `cubic-bezier(0.26, 0.65, 0.37,
1.07)` at 0.7s), the sliding pagination bar, the first-time bounce hint, and
the vertical snap galleries — were reverse-engineered from
[wrap.co](https://www.wrap.co)'s 2015-era player and JSON format, then rebuilt
and re-designed as BOOK. The repo name and wrap.co references are that
provenance; the Cosmos names default to `book`/`books` (overridable via
`COSMOS_DATABASE` / `COSMOS_CONTAINER`).

The full architecture — hosting, server-side generation, the library, and the
image-generation roadmap — is in [`ARCHITECTURE.md`](ARCHITECTURE.md).
