import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseDockerPs, groupByCompose, isNoDockerError, dockerHoverMarkdown } from '../src/model/docker';

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

test('hover markdown: title, image, deduped ports linked to the machine, volumes, networks', () => {
  const m = dockerHoverMarkdown(fx('docker-inspect.json'), '10.0.3.7');
  assert.match(m, /^### durango\\-postgres\\-postgres\\-1 \(0da2147821f2\)/);
  assert.match(m, /#### Image\n\npostgres:16\\\.4 \(6b14e73a48cf\)/);
  assert.equal(m.match(/\(http:\/\/10\.0\.3\.7:5432\)/g)?.length, 1);
  assert.match(m, /- 127\\\.0\\\.0\\\.1:9187 ➔ 9187 tcp/);
  assert.doesNotMatch(m, /8080/);
  assert.match(m, /- durango\\-postgres\\_pgdata ➔ \/var\/lib\/postgresql\/data \(Named volume, RW\)/);
  assert.match(m, /- \/srv\/init ➔ \/docker\\-entrypoint\\-initdb\\\.d \(Bind mount, RO\)/);
  assert.match(m, /#### Networks\n\n- bridge\n- durango\\-postgres\\_default$/);
});

test('hover markdown: no machine IP leaves published ports unlinked; empty sections are omitted', () => {
  const m = dockerHoverMarkdown(fx('docker-inspect.json'));
  assert.match(m, /- 5432 ➔ 5432 tcp/);
  const bare = dockerHoverMarkdown(JSON.stringify([{ Id: 'abc', Name: '/x', Config: { Image: 'busybox' } }]));
  assert.doesNotMatch(bare, /Ports|Volumes|Networks/);
});
