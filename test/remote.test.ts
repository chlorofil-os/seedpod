import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { planMachineSettings, resolveRemoteFolder, splitHome } from '../src/model/remote';
import { ContainersProvider } from '../src/tree/containersProvider';
import { registerLxcActions } from '../src/actions/lxcActions';
import { setCliPathResolver } from '../src/cli';

test('planMachineSettings: missing file gets the wanted keys', () => {
  const p = planMachineSettings('', { 'git.repositoryScanMaxDepth': 2 });
  assert.equal(p.kind, 'write');
  assert.deepEqual(JSON.parse((p as any).text), { 'git.repositoryScanMaxDepth': 2 });
});

test('planMachineSettings: keeps keys it does not manage, overrides the ones it does', () => {
  const p = planMachineSettings('{"editor.tabSize": 4, "git.repositoryScanMaxDepth": 1}', { 'git.repositoryScanMaxDepth': 2 });
  assert.deepEqual(JSON.parse((p as any).text), { 'editor.tabSize': 4, 'git.repositoryScanMaxDepth': 2 });
});

test('planMachineSettings: no write when every wanted key already matches', () => {
  assert.equal(planMachineSettings('{"a": {"b": [1]}, "c": true}', { a: { b: [1] } }).kind, 'unchanged');
});

test('planMachineSettings: refuses to overwrite a file it cannot parse (comments, trailing commas)', () => {
  assert.equal(planMachineSettings('{ // mine\n "a": 1 }', { b: 2 }).kind, 'invalid');
  assert.equal(planMachineSettings('[1]', { b: 2 }).kind, 'invalid');
});

test('resolveRemoteFolder: empty, ~, ~/x, relative and absolute', () => {
  assert.equal(resolveRemoteFolder('', '/home/ubuntu'), undefined);
  assert.equal(resolveRemoteFolder('~', '/home/ubuntu'), '/home/ubuntu');
  assert.equal(resolveRemoteFolder('~/workspace', '/home/ubuntu'), '/home/ubuntu/workspace');
  assert.equal(resolveRemoteFolder('workspace/', '/home/ubuntu'), '/home/ubuntu/workspace');
  assert.equal(resolveRemoteFolder('/srv/app', '/home/ubuntu'), '/srv/app');
});

test('splitHome: first line is the home directory, the rest is the settings file', () => {
  assert.deepEqual(splitHome('/home/ubuntu\n{\n "a": 1\n}\n'), { home: '/home/ubuntu', settings: '{\n "a": 1\n}\n' });
  assert.deepEqual(splitHome('/home/ubuntu\n'), { home: '/home/ubuntu', settings: '' });
});

// --- the action, against the fake lxc ---
const V = (globalThis as any).__vscode;
const root = path.join(__dirname, '..', '..', 'test');
let dir = '';
const put = (f: string, s: string) => writeFileSync(path.join(dir, f), s);
const log = () => (existsSync(path.join(dir, 'calls.log')) ? readFileSync(path.join(dir, 'calls.log'), 'utf8') : '');
const opened = () => V.calls.filter((c: any[]) => c[0] === 'executeCommand' && /^vscode\.(newWindow|openFolder)$/.test(c[1]));

beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(path.join(os.tmpdir(), 'fake-lxc-remote-'));
  process.env.FAKE_DIR = dir;
  setCliPathResolver(() => path.join(root, 'support', 'fake-lxc.sh'));
  V.cfg['seedpod.cliPath'] = path.join(root, 'support', 'fake-lxc.sh');
  for (const k of ['user', 'folder', 'machineSettings']) delete V.cfg[`seedpod.remoteSsh.${k}`];
  V.calls.length = 0;
  put('list.json', readFileSync(path.join(root, 'fixtures', 'list.json'), 'utf8'));
});

async function openBeta() {
  const p = new ContainersProvider({ appendLine() {} } as any);
  registerLxcActions(p);
  const roots = (await p.getChildren()) as any[];
  const beta = roots[0].children.find((n: any) => n.inst.name === 'beta');
  await V.handlers['seedpod.instance.remoteSsh'](beta);
}

test('remoteSsh: with nothing configured it opens an empty window and touches nothing', async () => {
  await openBeta();
  assert.doesNotMatch(log(), /^exec /m);
  assert.equal(opened().length, 1);
  assert.equal(opened()[0][1], 'vscode.newWindow');
  assert.equal(opened()[0][2].remoteAuthority, 'ssh-remote+ubuntu@10.0.3.11');
});

test('remoteSsh: writes machine settings, then opens the folder under the user home', async () => {
  V.cfg['seedpod.remoteSsh.machineSettings'] = { 'git.repositoryScanMaxDepth': 2 };
  V.cfg['seedpod.remoteSsh.folder'] = '~/workspace';
  put('exec.out', '/home/ubuntu\n{"editor.tabSize": 4}\n');
  await openBeta();
  const execs = log().split(/^(?=exec )/m).filter((c) => c.startsWith('exec beta --project default -- sh -c '));
  assert.equal(execs.length, 2, log());
  assert.match(execs[1], /"editor\.tabSize": 4/);
  assert.match(execs[1], /"git\.repositoryScanMaxDepth": 2/);
  assert.equal(opened()[0][1], 'vscode.openFolder');
  assert.equal(opened()[0][2].authority, 'ssh-remote+ubuntu@10.0.3.11');
  assert.equal(opened()[0][2].path, '/home/ubuntu/workspace');
});

test('remoteSsh: an unparseable settings file is left alone, with a warning, and the window still opens', async () => {
  V.cfg['seedpod.remoteSsh.machineSettings'] = { 'git.repositoryScanMaxDepth': 2 };
  put('exec.out', '/home/ubuntu\n{ // hand edited\n}\n');
  await openBeta();
  assert.equal(log().split(/^(?=exec )/m).filter((c) => c.startsWith('exec ')).length, 1);
  assert.ok(V.calls.some((c: any[]) => c[0] === 'showWarningMessage' && /settings\.json/.test(c[1])));
  assert.equal(opened().length, 1);
});

test('remoteSsh: setup failure warns and still opens the window', async () => {
  V.cfg['seedpod.remoteSsh.machineSettings'] = { a: 1 };
  put('exec.out', 'no user ubuntu in this machine\n'); put('exec.code', '3');
  await openBeta();
  assert.ok(V.calls.some((c: any[]) => c[0] === 'showWarningMessage'));
  assert.equal(opened().length, 1);
});

test('remoteSsh: rejects an unsafe user name without running anything', async () => {
  V.cfg['seedpod.remoteSsh.user'] = 'x;rm -rf';
  await openBeta();
  assert.equal(opened().length, 0);
  assert.doesNotMatch(log(), /^exec /m);
});
