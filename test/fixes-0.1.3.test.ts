import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ContainersProvider, instanceState } from '../src/tree/containersProvider';
import { createTools } from '../src/mcp/tools';
import { VERSION } from '../src/mcp/server';
import { CliError, isStopTimeout } from '../src/cli';

const root = path.join(__dirname, '..', '..', 'test');
const fx = (f: string) => readFileSync(path.join(root, 'fixtures', f), 'utf8');
const log = { appendLine() {} } as any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let dir = '';
const put = (f: string, s: string) => writeFileSync(path.join(dir, f), s);

/** The list fixture with one machine's status replaced. */
function listWith(name: string, status: string): string {
  const list = JSON.parse(fx('list.json'));
  for (const i of list) if (i.name === name) i.status = status;
  return JSON.stringify(list);
}

async function statusOf(p: ContainersProvider, name: string): Promise<string | undefined> {
  const roots = (await p.getChildren()) as any[];
  const insts = roots.flatMap((r) => (r.kind === 'project' ? r.children : [r]));
  return insts.find((n: any) => n.kind === 'instance' && n.inst.name === name)?.inst.status;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'fake-lxc-fix-'));
  process.env.FAKE_DIR = dir;
  process.env.SEEDPOD_CLI = path.join(root, 'support', 'fake-lxc.sh');
  put('list.json', listWith('beta', 'Running'));
});

test('a slow, superseded `lxc list` does not overwrite a newer result', async () => {
  const p = new ContainersProvider(log);
  put('list.delay', '0.6');
  const older = p.getChildren(); // reads Running, then sleeps
  await sleep(200);
  put('list.json', listWith('beta', 'Stopped'));
  p.refresh(); // the monitor saw beta stop
  const newer = p.getChildren(); // fast: reads Stopped
  await Promise.all([older, newer]);
  assert.equal(await statusOf(p, 'beta'), 'Stopped');
});

test('concurrent renders of one generation share one `lxc list`', async () => {
  const p = new ContainersProvider(log);
  await Promise.all([p.getChildren(), p.getChildren(), p.getChildren()]);
  const lists = readFileSync(path.join(dir, 'calls.log'), 'utf8').split('\n').filter((l) => l.startsWith('list '));
  assert.equal(lists.length, 1);
});

test('instance states outside Running/Frozen/Stopped are not shown as Stopped', () => {
  assert.equal(instanceState('Running'), 'running');
  assert.equal(instanceState('Frozen'), 'frozen');
  assert.equal(instanceState('Stopped'), 'stopped');
  for (const s of ['Error', 'Starting', 'Stopping', 'Freezing', 'Unknown']) assert.equal(instanceState(s), 'other', s);
});

test('an Error instance gets the `other` context value and an error icon', async () => {
  put('list.json', listWith('beta', 'Error'));
  const p = new ContainersProvider(log);
  const roots = (await p.getChildren()) as any[];
  const node = roots.flatMap((r) => (r.kind === 'project' ? r.children : [r])).find((n: any) => n.inst?.name === 'beta');
  const item = p.getTreeItem(node);
  assert.equal(item.contextValue, 'seedpod.instance.other');
  assert.equal((item.iconPath as any).id, 'error');
});

test('isStopTimeout: only an LXD-reported stop timeout offers force', () => {
  assert.equal(isStopTimeout('Error: Failed shutting down instance, status is "Running": context deadline exceeded'), true);
  // our own client kill
  assert.equal(isStopTimeout('lxc stop beta --timeout 100 --project default: timed out after 120s'), false);
  assert.equal(isStopTimeout(new CliError('Error: context deadline exceeded', undefined, '', true)), false);
  // transport errors
  assert.equal(isStopTimeout('Error: Get "http://unix.socket/1.0": dial unix /var/snap/lxd/common/lxd/unix.socket: i/o timeout'), false);
  assert.equal(isStopTimeout('Error: dial tcp 10.0.0.2:8443: connect: connection refused'), false);
  assert.equal(isStopTimeout(new CliError('Error: context deadline exceeded', 1, '')), true);
});

test('create_snapshot refuses a second snapshot of the same machine while one runs', async () => {
  put('snapshot.delay', '0.5');
  const snap = createTools({ readOnly: false, protect: [] }).find((t) => t.name === 'create_snapshot')!;
  const first = snap.run({ machine: 'beta', name: 's1' });
  await sleep(150);
  await assert.rejects(snap.run({ machine: 'beta', name: 's2' }), /already running/);
  await first;
  put('snapshot.delay', '0');
  const r: any = await snap.run({ machine: 'beta', name: 's3' });
  assert.equal(r.snapshot, 's3');
});

test('MCP serverInfo version follows package.json', () => {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.equal(VERSION, pkg.version);
});
