import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cliPath, setCliPathResolver } from '../src/cli';

afterEach(() => {
  setCliPathResolver(undefined);
  delete process.env.SEEDPOD_CLI;
});

test('without a resolver, cliPath comes from SEEDPOD_CLI, defaulting to lxc', () => {
  setCliPathResolver(undefined);
  assert.equal(cliPath(), 'lxc');
  process.env.SEEDPOD_CLI = '/usr/bin/incus';
  assert.equal(cliPath(), '/usr/bin/incus');
});

test('a resolver wins over the environment', () => {
  process.env.SEEDPOD_CLI = '/usr/bin/incus';
  setCliPathResolver(() => '/snap/bin/lxc');
  assert.equal(cliPath(), '/snap/bin/lxc');
});
