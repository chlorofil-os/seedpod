import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import { runCli, setCliPathResolver } from '../src/cli';

test('a failure with empty stderr still says how the command ended', async () => {
  process.env.FAKE_DIR = mkdtempSync(path.join(os.tmpdir(), 'fake-lxc-err-'));
  setCliPathResolver(() => path.join(__dirname, '..', '..', 'test', 'support', 'fake-lxc.sh'));
  await assert.rejects(runCli(['fail-silent']), (e: Error) => /exit code 5/.test(e.message) && /fail-silent/.test(e.message));
});
