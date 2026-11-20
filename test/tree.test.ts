import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { stackOf, parseInstances } from '../src/model/lxc';
import { parseDockerPs, DockerContainer } from '../src/model/docker';
import { buildRoots, instanceChildren, dockerChildren, matchesFilter, dockerKey, Node } from '../src/tree/nodes';

const fx = (f: string) => readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', f), 'utf8');
const insts = parseInstances(fx('list.json'));
const tryM = insts.find((i) => i.name === 'beta')!;
const base = insts.find((i) => i.name === 'alpha')!;
const docker = parseDockerPs(fx('docker-ps.jsonl'));
const opts = (o: Partial<{ groupBy: 'stack' | 'project' | 'none'; filter: string; docker: Map<string, DockerContainer[] | 'none'> }>) => ({
  groupBy: 'project' as const, filter: '', docker: new Map<string, DockerContainer[] | 'none'>(), ...o,
});

test('group by project gives one default project root with both instances', () => {
  const roots = buildRoots(insts, opts({}));
  assert.equal(roots.length, 1);
  const p = roots[0] as Extract<Node, { kind: 'project' }>;
  assert.equal(p.kind, 'project');
  assert.equal(p.project, 'default');
  assert.deepEqual(p.children.map((c) => (c as Extract<Node, { kind: 'instance' }>).inst.name), ['alpha', 'beta']);
});

test('without grouping, instances are roots', () => {
  const roots = buildRoots(insts, opts({ groupBy: 'none' }));
  assert.deepEqual(roots.map((r) => r.kind), ['instance', 'instance']);
});

test('filter matches loaded docker names, not unloaded ones', () => {
  const loaded = new Map<string, DockerContainer[] | 'none'>([[dockerKey(tryM), docker]]);
  const kept = buildRoots(insts, opts({ groupBy: 'none', filter: 'QUEUE', docker: loaded }));
  assert.deepEqual(kept.map((r) => (r as Extract<Node, { kind: 'instance' }>).inst.name), ['beta']);
  assert.deepEqual(buildRoots(insts, opts({ groupBy: 'none', filter: 'queue' })), []);
  assert.equal(matchesFilter(base, undefined, 'ALP'), true);
  assert.equal(matchesFilter(base, 'none', 'queue'), false);
});

test('filter that matches nothing in a project drops the project node', () => {
  assert.deepEqual(buildRoots(insts, opts({ filter: 'zzz' })), []);
});

test('running machine children: compose group first, then props', () => {
  const kids = instanceChildren(tryM, docker);
  const first = kids[0] as Extract<Node, { kind: 'compose' }>;
  assert.equal(first.kind, 'compose');
  assert.equal(first.project, 'shop-dev');
  assert.equal(first.containers.length, 7);
  assert.ok(kids.some((k) => k.kind === 'snapshots'));
  assert.ok(kids.some((k) => k.kind === 'prop' && k.label === 'IPv4' && k.value === '10.0.3.11'));
});

test('stopped machine: snapshots node, no docker', () => {
  const kids = instanceChildren(base, undefined);
  assert.ok(kids.some((k) => k.kind === 'snapshots'));
  assert.ok(!kids.some((k) => k.kind === 'compose' || k.kind === "docker"));
});

test("'none' docker yields no docker nodes", () => {
  assert.ok(!instanceChildren(tryM, 'none').some((k) => k.kind === 'compose' || k.kind === 'docker'));
});

test('dockerChildren props', () => {
  const q = docker.find((c) => c.name === 'shop-dev-queue')!;
  const labels = dockerChildren(q).map((n) => (n as Extract<Node, { kind: 'prop' }>).label);
  assert.deepEqual(labels, ['Image', 'Ports', 'Status', 'ID']);
});

test('stack grouping: seedbed tag, then user.<stack>.ip, then <stack>-* profile, then name prefix, else other', () => {
  assert.equal(stackOf('x', { 'user.seedbed.project': 'chlorofil', 'user.crmleaf.ip': '1' }, []), 'chlorofil');
  assert.equal(stackOf('agentsvc', { 'user.crmleaf.ip': '10.0.0.1' }, ['crmleaf-clone']), 'crmleaf');
  assert.equal(stackOf('copyproject', {}, ['default', 'crmleaf-clone']), 'crmleaf');
  assert.equal(stackOf('durango-pg', {}, ['default']), 'durango');
  assert.equal(stackOf('alpha', {}, ['default', 'docker']), 'other');
  const a = { ...base, stack: 'crmleaf' };
  const b = { ...tryM, stack: 'other' };
  const c = { ...tryM, name: 'zz', stack: 'chlorofil' };
  const roots = buildRoots([b, a, c], opts({ groupBy: 'stack' })) as Extract<Node, { kind: 'project' }>[];
  assert.deepEqual(roots.map((r) => [r.project, r.by]), [['chlorofil', 'stack'], ['crmleaf', 'stack'], ['other', 'stack']]);
});
