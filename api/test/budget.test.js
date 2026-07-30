'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { underDailyBudget } = require('../src/lib/budget');

function stubContainer(behavior) {
  return {
    item: () => ({ patch: behavior.patch }),
    items: { create: behavior.create || (async () => ({})) },
  };
}

test('allows while the day is under budget', async () => {
  const c = stubContainer({ patch: async () => ({ resource: { n: 5 } }) });
  assert.equal(await underDailyBudget('generate', 10, c), true);
});

test('refuses once the day crosses the budget', async () => {
  const c = stubContainer({ patch: async () => ({ resource: { n: 11 } }) });
  assert.equal(await underDailyBudget('generate', 10, c), false);
});

test("mints the day's counter on first call", async () => {
  let created = null;
  const c = stubContainer({
    patch: async () => { const e = new Error('nf'); e.code = 404; throw e; },
    create: async (doc) => { created = doc; return {}; },
  });
  assert.equal(await underDailyBudget('images', 10, c), true);
  assert.equal(created.kind, 'budget');
  assert.match(created.id, /^budget-images-\d{4}-\d{2}-\d{2}$/);
  assert.equal(created.n, 1);
});

test('fails open when the store errors', async () => {
  const c = stubContainer({ patch: async () => { throw new Error('cosmos down'); } });
  assert.equal(await underDailyBudget('generate', 10, c), true);
});

test('limit 0 or unset disables the breaker without touching the store', async () => {
  const c = stubContainer({ patch: async () => { throw new Error('must not be called'); } });
  assert.equal(await underDailyBudget('generate', 0, c), true);
  assert.equal(await underDailyBudget('generate', undefined, c), true);
});
