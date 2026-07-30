/* Headless verification against the built pages (file://, mocked API).
 * Run from anywhere:  node test/browser/verify-images.mjs
 * Env overrides:
 *   BOOK_ROOT        repo root (default: two dirs up from this file)
 *   CHROME_BIN       chromium executable
 *   PLAYWRIGHT_CORE  playwright-core index.mjs */
const ROOT = (process.env.BOOK_ROOT || new URL('../..', import.meta.url).pathname).replace(/\/$/, '');
const BASE = 'file://' + ROOT;
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || '/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.mjs');
const results = [];
const ok = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) process.exitCode = 1;
};
const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];

/* on phone-width viewports the actions live in the pull-up sheet — swipe up on the book */
async function openActions(page) {
  const phone = await page.evaluate(() =>
    matchMedia('(max-width: 640px), (hover: none) and (pointer: coarse)').matches);
  if (!phone) return;
  const s = await page.locator('#screen').boundingBox();
  const x = s.x + s.width / 2, y = s.y + s.height * 0.66;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 100, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(350);
}

/* the sample button is gone — open the sample by mocking hosted generation.
 * The route must exist before goto: interception enabled pre-navigation is
 * what lets a file:// page fetch '/api/...' at all. */
async function openSample(page) {
  let sample = null;
  await page.route('**/api/generate', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ story: sample }) }));
  await page.goto(BASE + '/index.html');
  sample = await page.evaluate(() => BookCompiler.SAMPLE);
  await page.fill('#storyInput', 'a summer on a lighthouse island');
  await page.click('#generateBtn');
}

// 1×1 webp-ish: actually serve a tiny PNG with webp content-type — browsers sniff fine for <img>
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/* ---------- composer: share → imageSlots fan-out → placeholders upgrade ---------- */
const c = await browser.newPage({ viewport: { width: 420, height: 840 } });
c.on('pageerror', e => errors.push('composer: ' + e.message));

const imagePosts = [];
await c.route('**/api/books', route => route.fulfill({
  status: 201, contentType: 'application/json',
  body: JSON.stringify({ id: 'XyZ123AbCd45', imageSlots: ['0', '1', '2.0', '2.1', '2.2', '3'] }),
}));
await c.route('**/api/books/*/images', async route => {
  const body = route.request().postDataJSON();
  imagePosts.push(body.slot);
  await route.fulfill({ status: 201, contentType: 'application/json',
    body: JSON.stringify({ slot: body.slot, url: '/api/images/Img' + body.slot.replace('.', 'x') + 'aaaaaaaa' }) });
});
await c.route('**/api/images/*', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }));

await openSample(c);
await c.waitForTimeout(400);
await openActions(c);
await c.click('#shareBtn');
await c.waitForTimeout(400);
// mocked routes resolve instantly, so the note may already have flipped to done
ok('composer: toast shows image progress note', /Painting the pictures|pictures are in/.test(await c.locator('#shareToast').innerText()));

// wait for the sequential fan-out to finish (6 slots)
await c.waitForFunction(() => {
  const n = document.getElementById('imgNote');
  return n && n.textContent.includes('pictures are in');
}, null, { timeout: 8000 });
ok('composer: fan-out hit every slot in order', imagePosts.join(',') === '0,1,2.0,2.1,2.2,3', imagePosts.join(','));

const up = await c.evaluate(() => {
  const cover = document.querySelector('[data-slot="0"]');
  const img = cover && cover.querySelector('.img-real');
  const g0 = document.querySelector('[data-slot="2.0"] .img-real');
  return {
    coverImg: !!img,
    coverSrc: img ? img.getAttribute('src') : '',
    coverLoaded: img ? img.classList.contains('loaded') : false,
    galleryImg: !!g0,
    phStill: !!cover.querySelector('.img-ph'), // placeholder stays underneath
  };
});
ok('composer: cover placeholder got a real image', up.coverImg && up.coverSrc.startsWith('/api/images/'), up.coverSrc);
ok('composer: image faded in (loaded class)', up.coverLoaded);
ok('composer: gallery item upgraded too', up.galleryImg);
ok('composer: duotone placeholder kept underneath', up.phStill);

/* ---------- composer: provider not configured → 503 stops quietly ---------- */
const c2 = await browser.newPage({ viewport: { width: 420, height: 840 } });
c2.on('pageerror', e => errors.push('composer-503: ' + e.message));
let posts503 = 0;
await c2.route('**/api/books', route => route.fulfill({
  status: 201, contentType: 'application/json',
  body: JSON.stringify({ id: 'XyZ123AbCd45', imageSlots: ['0', '1'] }),
}));
await c2.route('**/api/books/*/images', route => {
  posts503++;
  route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"NOT_CONFIGURED"}' });
});
await openSample(c2);
await c2.waitForTimeout(400);
await openActions(c2);
await c2.click('#shareBtn');
await c2.waitForTimeout(800);
ok('composer: 503 stops fan-out after first call', posts503 === 1, String(posts503));
ok('composer: painting note removed on 503', await c2.evaluate(() => !document.getElementById('imgNote')));
ok('composer: share link still shown', (await c2.locator('#shareToast').innerText()).includes('/b/XyZ123AbCd45'));
ok('composer: no leftover placeholder damage', await c2.evaluate(() => !!document.querySelector('[data-slot="0"] .img-ph')));

/* ---------- viewer: stored urls render as images ---------- */
const STORY = {
  name: 'Shelf Book',
  cards: [
    { type: 'cover', title: 'Shelf Book', kicker: 'x', image: { h1: 20, h2: 60, label: 'x', url: '/api/images/AbCdEfGh1234' } },
    { type: 'prose', title: 'P', body: 'b', image: { h1: 20, h2: 60, label: 'y' } },
  ],
};
const v = await browser.newPage({ viewport: { width: 390, height: 844 } });
v.on('pageerror', e => errors.push('viewer: ' + e.message));
await v.route('**/api/images/*', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }));
await v.route('**/api/books/*', route => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ id: 'AbCdEfGh1234', formatVersion: 1, story: STORY, createdAt: 'x' }) }));
await v.goto(BASE + '/b.html?id=AbCdEfGh1234');
await v.waitForTimeout(700);
const vw = await v.evaluate(() => {
  const withUrl = document.querySelector('[data-slot="0"] .img-real');
  const withoutUrl = document.querySelector('[data-slot="1"] .img-real');
  return { has: !!withUrl, src: withUrl && withUrl.getAttribute('src'), none: !withoutUrl };
});
ok('viewer: stored url renders an image', vw.has && vw.src === '/api/images/AbCdEfGh1234', String(vw.src));
ok('viewer: url-less slot keeps its duotone', vw.none);

/* ---------- viewer: polls for late-arriving pictures ---------- */
const vp = await browser.newPage({ viewport: { width: 390, height: 844 } });
vp.on('pageerror', e => errors.push('viewer-poll: ' + e.message));
await vp.addInitScript(() => { window.BOOK_IMG_POLL_MS = 150; });
let bookReads = 0;
// every slot eventually painted — otherwise the poller rightly keeps waiting
const DONE = JSON.parse(JSON.stringify(STORY));
DONE.cards[1].image.url = '/api/images/BcDeFgHi2345';
const LATE = JSON.parse(JSON.stringify(DONE));
delete LATE.cards[0].image.url; // cover starts unpainted
await vp.route('**/api/images/*', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }));
await vp.route('**/api/books/*', route => {
  bookReads++;
  // first two reads: cover not painted yet; third onward: complete
  const story = bookReads >= 3 ? DONE : LATE;
  route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: 'AbCdEfGh1234', formatVersion: 1, story, createdAt: 'x' }) });
});
await vp.goto(BASE + '/b.html?id=AbCdEfGh1234');
await vp.waitForTimeout(300);
ok('viewer-poll: starts as placeholder', await vp.evaluate(() => !document.querySelector('[data-slot="0"] .img-real')));
await vp.waitForFunction(() => !!document.querySelector('[data-slot="0"] .img-real'), null, { timeout: 5000 });
ok('viewer-poll: late picture fades in', await vp.evaluate(() => {
  const img = document.querySelector('[data-slot="0"] .img-real');
  return img && img.getAttribute('src') === '/api/images/AbCdEfGh1234';
}));
const readsWhenDone = bookReads;
await vp.waitForTimeout(600);
ok('viewer-poll: polling stops once complete', bookReads === readsWhenDone, `${bookReads} vs ${readsWhenDone}`);

/* ---------- viewer: actively finishes missing pictures (sharer navigated away) ---------- */
const vf = await browser.newPage({ viewport: { width: 390, height: 844 } });
vf.on('pageerror', e => errors.push('viewer-fanout: ' + e.message));
await vf.addInitScript(() => { window.BOOK_IMG_POLL_MS = 60000; }); // polling can't be the mechanism
const HALF = JSON.parse(JSON.stringify(STORY));
delete HALF.cards[0].image.url; // nothing painted yet
const fanPosts = [];
await vf.route('**/api/images/*', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }));
await vf.route('**/api/books/*/images', async route => {
  const body = route.request().postDataJSON();
  fanPosts.push(body.slot);
  await route.fulfill({ status: 201, contentType: 'application/json',
    body: JSON.stringify({ slot: body.slot, url: '/api/images/Fan' + body.slot.replace('.', 'x') + 'aaaaaaaa' }) });
});
await vf.route('**/api/books/*', route => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ id: 'AbCdEfGh1234', formatVersion: 1, story: HALF, createdAt: 'x' }) }));
await vf.goto(BASE + '/b.html?id=AbCdEfGh1234');
await vf.waitForFunction(() => !!document.querySelector('[data-slot="0"] .img-real'), null, { timeout: 5000 });
ok('viewer-fanout: missing pictures are requested and attached', await vf.evaluate(() =>
  document.querySelector('[data-slot="0"] .img-real').getAttribute('src').startsWith('/api/images/Fan')));
ok('viewer-fanout: every missing slot got a POST', fanPosts.includes('0') && fanPosts.includes('1'), fanPosts.join(','));

/* ---------- motion flags gate each behavior independently ---------- */
ok('motion: flags on by default (kb/settle/par classes)', await v.evaluate(() => {
  const cl = document.getElementById('screen').classList;
  return cl.contains('m-kb') && cl.contains('m-settle') && cl.contains('m-par');
}));
ok('motion: current card photo runs Ken Burns', await v.evaluate(() => {
  const img = document.querySelector('.card.current .img-real.loaded');
  return img && getComputedStyle(img).animationName === 'kenBurns';
}));
ok('motion: tone-map overlay tints the loaded photo', await v.evaluate(() => {
  const tone = document.querySelector('[data-slot="0"] .img-tone');
  return tone && parseFloat(getComputedStyle(tone).opacity) > 0.1;
}));
const vOff = await browser.newPage({ viewport: { width: 390, height: 844 } });
vOff.on('pageerror', e => errors.push('motion-off: ' + e.message));
await vOff.addInitScript(() => { window.BOOK_MOTION = { kenBurns: false, settle: true, parallax: false, haptics: false }; });
await vOff.route('**/api/books/*', route => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ id: 'AbCdEfGh1234', formatVersion: 1, story: STORY, createdAt: 'x' }) }));
await vOff.goto(BASE + '/b.html?id=AbCdEfGh1234');
await vOff.waitForTimeout(500);
ok('motion: individual flags switch off cleanly', await vOff.evaluate(() => {
  const cl = document.getElementById('screen').classList;
  return !cl.contains('m-kb') && cl.contains('m-settle') && !cl.contains('m-par');
}));

/* ---------- unsafe urls never become img src ---------- */
const u = await browser.newPage({ viewport: { width: 390, height: 844 } });
u.on('pageerror', e => errors.push('unsafe: ' + e.message));
const BAD = { name: 'Bad', cards: [
  { type: 'cover', title: 'Bad', image: { h1: 1, h2: 2, label: 'x', url: 'javascript:alert(1)' } },
  { type: 'prose', title: 'B', body: 'b', image: { h1: 1, h2: 2, label: 'y', url: 'http://evil.example/x.png' } },
]};
await u.route('**/api/books/*', route => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ id: 'AbCdEfGh1234', formatVersion: 1, story: BAD, createdAt: 'x' }) }));
await u.goto(BASE + '/b.html?id=AbCdEfGh1234');
await u.waitForTimeout(700);
ok('unsafe urls stay placeholders', await u.evaluate(() => document.querySelectorAll('.img-real').length === 0));

/* ---------- library thumbnails pick up cover images ---------- */
const l = await browser.newPage({ viewport: { width: 1100, height: 900 } });
l.on('pageerror', e => errors.push('library: ' + e.message));
await l.route('**/api/images/*', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }));
await l.route('**/api/library**', route => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ books: [{ id: 'Book1aaaaaaa', story: STORY, publishedAt: '2026-07-10T01:00:00Z' }], hasMore: false }) }));
await l.goto(BASE + '/library.html');
await l.waitForTimeout(700);
ok('library: thumbnail renders the cover image', await l.evaluate(() => {
  const img = document.querySelector('.thumb .img-real');
  return !!img && img.getAttribute('src') === '/api/images/AbCdEfGh1234';
}));

ok('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
console.log(results.join('\n'));
await browser.close();
