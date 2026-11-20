import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ContainersProvider } from '../src/tree/containersProvider';
import { DockerPoller, LxcMonitor } from '../src/refresh';
import { registerLxcActions } from '../src/actions/lxcActions';
import { registerDockerActions } from '../src/actions/dockerActions';
import { InspectProvider } from '../src/inspect';
import type { Node } from '../src/tree/nodes';
import { setCliPathResolver } from '../src/cli';

setCliPathResolver(() => V_cfg()['seedpod.cliPath']);
function V_cfg() { return (globalThis as any).__vscode.cfg; }

const V = (globalThis as any).__vscode;
const root = path.join(__dirname, '..', '..', 'test');
const fx = (f: string) => readFileSync(path.join(root, 'fixtures', f), 'utf8');
const log = { appendLine() {} } as any;
let dir = '';

const put = (f: string, s: string) => writeFileSync(path.join(dir, f), s);
const calls = () => (existsSync(path.join(dir, 'calls.log')) ? readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n') : []);
const dockerCalls = () => calls().filter((c) => c.includes('docker ps')).length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(path.join(os.tmpdir(), 'fake-lxc-'));
  process.env.FAKE_DIR = dir;
  V.cfg['seedpod.cliPath'] = path.join(root, 'support', 'fake-lxc.sh');
  V.calls.length = 0;
  for (const k of Object.keys(V.answers)) delete V.answers[k];
  put('list.json', fx('list.json'));
});

async function tryNode(p: ContainersProvider): Promise<Extract<Node, { kind: 'instance' }>> {
  const roots = (await p.getChildren()) as any[];
  return roots[0].children.find((n: any) => n.inst.name === 'beta');
}

test('C2: docker daemon not up yet is retried by the poller and recovers', async () => {
  put('docker.err', 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');
  put('docker.code', '1');
  const p = new ContainersProvider(log);
  const t = await tryNode(p);
  assert.ok(!(await p.getChildren(t)).some((n) => n.kind === 'compose'));
  put('docker.err', ''); put('docker.code', '0'); put('docker.out', fx('docker-ps.jsonl'));
  await new DockerPoller(p).tick();
  assert.ok((await p.getChildren(t)).some((n) => n.kind === 'compose'));
});

test('C2: missing docker binary is cached and not re-polled, but manual refresh re-checks', async () => {
  put('docker.err', 'Error: Command not found'); put('docker.code', '127');
  const p = new ContainersProvider(log);
  const t = await tryNode(p);
  await p.getChildren(t);
  await new DockerPoller(p).tick();
  assert.equal(dockerCalls(), 1);
  p.refresh({ docker: true });
  await p.getChildren(await tryNode(p));
  assert.equal(dockerCalls(), 2);
});

test('I1: a docker error is not re-queried on every render', async () => {
  put('docker.err', 'permission denied'); put('docker.code', '1');
  const p = new ContainersProvider(log);
  const t = await tryNode(p);
  const kids = await p.getChildren(t);
  assert.equal(kids[0].kind, 'error');
  await p.getChildren(t);
  await p.getChildren(t);
  assert.equal(dockerCalls(), 1);
});

test('I2: expanding marks a machine for polling, collapsing unmarks it', async () => {
  put('docker.out', fx('docker-ps.jsonl'));
  const p = new ContainersProvider(log);
  const t = await tryNode(p);
  await p.getChildren(t);
  assert.deepEqual(p.loadedMachines().map((i) => i.name), ['beta']);
  p.unmarkExpanded(t.inst);
  assert.deepEqual(p.loadedMachines(), []);
});

test('I1: monitor ignores exec/log events and fires on a state change', async () => {
  const lines = fx('monitor-exec.jsonl').split('\n').filter((l) => l.trim());
  const started = JSON.stringify({ type: 'lifecycle', metadata: { action: 'instance-started', source: '/1.0/instances/x' } });
  put('monitor.1', `printf '%s\\n' ${lines.map((l) => `'${l}'`).join(' ')}; sleep 1; printf '%s\\n' '${started}'; exec sleep 30`);
  let events = 0;
  const m = new LxcMonitor(log);
  try {
    m.start(() => events++);
    await sleep(900);
    assert.equal(events, 0);
    await sleep(1000);
    assert.equal(events, 1);
  } finally {
    m.dispose();
  }
});

test('Minor2: a monitor that reconnects after a failure triggers one refresh', async () => {
  put('monitor.1', 'exit 1');
  let events = 0;
  const m = new LxcMonitor(log);
  try {
    m.start(() => events++);
    await sleep(1000 + 2000 + 700);
    assert.equal(events, 1);
  } finally {
    m.dispose();
  }
});

test('I3: stop asks LXD for a bounded timeout and offers force only on timeout', async () => {
  const p = new ContainersProvider(log);
  registerLxcActions(p);
  const t = await tryNode(p);
  await V.handlers['seedpod.instance.stop'](t);
  assert.ok(calls().some((c) => /^stop beta --timeout \d+ /.test(c)), calls().join('\n'));
  assert.ok(!V.calls.some((c: any[]) => c[0] === 'showWarningMessage'));
});

test('C1: shells use the stderr-preserving bash/sh wrapper', async () => {
  put('docker.out', fx('docker-ps.jsonl'));
  const p = new ContainersProvider(log);
  registerLxcActions(p); registerDockerActions(p);
  const t = await tryNode(p);
  await V.handlers['seedpod.instance.shell'](t);
  const compose: any = (await p.getChildren(t)).find((n) => n.kind === 'compose');
  await V.handlers['seedpod.docker.shell']({ kind: 'docker', inst: t.inst, c: compose.containers[0] });
  const terms = V.calls.filter((c: any[]) => c[0] === 'createTerminal').map((c: any[]) => c[1].shellArgs.join(' '));
  assert.equal(terms.length, 2);
  for (const s of terms) {
    assert.ok(!s.includes('2>/dev/null ||'), s);
    assert.match(s, /if command -v bash/);
  }
});

test('Minor1 re-graded: seedpod-inspect documents refuse non-read-only calls', async () => {
  const query = new URLSearchParams({ calls: JSON.stringify([['delete', 'beta', '--force'], ['info', 'beta']]) }).toString();
  const txt = await new InspectProvider().provideTextDocumentContent({ query } as any);
  assert.ok(!calls().some((c) => c.startsWith('delete')), calls().join('\n'));
  assert.ok(calls().some((c) => c.startsWith('info')));
  assert.match(txt, /refused/);
});

test('hovering a docker container resolves its tooltip from docker inspect; a failure falls back to plain text', async () => {
  put('docker.out', fx('docker-ps.jsonl'));
  const p = new ContainersProvider(log);
  const t = await tryNode(p);
  const kids = (await p.getChildren(t)) as any[];
  const compose = kids.find((n) => n.kind === 'compose');
  const node = { kind: 'docker', inst: t.inst, c: compose.containers[0] } as Node;
  const token = { isCancellationRequested: false } as any;

  const item = p.getTreeItem(node);
  assert.equal(item.tooltip, undefined);
  put('exec.out', fx('docker-inspect.json')); put('exec.code', '0');
  await p.resolveTreeItem(item, node, token);
  assert.match((item.tooltip as any).value, /^### durango/);
  assert.ok(calls().some((c) => c.endsWith(`-- docker inspect ${compose.containers[0].id}`)));

  const again = p.getTreeItem(node);
  put('exec.out', 'boom'); put('exec.code', '1');
  await p.resolveTreeItem(again, node, token);
  assert.match((again.tooltip as any).value, new RegExp(`^### ${compose.containers[0].name.replace(/-/g, '\\\\-')}`));

  for (const tip of [item.tooltip, again.tooltip, p.getTreeItem(t).tooltip, p.getTreeItem(compose).tooltip] as any[]) {
    assert.match(tip.value, /\]\(command:seedpod\.[a-z.]+\?/, 'every hover carries a link, so VS Code keeps it open');
    const ids = [...tip.value.matchAll(/\(command:([a-zA-Z.]+)\?/g)].map((m: RegExpMatchArray) => m[1]);
    for (const id of ids) assert.ok(tip.isTrusted.enabledCommands.includes(id), `${id} is trusted`);
  }
  const arg = /command:seedpod\.docker\.logs\?([^)]+)\)/.exec((item.tooltip as any).value)![1];
  const [n] = JSON.parse(decodeURIComponent(arg));
  assert.deepEqual([n.kind, n.inst.name, n.inst.project, n.c.id], ['docker', 'beta', t.inst.project, compose.containers[0].id]);
});
