/* Headless verification against the built pages (file://, mocked API).
 * Run from anywhere:  node test/browser/verify-canvas.mjs
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

/* ---------- adaptive canvas on a modern phone (390×844) ---------- */
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.on('pageerror', e => errors.push('phone: ' + e.message));
await openSample(m);
await m.waitForTimeout(500);

const H = Math.round(640 * 844 / 390); // 1385, inside [910,1390]
const c1 = await m.evaluate(() => {
  const s = document.getElementById('screen');
  const cv = document.querySelector('.canvas');
  const cover = document.querySelectorAll('.card')[0];
  const titleBox = [...cover.querySelectorAll('.cmp')].find(el => el.textContent.includes('The Lighthouse Summer'));
  const img = cover.querySelector('.cmp-image');
  return {
    varH: getComputedStyle(s).getPropertyValue('--canvas-h').trim(),
    cvH: cv.getBoundingClientRect().height / parseFloat(cv.style.transform.match(/scale\(([\d.]+)\)/)[1]),
    top: parseFloat(cv.style.top),
    titleTop: parseInt(titleBox.style.top),
    imgH: parseInt(img.style.height),
    sw: s.clientWidth, sh: s.clientHeight, iw: innerWidth, ih: innerHeight,
  };
});
ok('phone: canvas height follows aspect', c1.varH === H + 'px', `${c1.varH} vs ${H}px`);
ok('phone: canvas element is that tall', Math.abs(c1.cvH - H) < 2, String(c1.cvH));
ok('phone: no fill band left (top ≈ 0)', c1.top < 3, String(c1.top));
ok('phone: cover photo is full-bleed', c1.imgH === H, `${c1.imgH} vs ${H}`);
// bottom-anchored: headline designed at 590 on 910 → H-320 band (plus size compensation ≤ 80)
const band = H - 320;
ok('phone: cover headline anchored to bottom band', c1.titleTop >= band - 2 && c1.titleTop <= band + 82, `top=${c1.titleTop} band=${band}`);

// vertical scrolling retired: the gallery flattens into one flip card per moment
const flat = await m.evaluate(() => ({
  cards: document.querySelectorAll('.card').length,
  scrollers: document.querySelectorAll('.cmp-gallery').length,
  itemSlot: !!document.querySelector('[data-slot="2.1"]'),
}));
// sample: cover + prose + 3 gallery moments + quote + map + end card = 8
ok('phone: gallery flattens to flip cards', flat.cards === 8 && flat.scrollers === 0 && flat.itemSlot,
  JSON.stringify(flat));

/* ---------- desktop keeps the classic 910 exactly ---------- */
const d = await browser.newPage({ viewport: { width: 1280, height: 800 } });
d.on('pageerror', e => errors.push('desktop: ' + e.message));
await openSample(d);
await d.waitForTimeout(500);
const c2 = await d.evaluate(() => {
  const s = document.getElementById('screen');
  const cover = document.querySelectorAll('.card')[0];
  const titleBox = [...cover.querySelectorAll('.cmp')].find(el => el.textContent.includes('The Lighthouse Summer'));
  return { varH: getComputedStyle(s).getPropertyValue('--canvas-h').trim(), titleTop: parseInt(titleBox.style.top) };
});
ok('desktop: classic 910 canvas', c2.varH === '910px', c2.varH);
ok('desktop: headline at legacy 590 band', c2.titleTop >= 590 - 2 && c2.titleTop <= 590 + 82, String(c2.titleTop));

/* ---------- library page (renamed) ---------- */
const STORY = { name: 'Shelf Book', cards: [
  { type: 'cover', title: 'Shelf Book', kicker: 'on the shelf', image: { h1: 20, h2: 60, label: 'x' } },
] };
const l = await browser.newPage({ viewport: { width: 1100, height: 900 } });
l.on('pageerror', e => errors.push('library: ' + e.message));
let feedUrl = null;
await l.route('**/api/library**', route => {
  feedUrl = route.request().url();
  route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ books: [{ id: 'Book1aaaaaaa', story: STORY, publishedAt: '2026-07-10T01:00:00Z' }], hasMore: false }) });
});
await l.goto(BASE + '/library.html');
await l.waitForTimeout(500);
ok('library: fetches /api/library', !!feedUrl && feedUrl.includes('/api/library'));
ok('library: heading says The Library.', (await l.locator('.hero h1').innerText()) === 'The Library.');
ok('library: tile renders plus the sample seed', (await l.locator('.tile').count()) === 2);
ok('library: sample tile is last and labeled', await l.evaluate(() => {
  const tiles = document.querySelectorAll('.tile');
  const last = tiles[tiles.length - 1];
  return last.id === 'sampleTile' &&
    last.getAttribute('href') === 'b.html?id=sample' &&
    last.querySelector('.tile-date').textContent === 'The sample book';
}));
ok('library: thumbs pinned to 910 aspect', await l.evaluate(() => {
  const t = document.querySelector('.thumb');
  return Math.abs(t.clientHeight / t.clientWidth - 910 / 640) < 0.02;
}));

/* ---------- composer publish copy + nav ---------- */
const c = await browser.newPage({ viewport: { width: 420, height: 840 } });
c.on('pageerror', e => errors.push('composer: ' + e.message));
await c.route('**/api/books', route => route.fulfill({ status: 201, contentType: 'application/json', body: '{"id":"XyZ123AbCd45"}' }));
await c.route('**/api/books/*/publish', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"XyZ123AbCd45","visibility":"published"}' }));
await c.goto(BASE + '/index.html');
ok('composer: sample button and key input removed', await c.evaluate(() =>
  !document.getElementById('sampleBtn') && !document.getElementById('keyInput') && !document.getElementById('keyDetails')));
ok('composer: nav has single Library link', await c.evaluate(() => {
  const links = [...document.querySelectorAll('.masthead nav a')];
  return links.length === 1 && links[0].getAttribute('href') === 'library.html' && links[0].textContent === 'Library';
}));
await openSample(c);
await c.waitForTimeout(400);
await openActions(c);
await c.click('#shareBtn');
await c.waitForTimeout(400);
ok('composer: toast says Add to the library', (await c.locator('#galleryBtn').innerText()).toLowerCase() === 'add to the library');
await c.click('#galleryBtn');
await c.waitForTimeout(400);
ok('composer: success says on the shelf', (await c.locator('#shareToast').innerText()).includes('On the shelf'));

/* ---------- viewer compiles adaptively ---------- */
const v = await browser.newPage({ viewport: { width: 390, height: 844 } });
v.on('pageerror', e => errors.push('viewer: ' + e.message));
await v.route('**/api/books/*', route => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ id: 'AbCdEfGh1234', formatVersion: 1, story: STORY, createdAt: 'x' }) }));
await v.goto(BASE + '/b.html?id=AbCdEfGh1234');
await v.waitForTimeout(600);
ok('viewer: adaptive canvas var set', (await v.evaluate(() =>
  getComputedStyle(document.getElementById('screen')).getPropertyValue('--canvas-h').trim())) === H + 'px');

/* ---------- composer: + Library saves (share + publish) in one tap ---------- */
const c3 = await browser.newPage({ viewport: { width: 420, height: 840 } });
c3.on('pageerror', e => errors.push('libBtn: ' + e.message));
let created = 0, published = 0;
await c3.route('**/api/books', route => { created++; route.fulfill({ status: 201, contentType: 'application/json', body: '{"id":"XyZ123AbCd45","imageSlots":[]}' }); });
await c3.route('**/api/books/*/publish', route => { published++; route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"XyZ123AbCd45","visibility":"published"}' }); });
await openSample(c3);
await c3.waitForTimeout(400);
ok('loading overlay is a fixed full-page dim', await c3.evaluate(() => {
  const cs = getComputedStyle(document.getElementById('loading'));
  return cs.position === 'fixed' && cs.inset === '0px';
}));
await openActions(c3);
await c3.click('#libBtn');
await c3.waitForTimeout(400);
ok('libBtn: one tap creates and publishes', created === 1 && published === 1, `created=${created} published=${published}`);
ok('libBtn: toast says on the shelf', (await c3.locator('#shareToast').innerText()).includes('On the shelf'));
await openActions(c3);
await c3.click('#shareBtn');
await c3.waitForTimeout(400);
ok('libBtn then share reuses the same book', created === 1, String(created));
ok('share after save still shows the link', (await c3.locator('#shareToast').innerText()).includes('/b/XyZ123AbCd45'));

/* ---------- mobile player chrome: sheet + no chevrons ---------- */
ok('mobile: chevrons hidden', await c3.evaluate(() =>
  getComputedStyle(document.getElementById('nextBtn')).display === 'none'));
ok('mobile: action sheet closed after use', await c3.evaluate(() =>
  !document.getElementById('chromeBar').classList.contains('open')));
await openActions(c3);
ok('mobile: sheet opens with all four actions', await c3.evaluate(() => {
  const bar = document.getElementById('chromeBar');
  const visible = (id) => document.getElementById(id).getBoundingClientRect().height > 0;
  return bar.classList.contains('open') && visible('shareBtn') && visible('libBtn') &&
    visible('regenBtn') && visible('backBtn');
}));
// swipe the open sheet down ~120px → it dismisses
{
  const bar = await c3.locator('#chromeBar').boundingBox();
  await c3.mouse.move(bar.x + bar.width / 2, bar.y + 12);
  await c3.mouse.down();
  for (let i = 1; i <= 6; i++) await c3.mouse.move(bar.x + bar.width / 2, bar.y + 12 + i * 20);
  await c3.mouse.up();
  await c3.waitForTimeout(350);
}
ok('mobile: swiping the sheet down dismisses it', await c3.evaluate(() =>
  !document.getElementById('chromeBar').classList.contains('open')));
// swipe up on the book → it opens (no ⋯ handle anymore)
ok('mobile: the ⋯ toggle is gone', await c3.evaluate(() => !document.getElementById('chromeToggle')));
await openActions(c3);
ok('mobile: swiping up on the book opens the sheet', await c3.evaluate(() =>
  document.getElementById('chromeBar').classList.contains('open')));
ok('mobile: open sheet pushes the book back and locks it', await c3.evaluate(() => {
  const receded = document.getElementById('screen').classList.contains('sheet-open');
  const t = getComputedStyle(document.querySelector('.card-container')).transform;
  return receded && t !== 'none';
}));
// the dimmed book is a scrim — tapping it dismisses without flipping
const cardBefore = await c3.evaluate(() => document.querySelectorAll('.card.turned').length);
await c3.mouse.click(210, 200);
await c3.waitForTimeout(350);
ok('mobile: tapping the book dismisses the sheet, no flip', await c3.evaluate((n) =>
  !document.getElementById('chromeBar').classList.contains('open') &&
  !document.getElementById('screen').classList.contains('sheet-open') &&
  document.querySelectorAll('.card.turned').length === n, cardBefore));

/* ---------- map card: the full-bleed link must still flip ---------- */
const mapIdx = await c3.evaluate(() =>
  [...document.querySelectorAll('.card')].findIndex(el => el.querySelector('.cmp-map')));
ok('map card exists in the sample', mapIdx > 0, String(mapIdx));
for (let i = 0; i < mapIdx; i++) { await c3.click('#tapRight'); await c3.waitForTimeout(460); }
ok('map card reached', await c3.evaluate((i) =>
  document.querySelectorAll('.card')[i].classList.contains('current'), mapIdx));
{
  const s = await c3.locator('#screen').boundingBox();
  const y = s.y + s.height / 2;
  await c3.mouse.move(s.x + s.width * 0.72, y);
  await c3.mouse.down();
  await c3.mouse.move(s.x + s.width * 0.72 - 150, y, { steps: 6 });
  await c3.mouse.up();
  await c3.waitForTimeout(420);
}
ok('mobile: horizontal swipe on the map card flips the page', await c3.evaluate((i) =>
  document.querySelectorAll('.card')[i].classList.contains('turned'), mapIdx));
ok('map link is not natively draggable', await c3.evaluate(() =>
  document.querySelector('.cmp-map').draggable === false));

/* ---------- last page: the sheet presents itself ---------- */
{
  const total = await c3.evaluate(() => document.querySelectorAll('.card').length);
  for (let p = mapIdx + 1; p < total - 1; p++) { await c3.click('#tapRight'); await c3.waitForTimeout(460); }
}
ok('mobile: sheet auto-opens on the last page', await c3.evaluate(() =>
  document.getElementById('chromeBar').classList.contains('open')));

const dsk = await browser.newPage({ viewport: { width: 1280, height: 800 } });
dsk.on('pageerror', e => errors.push('desktop-chrome: ' + e.message));
await openSample(dsk);
await dsk.waitForTimeout(400);
ok('desktop: chevron visible, no toggle, pills in corners', await dsk.evaluate(() => {
  const next = document.getElementById('nextBtn');
  const share = document.getElementById('shareBtn').getBoundingClientRect();
  return getComputedStyle(next).display !== 'none' &&
    !document.getElementById('chromeToggle') &&
    share.top < 60 && share.height > 0;
}));

/* ---------- type-only ink pages: image:null renders no placeholder ---------- */
const inkPage = await m.evaluate(() => {
  const cards = [...document.querySelectorAll('.card')];
  const quote = cards.find(c => c.textContent.includes('Patience, patience'));
  return {
    noImage: quote && !quote.querySelector('.cmp-image') && !quote.querySelector('.img-ph'),
    noScrim: quote && !quote.querySelector('.cmp-veil') && !quote.querySelector('.cmp-gradation'),
    inkBg: quote && /rgb|hsl/.test(quote.style.background), // browsers may re-serialize hsl() as rgb()
  };
});
ok('ink page: sample quote has no image placeholder', inkPage.noImage);
ok('ink page: no scrim on type-only pages', inkPage.noScrim);
ok('ink page: solid ink background in book hue', inkPage.inkBg);

/* ---------- undirected cards get varied, stable seeded layouts ---------- */
const seeded = await dsk.evaluate(() => {
  const story = (n) => ({ name: n, cards: [
    { type: 'cover', title: 'T', image: { h1: 20, h2: 40, label: 'x' } },
    { type: 'prose', title: 'One', body: 'First beat of the story, told plainly and at some length so it reads real.', image: { h1: 20, h2: 40, label: 'x' } },
    { type: 'prose', title: 'Two', body: 'Second beat of the story, told plainly and at some length so it reads real.', image: { h1: 20, h2: 40, label: 'x' } },
    { type: 'prose', title: 'Three', body: 'Third beat of the story, told plainly and at some length so it reads real.', image: { h1: 20, h2: 40, label: 'x' } },
  ]});
  // fingerprint = each prose card's title top + text-align
  const fp = (name) => BookCompiler.compileBook(story(name), { height: 910 }).cards.slice(1, 4)
    .map(card => {
      const boxes = card.k.filter(nd => nd.t === 'textbox');
      return boxes.map(b => b.css.top + '/' + b.css['text-align']).join('|');
    });
  const a = fp('A Quiet Book'), a2 = fp('A Quiet Book'), b = fp('Some Other Name');
  return {
    stable: JSON.stringify(a) === JSON.stringify(a2),
    neighborsDiffer: a[0] !== a[1] && a[1] !== a[2],
    booksDiffer: JSON.stringify(a) !== JSON.stringify(b),
  };
});
ok('seeded layouts: same book compiles identically', seeded.stable);
ok('seeded layouts: consecutive undirected cards differ', seeded.neighborsDiffer);
ok('seeded layouts: different books get different walks', seeded.booksDiffer);

/* ---------- viewer: ?id=sample plays the built-in sample, no API ---------- */
const vs = await browser.newPage({ viewport: { width: 390, height: 844 } });
vs.on('pageerror', e => errors.push('sample-viewer: ' + e.message));
let sampleFetched = false;
await vs.route('**/api/**', route => { sampleFetched = true; route.fulfill({ status: 500, body: '{}' }); });
await vs.goto(BASE + '/b.html?id=sample');
await vs.waitForTimeout(500);
ok('sample viewer: plays without any API call', !sampleFetched);
ok('sample viewer: lighthouse sample loaded', await vs.evaluate(() =>
  document.body.textContent.includes('The Lighthouse Summer') &&
  document.querySelectorAll('.card').length > 3 &&
  document.getElementById('stateBox').hidden));

/* ---------- viewer: same pull-up sheet as the composer ---------- */
ok('viewer: chrome bar present, library save hidden for sample', await vs.evaluate(() =>
  !!document.getElementById('chromeBar') &&
  document.getElementById('libBtn').hidden &&
  !!document.getElementById('makeBtn') && !!document.getElementById('shareBtn')));
{
  const s = await vs.locator('#screen').boundingBox();
  const x = s.x + s.width / 2, y = s.y + s.height * 0.66;
  await vs.mouse.move(x, y);
  await vs.mouse.down();
  await vs.mouse.move(x, y - 100, { steps: 5 });
  await vs.mouse.up();
  await vs.waitForTimeout(350);
}
ok('viewer: swiping up opens the sheet', await vs.evaluate(() =>
  document.getElementById('chromeBar').classList.contains('open') &&
  document.getElementById('screen').classList.contains('sheet-open')));
await vs.mouse.click(195, 200);
await vs.waitForTimeout(350);
ok('viewer: tapping the book dismisses the sheet', await vs.evaluate(() =>
  !document.getElementById('chromeBar').classList.contains('open')));
// flip to the last page → the sheet presents itself
{
  const total = await vs.evaluate(() => document.querySelectorAll('.card').length);
  for (let p = 0; p < total - 1; p++) { await vs.click('#tapRight'); await vs.waitForTimeout(460); }
}
ok('viewer: sheet auto-opens on the last page', await vs.evaluate(() =>
  document.getElementById('chromeBar').classList.contains('open')));

/* ---------- editor: manual authoring ---------- */
const ed = await browser.newPage({ viewport: { width: 1280, height: 850 } });
ed.on('pageerror', e => errors.push('editor: ' + e.message));
await ed.route('**/api/books', route => route.fulfill({ status: 201, contentType: 'application/json', body: '{"id":"EdItOr123456","imageSlots":["0"]}' }));
let edImagePosts = 0;
await ed.route('**/api/books/*/images', route => { edImagePosts++; route.fulfill({ status: 201, contentType: 'application/json', body: '{"slot":"0","url":"/api/images/Fake12345678"}' }); });
await ed.goto(BASE + '/editor.html');
await ed.waitForTimeout(500);
ok('editor: starter book loads (cover + page + end + add)', await ed.evaluate(() =>
  document.querySelectorAll('.ed-thumb').length === 3 &&
  !!document.getElementById('addCard') &&
  document.querySelector('.ed-cardtitle').textContent.includes('Cover')));
ok('editor: stage previews the real compiled card', await ed.evaluate(() =>
  document.querySelector('#stageCard .canvas') &&
  document.getElementById('stageCard').textContent.includes('A New Book')));
// retitle the cover → the live preview follows
{
  const title = ed.locator('.ed-panel input[type="text"]').nth(1); // kicker, then title
  await title.fill('Sea Glass');
  await ed.waitForTimeout(400);
}
ok('editor: typing updates the preview', await ed.evaluate(() =>
  document.getElementById('stageCard').textContent.includes('Sea Glass')));
// add a quote page
await ed.click('#addCard');
await ed.waitForTimeout(100);
await ed.evaluate(() => [...document.querySelectorAll('.ed-typemenu button')].find(b => b.textContent === 'Quote').click());
await ed.waitForTimeout(400);
ok('editor: adding a page grows the rail and selects it', await ed.evaluate(() =>
  document.querySelectorAll('.ed-thumb').length === 4 &&
  document.querySelector('.ed-cardtitle').textContent.includes('Quote')));
// art direction: set the band
await ed.evaluate(() => [...document.querySelectorAll('.ed-seg button')].find(b => b.textContent === 'Bottom').click());
await ed.waitForTimeout(300);
ok('editor: layout control latches', await ed.evaluate(() =>
  [...document.querySelectorAll('.ed-seg button')].find(b => b.textContent === 'Bottom').classList.contains('on')));
// picture toggle: quote starts as ink page → flip to photograph
ok('editor: quote starts as an ink page', await ed.evaluate(() =>
  !![...document.querySelectorAll('.ed-seg button')].find(b => b.textContent.includes('Ink page') && b.classList.contains('on'))));
await ed.evaluate(() => [...document.querySelectorAll('.ed-seg button')].find(b => b.textContent === 'Photograph').click());
await ed.waitForTimeout(200);
ok('editor: photograph mode reveals the scene brief', await ed.evaluate(() =>
  document.body.textContent.includes('Scene — what the photograph shows')));
// full-book preview overlay
await ed.click('#previewBtn');
await ed.waitForTimeout(400);
ok('editor: preview overlay plays the whole book', await ed.evaluate(() =>
  !document.getElementById('previewOverlay').hidden &&
  document.querySelectorAll('#pvCards .card').length >= 4));
await ed.click('#pvClose');
// share stores the book and reports the link
await ed.click('#shareBtn');
await ed.waitForTimeout(500);
ok('editor: share posts the story and shows the link', await ed.evaluate(() =>
  document.getElementById('shareToast').textContent.includes('/b/EdItOr123456')));
ok('editor: share kicks the image fan-out', edImagePosts >= 1, String(edImagePosts));

/* ---------- players hand off to the editor ---------- */
ok('composer: sheet has an Edit action', await c3.evaluate(() => !!document.getElementById('editBtn')));
ok('viewer: sheet has a Remix action', await vs.evaluate(() => !!document.getElementById('remixBtn')));

/* ---------- editor: direct manipulation on the stage ---------- */
{
  await ed.evaluate(() => { document.querySelectorAll('.ed-thumb')[0].click(); }); // back to cover
  await ed.waitForTimeout(250);
  // click the title on the preview card → edits in place
  await ed.click('#stageCard [data-f="title"]');
  await ed.waitForTimeout(120);
  ok('stage: clicking a title starts in-place editing', await ed.evaluate(() =>
    !!document.querySelector('#stageCard [data-f="title"][contenteditable]')));
  await ed.keyboard.type(' Direct');
  await ed.waitForTimeout(350);
  ok('stage: in-place typing reaches the story and the panel field', await ed.evaluate(() => {
    const input = document.querySelector('[data-key="title"]');
    return input && input.value.endsWith('Direct');
  }));
  await ed.keyboard.press('Enter'); // commits
  await ed.waitForTimeout(350);
  ok('stage: commit restores typography (no contenteditable left)', await ed.evaluate(() =>
    !document.querySelector('#stageCard [contenteditable]') &&
    document.getElementById('stageCard').textContent.includes('Direct')));
  // clicking the photograph area jumps to the scene field
  await ed.click('#stageCard .cmp-image');
  await ed.waitForTimeout(250);
  ok('stage: clicking the photo focuses the scene field', await ed.evaluate(() =>
    document.activeElement === document.querySelector('[data-key="imageLabel"]')));
}

/* ---------- editor: delete a page, then undo ---------- */
{
  const before = await ed.evaluate(() => document.querySelectorAll('.ed-thumb').length);
  await ed.evaluate(() => { // select page 2 (a deletable one), then delete
    document.querySelectorAll('.ed-thumb')[1].click();
  });
  await ed.waitForTimeout(150);
  await ed.click('.ed-icon.danger');
  await ed.waitForTimeout(250);
  const afterDelete = await ed.evaluate(() => document.querySelectorAll('.ed-thumb').length);
  ok('editor: delete removes the page and offers undo', afterDelete === before - 1 &&
    await ed.evaluate(() => !!document.getElementById('undoDelete')));
  await ed.click('#undoDelete');
  await ed.waitForTimeout(250);
  ok('editor: undo restores the page', await ed.evaluate((n) =>
    document.querySelectorAll('.ed-thumb').length === n, before));
}

/* ---------- editor on a phone: live peek replaces the stage ---------- */
const edm = await browser.newPage({ viewport: { width: 390, height: 844 } });
edm.on('pageerror', e => errors.push('editor-mobile: ' + e.message));
await edm.goto(BASE + '/editor.html');
await edm.waitForTimeout(400);
ok('editor mobile: stage hidden, peek visible, preview button gone', await edm.evaluate(() => {
  const stage = document.querySelector('.ed-stage');
  const peek = document.getElementById('peekCard');
  return getComputedStyle(stage).display === 'none' &&
    peek.offsetWidth > 0 && !!peek.querySelector('.canvas') &&
    getComputedStyle(document.getElementById('previewBtn')).display === 'none';
}));
ok('editor mobile: inputs are 16px (no iOS focus zoom)', await edm.evaluate(() => {
  const input = document.querySelector('.ed-field input');
  return input && getComputedStyle(input).fontSize === '16px';
}));
await edm.fill('.ed-field input', 'Peek Check');
await edm.waitForTimeout(400);
ok('editor mobile: peek live-updates with edits', await edm.evaluate(() =>
  document.getElementById('peekCard').textContent.includes('Peek Check')));
await edm.click('#peekCard');
await edm.waitForTimeout(400);
ok('editor mobile: tapping the peek plays the book', await edm.evaluate(() =>
  !document.getElementById('previewOverlay').hidden &&
  document.querySelectorAll('#pvCards .card').length >= 3));

/* ---------- editor: maxlengths + gallery flattening (audit batch A) ---------- */
ok('editor: title field carries the API maxlength', await ed.evaluate(() => {
  const inputs = document.querySelectorAll('.ed-field input');
  return [...inputs].some(i => i.maxLength === 160);
}));
ok('editor: draft saved to localStorage', await ed.evaluate(() =>
  !!localStorage.getItem('book.editor.draft')));
// a legacy gallery story flattens into editable prose pages
const flatEd = await browser.newPage({ viewport: { width: 1200, height: 900 } });
flatEd.on('pageerror', e => errors.push('editor-flatten: ' + e.message));
await flatEd.addInitScript(() => {
  sessionStorage.setItem('book.edit', JSON.stringify({ name: 'Legacy', cards: [
    { type: 'cover', title: 'Legacy', image: { h1: 20, h2: 40, label: 'x' } },
    { type: 'gallery', items: [
      { title: 'One', body: 'b1', image: { h1: 10, h2: 30, label: 'y' } },
      { title: 'Two', body: 'b2', image: { h1: 50, h2: 70, label: 'z' } }
    ]}
  ]}));
});
await flatEd.goto(BASE + '/editor.html');
await flatEd.waitForTimeout(400);
ok('editor: legacy gallery flattens to prose pages', await flatEd.evaluate(() => {
  const draftless = JSON.parse(sessionStorage.getItem('book.edit') || 'null') === null;
  const thumbs = document.querySelectorAll('.ed-thumb'); // cover + 2 prose + end
  return draftless && thumbs.length === 4 &&
    thumbs[1].title === 'Prose' && thumbs[2].title === 'Prose';
}));

/* ---------- museum gone ---------- */
import { existsSync } from 'node:fs';
ok('museum pages removed', !existsSync(ROOT + '/player.html') && !existsSync(ROOT + '/howwemet.html') && !existsSync(ROOT + '/gallery.html'));

ok('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
console.log(results.join('\n'));
await browser.close();
