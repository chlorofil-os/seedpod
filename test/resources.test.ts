import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseNetworks } from '../src/model/lxc';
import { visibleNetworks } from '../src/model/resources';

const nets = parseNetworks(readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', 'networks.json'), 'utf8'));

test('unmanaged networks hidden by default', () => {
  assert.deepEqual(visibleNetworks(nets, false).map((n) => n.name), ['lxdbr0']);
});

test('unmanaged networks shown when enabled', () => {
  const names = visibleNetworks(nets, true).map((n) => n.name);
  assert.ok(names.includes('docker0'));
  assert.ok(names.includes('lxdbr0'));
});

test('managed networks sort first', () => {
  assert.equal(visibleNetworks(nets, true)[0].name, 'lxdbr0');
});
