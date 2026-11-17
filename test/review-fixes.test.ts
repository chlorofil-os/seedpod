import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { shellCommand, isStopTimeout, isReadOnlyCall } from '../src/cli';
import { classifyDockerError } from '../src/model/docker';
import { isStateEvent } from '../src/refresh-core';

const fx = (f: string) => readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', f), 'utf8');
const runShell = (cmd: string[], pathDir: string) =>
  execFileSync('/bin/dash', ['-c', cmd[2]], { input: 'echo "SHELL_OK $0"\n', env: { PATH: pathDir, HOME: '/tmp' } }).toString();

// C1: the shell wrapper must not silence stderr (bash prompt/echo) and must fall back when bash is absent
test('shellCommand keeps stderr', () => {
  for (const login of [true, false]) assert.ok(!shellCommand(login)[2].includes('2>/dev/null'));
});

test('shellCommand falls back to sh when bash is missing', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nobash-'));
  symlinkSync('/bin/dash', path.join(dir, 'sh'));
  assert.match(runShell(shellCommand(false), dir), /^SHELL_OK sh/);
});

test('shellCommand prefers bash when present', () => {
  assert.match(runShell(shellCommand(true), '/usr/bin:/bin'), /^SHELL_OK bash/);
});

// C2: a daemon that is not up yet is not "no docker"
test('classifyDockerError', () => {
  assert.equal(classifyDockerError({ code: 127 }), 'missing');
  assert.equal(classifyDockerError({ code: 1, stderr: 'exec: "docker": executable file not found in $PATH' }), 'missing');
  assert.equal(classifyDockerError({ code: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?' }), 'down');
  assert.equal(classifyDockerError({ code: 1, stderr: 'permission denied' }), 'error');
});

// I1: exec/log events are caused by our own polling and must not trigger a refresh
test('isStateEvent ignores exec and log-retrieved, keeps state changes', () => {
  const lines = fx('monitor-exec.jsonl').split('\n').filter((l) => l.trim());
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.equal(isStateEvent(l), false, l.slice(0, 120));
  assert.equal(isStateEvent(JSON.stringify({ type: 'lifecycle', metadata: { action: 'instance-started', source: '/1.0/instances/x' } })), true);
  assert.equal(isStateEvent(JSON.stringify({ type: 'lifecycle', metadata: { action: 'instance-file-retrieved' } })), false);
  assert.equal(isStateEvent('not json'), true);
});

// I3: only a timeout warrants offering force stop
test('isStopTimeout', () => {
  assert.equal(isStopTimeout('Error: Failed shutting down instance, status is "Running": context deadline exceeded'), true);
  assert.equal(isStopTimeout('Error: The instance is already stopped'), false);
});

// Re-graded minor 1: seedpod-inspect documents may only run read-only calls
test('isReadOnlyCall allowlist', () => {
  assert.equal(isReadOnlyCall(['config', 'show', 'x', '--expanded', '--project', 'default']), true);
  assert.equal(isReadOnlyCall(['info', 'x', '--show-log', '--project', 'default']), true);
  assert.equal(isReadOnlyCall(['network', 'show', 'lxdbr0']), true);
  assert.equal(isReadOnlyCall(['storage', 'show', 'tank']), true);
  assert.equal(isReadOnlyCall(['exec', 'x', '--project', 'default', '--', 'docker', 'inspect', 'abc']), true);
  assert.equal(isReadOnlyCall(['delete', 'x', '--force']), false);
  assert.equal(isReadOnlyCall(['exec', 'x', '--project', 'default', '--', 'rm', '-rf', '/']), false);
  assert.equal(isReadOnlyCall(['exec', 'x', '--', 'docker', 'inspect', 'a', ';', 'rm']), false);
  assert.equal(isReadOnlyCall(['config', 'set', 'x', 'k', 'v']), false);
});
