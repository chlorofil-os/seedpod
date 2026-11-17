import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotArgs, cliKind, execArgs } from '../src/cli';

test('lxc snapshot verbs', () => {
  assert.deepEqual(snapshotArgs('lxc', 'create', 'beta', 'clean', 'default'), ['snapshot', 'beta', 'clean', '--project', 'default']);
  assert.deepEqual(snapshotArgs('lxc', 'restore', 'beta', 'clean', 'default'), ['restore', 'beta', 'clean', '--project', 'default']);
  assert.deepEqual(snapshotArgs('lxc', 'delete', 'beta', 'clean', 'default'), ['delete', 'beta/clean', '--project', 'default']);
});

test('incus snapshot verbs', () => {
  assert.deepEqual(snapshotArgs('incus', 'delete', 'a.b-c', 's1', 'p'), ['snapshot', 'delete', 'a.b-c', 's1', '--project', 'p']);
  assert.deepEqual(snapshotArgs('incus', 'create', 'a', 's1', 'p'), ['snapshot', 'create', 'a', 's1', '--project', 'p']);
});

test('cliKind', () => {
  assert.equal(cliKind('/usr/bin/incus'), 'incus');
  assert.equal(cliKind('/snap/bin/lxc'), 'lxc');
  assert.equal(cliKind('lxc'), 'lxc');
});

test('execArgs', () => {
  assert.deepEqual(execArgs('m', 'default', ['docker', 'ps']), ['exec', 'm', '--project', 'default', '--', 'docker', 'ps']);
});
