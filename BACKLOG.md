# BOOK — Backlog

The product thesis: **AI-first, not AI-only.** Generation is the magic
door; hand authoring is a full peer. Every feature below should serve
one of the two loops — *tell it → book it → share it* or *write it →
shape it → share it* — or harden the platform underneath them.

Ordered within each section by leverage. Items marked ⚙ need an Azure
resource or setting the code can't create for itself.

## 1 · AI-first authoring (the flagship gap)

The editor is pure-manual today. The novel move is AI *inside* the
authoring loop, not just in front of it:

- **Page copilot** — a ✨ action on each field/page in the editor:
  "tighten this title", "write the body from these notes", "make it
  warmer". One short `/api/assist` endpoint (same Claude plumbing,
  small effort ceiling, field-scoped prompts). The single highest-value
  item on this list.
- **Write the next page** — from the book so far, propose the next card
  (type, copy, layout, scene) as a draft the author keeps or discards.
- **Art-direct for me** — one tap re-runs layout/hue/scene briefs across
  the whole book without touching the words (the compiler already
  separates the two).
- **Regenerate one page** in the composer's player — keep the book,
  reroll a single weak card in place.
- **Interview mode** — for occasions (birthday, wedding, launch): three
  or four questions, then a full draft book lands in the editor.
- **Style presets** — curated `style` lines + palette families ("35mm
  memoir", "field notes", "neon zine") as one-tap chips in the editor
  and as hints to generation.

## 2 · Consumption & novel experience

- **Reader's own photos** — upload into image slots (requires Blob
  storage, §4); AI tone-maps and art-directs around them. Personal
  stories with real faces is the emotional unlock generation can't fake.
- **Read-aloud** — per-page TTS narration with the page-turn synced to
  the voice; books become bedtime-story-able.
- **Remix lineage** — a remixed book keeps a `parentId`; the library can
  show family trees, and authors see their book's descendants.
- **Animated link previews** — bpage serves a tiny looping cover video
  (or animated SVG) for OG unfurls; the share card becomes the hook.
- **Print/PDF export** — compile the 640×910 canvas to a printable zine;
  the colophon already reads like a private-press imprint.
- **Library shelves** — search, tags (occasions, places), a curated
  front shelf; "books near me" from map cards.
- **View counts for sharers** — a privacy-light per-book counter shown
  only to whoever holds the share link.
- **Offline authoring PWA** — drafts are already local; a service worker
  makes the editor work on a plane.

## 3 · Security (pre-accounts posture)

- ⚙ **Stand up Azure Content Safety** — the gate is wired at create and
  publish (fails open at create, closed at publish) but dormant until
  `CONTENT_SAFETY_ENDPOINT`/`CONTENT_SAFETY_KEY` exist. Do this before
  any wide sharing.
- **Report-this-book** — a small flag endpoint + `reported` mark that
  unlists a book after N distinct reports pending review. The only
  moderation that works after publication.
- **Durable rate limiting** — today's per-IP maps are per-instance and
  reset on recycle; the daily budget breakers (shipped) cap total spend,
  but per-IP counters in Cosmos (sliding window) would stop single-actor
  hammering across instance scale-out.
- **Product-card link hygiene** — external `url`s already pass a scheme
  whitelist; add a leaving-interstitial or visible domain on the button
  so `/b/` links can't impersonate trusted destinations invisibly.
- **CSP headers** — `staticwebapp.config.json` can send a strict
  `Content-Security-Policy` (pages are self-contained; `script-src
  'unsafe-inline'` is required by the inline architecture, but
  `connect-src`/`frame-ancestors`/`object-src` can all be locked).
- **Error-detail hygiene** — `/api/generate` returns upstream `detail`
  for debuggability; gate it behind `DEBUG_ERRORS=1` once things are
  stable.
- Later, with accounts: signed edit/claim tokens per book, per-user
  quotas, delete-my-book.

## 4 · Scalability (hundreds → thousands)

- **Images out of Cosmos, into Blob + CDN** — the single biggest lever.
  Today each image view is a point-read of a ~300KB Cosmos doc (RU cost
  scales with size); at thousands of readers this is the RU bill. Write
  webp to Blob storage (the Function App already owns a storage
  account), serve via CDN/Front Door with the same immutable cache
  headers, keep `/api/images/{id}` as a 301 for old books.
- **Server-side image fan-out** — replace the client loop with a queue:
  book create enqueues its slots; a Flex queue-triggered worker paints
  them (no browser babysitting, natural retry, per-queue concurrency
  control). The viewer keeps its polling as pickup.
- **Cosmos autoscale + composite index** — autoscale RU on the
  container; add a composite index on `(visibility, publishedAt DESC)`
  for the library query so it stays cheap as the shelf grows.
- **Cache the HTML** — pages are immutable per deploy; add
  `cache-control` route headers (short max-age + must-revalidate) like
  fonts.css got.
- **App Insights dashboards + alerts** ⚙ — the long host already has
  App Insights; add alerts on 5xx rate, image 502s, and daily budget
  trips so cost problems page a human.
- **bpage memoization** — link unfurls re-read the book per crawler hit;
  a 60s in-memory memo flattens crawler storms on a viral link.

## 5 · Code health

- **Browser suites in CI** — `test/browser/` (shipped) needs a GitHub
  Actions job: `npx playwright install chromium` + run both suites on
  PRs, so the ~85 checks gate merges instead of relying on the session
  driver.
- **Editor undo depth** — single-step undo shipped; a small action stack
  (10 deep, covering moves and type changes too) is the natural next.
- **Quote lines inline editing** — the stage edits simple fields
  in place; lines+attribution need a per-line split to join them.
- **Shared fan-out module** — composer/viewer/editor each carry a
  variant of the image fan-out loop; extract to `chrome.js` like the
  sheet was.
- **Retire `OPEN`/legacy wrap components** from runtime once no stored
  books reference them (audit the container first).
