import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import { runCli, runCliResult, setCliPathResolver } from '../src/cli';

// `lxc snapshot` reads YAML from stdin when it is not a TTY; an open stdin pipe hangs it forever.
process.env.FAKE_DIR = mkdtempSync(path.join(os.tmpdir(), 'fake-lxc-stdin-'));
setCliPathResolver(() => path.join(__dirname, '..', '..', 'test', 'support', 'fake-lxc.sh'));

test('runCli closes the child stdin', async () => {
  assert.equal((await runCli(['read-stdin'], { timeoutMs: 3000 })).trim(), 'done');
});

test('runCliResult closes the child stdin', async () => {
  const r = await runCliResult(['read-stdin'], { timeoutMs: 3000 });
  assert.equal(r.timedOut, false);
  assert.equal(r.stdout.trim(), 'done');
});
