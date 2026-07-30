'use strict';

/* Global daily budget breakers.
 *
 * The per-IP rate limits are in-memory and per-instance — a speed bump
 * that multiplies as instances scale out. These counters are the money
 * guard behind them: one document per kind per UTC day, atomically
 * incremented in Cosmos; once the day's count crosses the budget the
 * endpoint answers 429 until midnight UTC.
 *
 * Fails OPEN on any store error: a Cosmos hiccup must degrade to
 * "no cap today" rather than take generation down with it. */

const { getContainer } = require('./cosmos');

async function underDailyBudget(kind, limit, container) {
  if (!limit || limit <= 0) return true; /* unset or 0 disables the breaker */
  const id = 'budget-' + kind + '-' + new Date().toISOString().slice(0, 10);
  try {
    const c = container || getContainer();
    try {
      const { resource } = await c.item(id, id).patch([{ op: 'incr', path: '/n', value: 1 }]);
      return !resource || resource.n <= limit;
    } catch (err) {
      if (err && err.code === 404) {
        /* first call of the day mints the counter (a concurrent-create
         * 409 falls to the outer catch: one free pass, correct after) */
        await c.items.create({ id, kind: 'budget', n: 1 });
        return true;
      }
      throw err;
    }
  } catch (err) {
    return true; /* fail open — see header */
  }
}

module.exports = { underDailyBudget };
