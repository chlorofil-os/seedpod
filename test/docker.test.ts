import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseDockerPs, groupByCompose, isNoDockerError } from '../src/model/docker';

const fx = (f: string) => readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', f), 'utf8');

test('fixture parses with compose labels', () => {
  const cs = parseDockerPs(fx('docker-ps.jsonl'));
  assert.equal(cs.length, 7);
  const q = cs.find((c) => c.name === 'shop-dev-queue')!;
  assert.equal(q.composeProject, 'shop-dev');
  assert.equal(q.composeService, 'queue');
  assert.equal(q.state, 'running');
  assert.equal(q.image, 'shop/app:dev');
  assert.match(q.status, /^Up /);
});

test('blank lines and non-JSON lines are skipped', () => {
  const line = fx('docker-ps.jsonl').split('\n')[0];
  assert.equal(parseDockerPs('\n' + line + '\nWARNING: something\n\n').length, 1);
  assert.deepEqual(parseDockerPs(''), []);
});

test('container without compose labels is standalone', () => {
  const line = JSON.stringify({ ID: 'abc', Names: 'solo', Image: 'redis:7', State: 'exited', Status: 'Exited (0) 2 hours ago', Ports: '', Labels: '' });
  const g = groupByCompose(parseDockerPs(line + '\n' + fx('docker-ps.jsonl')));
  assert.deepEqual(g.standalone.map((c) => c.name), ['solo']);
  assert.deepEqual(g.projects.map((p) => p.name), ['shop-dev']);
  const names = g.projects[0].containers.map((c) => c.name);
  assert.deepEqual(names, [...names].sort());
});

test('label values containing commas do not break key parsing', () => {
  const line = JSON.stringify({ ID: 'x', Names: 'n', Image: 'i', State: 'running', Status: 'Up', Ports: '', Labels: 'a=b,c,com.docker.compose.project=p1,com.docker.compose.service=web' });
  const [c] = parseDockerPs(line);
  assert.equal(c.composeProject, 'p1');
  assert.equal(c.composeService, 'web');
});

test('isNoDockerError', () => {
  assert.equal(isNoDockerError({ code: 127 }), true);
  assert.equal(isNoDockerError({ code: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock' }), true);
  assert.equal(isNoDockerError({ code: 1, stderr: 'exec: "docker": executable file not found in $PATH' }), true);
  assert.equal(isNoDockerError({ code: 1, stderr: 'permission denied' }), false);
});
