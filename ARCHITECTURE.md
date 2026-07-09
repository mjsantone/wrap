# BOOK — Architecture

Where this project is and where it's going: from three static pages with a
bring-your-own-key composer to a hosted service that hundreds of people can
use, with a discovery gallery, real images, and web-grounded generation —
funded by Azure credits.

## Today (phase 1 — this repo)

```
GitHub Pages (static)
├── index.html    Book Composer — story → Claude → semantic JSON → compiler → player
├── player.html   Book Library — 7 reverse-engineered wrap.co examples
└── howwemet.html Handcrafted reconstruction (frozen artifact, not built)

src/                     single source of truth, assembled by build.py
├── runtime.js           BookRuntime — renderer (15 component types) + flip engine
├── compile.js           BookCompiler — story schema, system prompt, layout compiler
├── runtime.css          player stage, card mechanics, component styles
├── fonts.css            Montserrat / Josefin Slab / Open Sans as data-URI woff2
├── data/books-data.js   embedded library examples
└── pages/               page templates (chrome + wiring only)
```

`build.py` inlines the shared sources into each page so the deployed files
stay dependency-free single files (GitHub Pages needs no build server, pages
work offline, no CDN calls). CI (`build-check.yml`) fails any commit where
the outputs drift from the sources — that guard exists because the #1 debt
before this phase was the same renderer pasted into two pages, where a
security fix (the `safeUrl` allowlist) had to be applied twice.

**The core design decision that scales:** the LLM emits a small *semantic*
story schema (cover / prose / gallery / quote / product / video / map — copy
and color moods only). A deterministic compiler maps it onto layouts
reverse-engineered from real wrap.co examples. The model never positions pixels, so
output is always well-designed, token counts stay small, rendering is
instant, and stored books are tiny JSON documents. Everything below builds
on that contract.

## Target (Azure)

```
                     ┌────────────────────────────────────────────┐
                     │  Azure Static Web Apps                     │
 browser ───────────▶│  static pages (built from src/)            │
                     │  + managed Functions API                   │
                     └───────┬────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────────────┐
              ▼              ▼                      ▼
   POST /api/generate   GET /api/gallery      GET /api/books/{id}
              │              │                      │
              ▼              └──────────┬───────────┘
   ┌─────────────────────┐             ▼
   │ Claude on Microsoft │   ┌──────────────────────┐
   │ Foundry             │   │ Cosmos DB serverless │
   │ (claude-opus-4-8,   │   │ books + gallery feed │
   │  structured outputs,│   └──────────────────────┘
   │  web search tool)   │             ▲
   └─────────┬───────────┘             │
             │ story JSON              │
             ▼                         │
   ┌─────────────────────┐             │
   │ Durable Functions   │─────────────┘
   │ image fan-out       │
   │ Azure OpenAI        │──▶ Blob Storage + CDN (images)
   │ gpt-image-1         │
   └─────────────────────┘

   Azure AI Content Safety — moderation gate before a book goes public
   Application Insights — tracing, cost metering, error rates
   API Management (later) — subscription tiers, when accounts arrive
```

### Components and why

| Piece | Choice | Why |
| --- | --- | --- |
| Hosting + API | **Azure Static Web Apps** | One resource serves the static pages *and* a managed Functions API under the same origin — no CORS, no separate app service. Free/Standard tiers are covered pennies by credits. |
| Generation | **Azure Function `POST /api/generate`** | Moves the Anthropic call server-side. This ends bring-your-own-key: visitors just type a story. Also the single choke point for rate limits, moderation, and metering. |
| Model access | **Claude on Microsoft Foundry** (`claude-opus-4-8`) | Bills against Azure credits instead of an Anthropic account card. The Anthropic SDK's `AnthropicFoundry` client keeps the same Messages API surface — the prompt, schema, and compiler contract move over unchanged. Beta status is the top spike risk (see checklist). |
| Book storage | **Cosmos DB serverless** | Books are small JSON docs read by id plus one feed query — exactly the serverless Cosmos sweet spot. Pay-per-request rounds to ~zero at hundreds of users; no capacity to manage. |
| Gallery feed | Cosmos + `GET /api/gallery` | The discovery gallery is a rebuild of wrap.co's `/examples/` grid. Thumbnails are live mini-renders of the first card (the runtime scaled down in CSS) — no screenshot service needed. |
| Images | **Azure OpenAI `gpt-image-1`**, 1024×1536 portrait | The compiler already emits an image *slot* per card (label + duotone hues). Generation fills the slot; the gradient stays as the instant placeholder while images arrive, so books are viewable immediately. |
| Image fan-out | **Durable Functions** | A book needs 5–10 images; generating them inline would hold the HTTP call open for minutes. The orchestration fans out per-image activities, writes each to Blob as it lands, and the player upgrades placeholders progressively. |
| Image serving | **Blob Storage + Azure CDN** | Immutable content-addressed blobs, cache-forever headers. |
| Web grounding | **Claude's server-side web search tool** | "Launch story for my bakery" can pull real hours/address; product cards get real URLs. Server-side tool — zero orchestration code in the Function, works only once generation is server-side. |
| Moderation | **Azure AI Content Safety** | Public gallery means user content needs a gate. Text at generate time; images before publish. Ephemeral (private) books skip the strict gate. |
| Observability | **Application Insights** | Per-generation traces: tokens, latency, cost, failure class. This is how credits burn gets watched. |
| Accounts/tiers | **API Management — deferred** | Auth and subscription tiers are parked by decision; APIM slots in front of the API later without touching the Functions. |

### Book lifecycle

```
ephemeral ──(user taps Share)──▶ unlisted (link-only, light moderation)
                                    │ (user taps Publish)
                                    ▼
                              published (gallery feed, full moderation)
```

- **ephemeral** — generated, playable, stored with a TTL (Cosmos TTL field),
  never listed. Most books end here; storage cost stays flat.
- **unlisted** — permanent id, shareable URL (`/b/{id}`), not in the feed.
- **published** — appears in the gallery after the Content Safety gate.

Add `formatVersion: 1` to every stored book document from day one — stored
books outlive renderer revisions, and versioning is free now and painful
retroactively.

### Scaling honestly stated

At "hundreds of people," every piece above idles in free/serverless tiers;
the only real cost is model tokens and image generations. The architecture
doesn't need to change until ~10⁵ users, and the bottleneck then is Foundry
rate limits (request a quota bump), not the storage or hosting.

Ballpark per book: one Opus generation (~$0.10–0.30 with thinking) plus
6–8 gpt-image-1 portraits (~$0.15–0.50). Call it **≤ $1/book worst case**;
1,000 generated books ≈ low hundreds of dollars — inside credits. App
Insights dashboards + a daily budget alert are the guardrail, with a
per-IP rate limit (n generations/day) in the Function until accounts exist.

## Deploying phase 2 (persistence + share links)

The repo is already SWA-shaped: static pages at the root, managed API in
`api/`, `staticwebapp.config.json` for the `/b/{id}` rewrite. To go live:

1. **Cosmos DB** — create a serverless account; database `book`, container
   `books` with partition key `/id`.
2. **Static Web App** — create (Free tier is fine to start), link it to
   this GitHub repo; app location `/`, api location `api`, no build
   command (pages are pre-built and committed). Azure adds its own deploy
   workflow alongside `build-check`.
3. **App settings** on the SWA: `COSMOS_CONNECTION_STRING` (or
   `COSMOS_ENDPOINT` + `COSMOS_KEY`).
4. Smoke test: open the composer on the SWA URL, Try a sample → Share →
   the copied `/b/{id}` link plays in a fresh browser.

Stored documents are `{ id, formatVersion: 1, visibility: 'unlisted',
story, createdAt }` — the semantic story, not compiled layout, so the
viewer always renders with the current compiler. The validator rebuilds a
clean copy field-by-field (unknown fields dropped, strings capped, ≤12
cards, ≤64 KB) since this is an open write endpoint until accounts exist.

## Spike checklist (do these before building on Foundry)

1. **Foundry model availability** — is `claude-opus-4-8` deployable in your
   credit region? Which regions offer it?
2. **Structured outputs via Foundry** — the composer depends on
   `output_config.format` JSON schema. Verify the beta passes it through.
3. **Web search tool via Foundry** — server-side tools may lag the
   first-party API. If unavailable: fall back to Anthropic API direct for
   the search-augmented path (still server-side, just not credit-funded).
4. **gpt-image-1 quota** — Azure OpenAI image models are region-gated and
   quota-requested; confirm portrait sizes and per-minute limits.
5. **Content Safety latency** — must sit inline in `/generate` without
   noticeable drag (~100ms expected).

If (2) fails, the fallback is prompt-enforced JSON + a repair pass — the
compiler already tolerates missing fields, but schema enforcement is much
preferred.

## Phased roadmap

1. **✅ Shared runtime + real build** — `src/` modules, `build.py`, CI
   drift guard. Ends copy-paste divergence.
2. **✅ (code) Persistence + share links** — `api/` Functions
   (`POST /api/books` validates + stores the *story* JSON, `GET
   /api/books/{id}` serves it), `/b/{id}` viewer page that recompiles with
   the current layouts, Share button in the composer,
   `staticwebapp.config.json`. Needs the Azure deploy below to go live;
   until then GitHub Pages keeps working and Share degrades gracefully.
3. **Server-side generation** — `/api/generate` on Foundry; remove the
   BYO-key UI; per-IP rate limit; App Insights metering.
4. **Gallery** — publish flow, Content Safety gate, `/api/gallery` feed,
   live mini-render thumbnails.
5. **Images + search** — Durable fan-out to gpt-image-1, progressive
   placeholder upgrade, web search grounding for business/place stories.
6. **Accounts + tiers (parked)** — APIM subscriptions; revisit the key/auth
   question here.
