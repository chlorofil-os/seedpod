import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextBackoff, Debouncer } from '../src/refresh-core';

test('nextBackoff doubles from 1s and caps at 30s', () => {
  assert.equal(nextBackoff(0), 1000);
  assert.equal(nextBackoff(1000), 2000);
  assert.equal(nextBackoff(16000), 30000);
  assert.equal(nextBackoff(30000), 30000);
});

test('Debouncer collapses a burst into one call after the quiet period', async () => {
  let calls = 0;
  const d = new Debouncer(50, () => calls++);
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) {
    d.trigger();
    await new Promise((r) => setTimeout(r, 4));
  }
  assert.equal(calls, 0);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(calls, 1);
  assert.ok(Date.now() - t0 >= 50);
  d.dispose();
});

test('Debouncer.dispose cancels a pending call', async () => {
  let calls = 0;
  const d = new Debouncer(20, () => calls++);
  d.trigger();
  d.dispose();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls, 0);
});
