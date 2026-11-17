import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTools, ToolDef } from '../src/mcp/tools';

const root = path.join(__dirname, '..', '..', 'test');
const fx = (f: string) => readFileSync(path.join(root, 'fixtures', f), 'utf8');
let dir = '';
const put = (f: string, s: string) => writeFileSync(path.join(dir, f), s);
const calls = () => (existsSync(path.join(dir, 'calls.log')) ? readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n') : []);
const tool = (tools: ToolDef[], name: string) => {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `tool ${name} missing`);
  return t!;
};

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'fake-lxc-mcp-'));
  process.env.FAKE_DIR = dir;
  process.env.SEEDPOD_CLI = path.join(root, 'support', 'fake-lxc.sh');
  put('list.json', fx('list.json'));
});

const tools = () => createTools({ readOnly: false, protect: ['alpha'] });

test('list_machines summarises instances', async () => {
  const r: any = await tool(tools(), 'list_machines').run({});
  const t = r.machines.find((m: any) => m.name === 'beta');
  assert.equal(t.status, 'Running');
  assert.equal(t.ipv4[0], '10.0.3.11');
  assert.match(t.uptime, /^Up /);
  const b = r.machines.find((m: any) => m.name === 'alpha');
  assert.deepEqual(b.snapshots, ['golden']);
  assert.equal(b.protected, true);
});

test('list_docker groups by compose project', async () => {
  put('docker.out', fx('docker-ps.jsonl'));
  const r: any = await tool(tools(), 'list_docker').run({ machine: 'beta' });
  assert.equal(r.compose[0].project, 'shop-dev');
  assert.equal(r.compose[0].containers.length, 7);
  assert.ok(r.compose[0].containers[0].name && r.compose[0].containers[0].status);
  assert.ok(calls().some((c) => c === 'exec beta --project default -- docker ps -a --format {{json .}}'));
});

test('list_docker reports missing docker and a down daemon distinctly', async () => {
  put('docker.err', 'Error: Command not found'); put('docker.code', '127');
  assert.equal(((await tool(tools(), 'list_docker').run({ machine: 'beta' })) as any).docker, 'not installed');
  put('docker.err', 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock'); put('docker.code', '1');
  assert.equal(((await tool(tools(), 'list_docker').run({ machine: 'beta' })) as any).docker, 'daemon not running');
});

test('unknown machine and option-looking names are rejected without a CLI call', async () => {
  await assert.rejects(tool(tools(), 'machine_info').run({ machine: 'nope' }), /No machine named "nope"/);
  await assert.rejects(tool(tools(), 'machine_action').run({ machine: '-rf', action: 'stop' }), /Invalid/);
  assert.ok(!calls().some((c) => c.startsWith('stop')));
});

test('protected machines refuse every write, including exec', async () => {
  const ts = tools();
  await assert.rejects(tool(ts, 'machine_action').run({ machine: 'alpha', action: 'start' }), /protected/);
  await assert.rejects(tool(ts, 'create_snapshot').run({ machine: 'alpha' }), /protected/);
  await assert.rejects(tool(ts, 'exec').run({ machine: 'alpha', command: ['ls'] }), /protected/);
  assert.ok(!calls().some((c) => /^(start|snapshot|exec) alpha/.test(c)), calls().join('\n'));
});

test('machine_action stop asks LXD for a bounded timeout', async () => {
  await tool(tools(), 'machine_action').run({ machine: 'beta', action: 'stop' });
  assert.ok(calls().includes('stop beta --timeout 100 --project default'), calls().join('\n'));
});

test('docker_action and compose_action run inside the machine', async () => {
  const ts = tools();
  await tool(ts, 'docker_action').run({ machine: 'beta', container: 'shop-dev-queue', action: 'restart' });
  await tool(ts, 'compose_action').run({ machine: 'beta', compose_project: 'shop-dev', action: 'restart' });
  assert.ok(calls().includes('exec beta --project default -- docker restart shop-dev-queue'));
  assert.ok(calls().includes('exec beta --project default -- docker compose -p shop-dev restart'));
});

test('exec passes argv verbatim and returns a non-zero exit instead of throwing', async () => {
  put('exec.out', 'hello\n'); put('exec.code', '3');
  const r: any = await tool(tools(), 'exec').run({ machine: 'beta', command: ['sh', '-c', 'echo hi; exit 3'] });
  assert.equal(r.exitCode, 3);
  assert.equal(r.stdout, 'hello\n');
  assert.ok(calls().includes('exec beta --project default -- sh -c echo hi; exit 3'));
});

test('create_snapshot validates and defaults the name', async () => {
  const ts = tools();
  await assert.rejects(ts.find((t) => t.name === 'create_snapshot')!.run({ machine: 'beta', name: 'bad name' }), /Letters/);
  const r: any = await tool(ts, 'create_snapshot').run({ machine: 'beta' });
  assert.match(r.snapshot, /^snap-\d{8}-\d{4}$/);
  assert.ok(calls().some((c) => c.startsWith(`snapshot beta ${r.snapshot}`)));
});

test('read-only mode drops every write tool; no delete/restore tools exist at all', () => {
  const ro = createTools({ readOnly: true, protect: [] });
  assert.ok(ro.length > 0);
  assert.ok(ro.every((t) => !t.write));
  assert.ok(!ro.some((t) => ['exec', 'machine_action'].includes(t.name)));
  for (const t of tools()) assert.ok(!/delete|restore|remove|rm/.test(t.name), t.name);
  for (const t of tools()) assert.equal(t.annotations.readOnlyHint, !t.write, t.name);
});

test('docker_logs is bounded and non-following', async () => {
  put('exec.out', 'line\n');
  await tool(tools(), 'docker_logs').run({ machine: 'beta', container: 'shop-dev-queue' });
  assert.ok(calls().includes('exec beta --project default -- docker logs --tail 200 shop-dev-queue'), calls().join('\n'));
  await assert.rejects(tool(tools(), 'docker_logs').run({ machine: 'beta', container: 'shop-dev-queue', since: '--follow' }), /Invalid since/);
});
