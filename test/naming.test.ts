import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSnapshotName, validateSnapshotName } from '../src/model/naming';

test('default snapshot name', () => {
  assert.equal(defaultSnapshotName(new Date(2026, 10, 7, 9, 5)), 'snap-20261107-0905');
});

test('snapshot name validation', () => {
  assert.equal(validateSnapshotName('clean'), undefined);
  assert.equal(validateSnapshotName('pre-upgrade_2.1'), undefined);
  assert.ok(validateSnapshotName(''));
  assert.ok(validateSnapshotName('-x'));
  assert.ok(validateSnapshotName('a/b'));
  assert.ok(validateSnapshotName('has space'));
});

test('existing snapshot name rejected', () => {
  assert.ok(validateSnapshotName('golden', ['golden']));
});
