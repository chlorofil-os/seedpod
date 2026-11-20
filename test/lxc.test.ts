import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseInstances, parseImages, parseNetworks, parsePools, parseVolumes } from '../src/model/lxc';
import { formatUptime, instanceDescription, instanceHoverMarkdown } from '../src/model/format';

const fx = (f: string) => readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', f), 'utf8');

test('running instance: status, eth0 IP first, docker bridges excluded', () => {
  const insts = parseInstances(fx('list.json'));
  const t = insts.find((i) => i.name === 'beta')!;
  assert.equal(t.status, 'Running');
  assert.equal(t.project, 'default');
  assert.equal(t.ipv4[0], '10.0.3.11');
  assert.ok(!t.ipv4.includes('172.17.0.1'));
  assert.ok(!t.ipv4.some((a) => a.startsWith('172.18.')));
  assert.equal(t.os, 'ubuntu 24.04');
});

test('stopped template: no IPs, golden snapshot', () => {
  const b = parseInstances(fx('list.json')).find((i) => i.name === 'alpha')!;
  assert.deepEqual(b.ipv4, []);
  assert.equal(b.snapshots[0].name, 'golden');
});

test('null state and null snapshots do not crash', () => {
  const [x] = parseInstances('[{"name":"x","project":"default","status":"Stopped","type":"container","state":null,"snapshots":null,"expanded_config":{},"created_at":"2026-01-01T00:00:00Z"}]');
  assert.deepEqual(x.ipv4, []);
  assert.deepEqual(x.snapshots, []);
  assert.equal(x.os, undefined);
  assert.equal(instanceDescription(x, new Date()), 'Stopped');
});

test('instanceDescription', () => {
  const insts = parseInstances(fx('list.json'));
  const b = insts.find((i) => i.name === 'alpha')!;
  assert.ok(instanceDescription(b, new Date()).endsWith('· Stopped'));
  const t = insts.find((i) => i.name === 'beta')!;
  const now = new Date(t.lastUsedAt!.getTime() + (3 * 60 + 5) * 60_000);
  assert.equal(instanceDescription(t, now), 'ubuntu 24.04 · 10.0.3.11 · Up 3 hours');
});

test('formatUptime boundaries', () => {
  const at = (s: number) => formatUptime(new Date(0), new Date(s * 1000));
  assert.equal(at(30), 'Up Less than a minute');
  assert.equal(at(61), 'Up 1 minute');
  assert.equal(at(14 * 60), 'Up 14 minutes');
  assert.equal(at(3600), 'Up 1 hour');
  assert.equal(at(2 * 3600), 'Up 2 hours');
  assert.equal(at(49 * 3600), 'Up 2 days');
});

test('volumes exclude snapshot entries', () => {
  const vs = parseVolumes(fx('volumes-tank.json'));
  assert.ok(vs.some((v) => v.name === 'alpha'));
  assert.ok(!vs.some((v) => v.name.includes('/')));
});

test('networks: lxdbr0 managed with ipv4', () => {
  const br = parseNetworks(fx('networks.json')).find((n) => n.name === 'lxdbr0')!;
  assert.equal(br.managed, true);
  assert.equal(br.ipv4, '10.0.3.1/24');
  assert.equal(br.usedBy, 5);
});

test('pools and images', () => {
  const pools = parsePools(fx('storage.json'));
  assert.deepEqual(pools.map((p) => [p.name, p.driver]), [['tank', 'btrfs'], ['default', 'dir']]);
  const [img] = parseImages(fx('images.json'));
  assert.equal(img.fingerprint.length, 64);
  assert.equal(img.alias, undefined);
  assert.equal(img.description, 'ubuntu 24.04 LTS amd64 (release) (20261017)');
  assert.equal(img.type, 'container');
});

test('machine hover: status, proxy ports linked on the host, disks, nics, limits, snapshots', () => {
  const [beta] = parseInstances(fx('list.json')).filter((i) => i.name === 'beta');
  beta.devices.web = { type: 'proxy', listen: 'tcp:0.0.0.0:8080', connect: 'tcp:127.0.0.1:80' };
  beta.devices.src = { type: 'disk', source: '/home/u/src', path: '/srv/src', readonly: 'true' };
  beta.limits = { cpu: '4', memory: '8GiB' };
  const m = instanceHoverMarkdown(beta, new Date());
  assert.match(m, /^### beta \(container\)/);
  assert.match(m, /#### Ports\n\n- \[8080\]\(http:\/\/localhost:8080\) ➔ 80 tcp \(web\)/);
  assert.match(m, /- pool tank ➔ \/\n- \/home\/u\/src ➔ \/srv\/src \(RO\)/);
  assert.match(m, /#### Networks\n\n- eth0 · lxdbr0/);
  assert.match(m, /#### Limits\n\nCPU 4 · memory 8GiB/);
  const [alpha] = parseInstances(fx('list.json')).filter((i) => i.name === 'alpha');
  assert.doesNotMatch(instanceHoverMarkdown(alpha, new Date()), /Ports|Limits/);
});
