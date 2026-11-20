import type { LxcInstance } from '../model/lxc';
import { DockerContainer, groupByCompose } from '../model/docker';

export type DockerState = DockerContainer[] | 'none' | undefined;

export type Node =
  | { kind: 'error'; message: string }
  | { kind: 'project'; project: string; by: 'stack' | 'project'; children: Node[] }
  | { kind: 'instance'; inst: LxcInstance }
  | { kind: 'compose'; inst: LxcInstance; project: string; containers: DockerContainer[] }
  | { kind: 'docker'; inst: LxcInstance; c: DockerContainer }
  | { kind: 'snapshots'; inst: LxcInstance }
  | { kind: 'snapshot'; inst: LxcInstance; name: string; createdAt: Date }
  | { kind: 'prop'; label: string; value: string };

export type GroupBy = 'stack' | 'project' | 'none';

export interface TreeOpts {
  groupBy: GroupBy;
  filter: string;
  docker: Map<string, DockerContainer[] | 'none'>;
}

export const dockerKey = (i: { project: string; name: string }): string => `${i.project}/${i.name}`;

export function matchesFilter(inst: LxcInstance, docker: DockerState, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  if (inst.name.toLowerCase().includes(f)) return true;
  return Array.isArray(docker) && docker.some((c) => c.name.toLowerCase().includes(f));
}

export function buildRoots(insts: LxcInstance[], opts: TreeOpts): Node[] {
  const visible = insts
    .filter((i) => matchesFilter(i, opts.docker.get(dockerKey(i)), opts.filter))
    .sort((a, b) => a.name.localeCompare(b.name));
  const by = opts.groupBy;
  if (by === 'none') return visible.map((inst) => ({ kind: 'instance', inst }));
  const groups = new Map<string, Node[]>();
  for (const inst of visible) {
    const key = by === 'stack' ? inst.stack : inst.project;
    const list = groups.get(key) ?? [];
    list.push({ kind: 'instance', inst });
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'other' ? 1 : b === 'other' ? -1 : a.localeCompare(b)))
    .map(([project, children]) => ({ kind: 'project', project, by, children }));
}

export function instanceChildren(inst: LxcInstance, docker: DockerState): Node[] {
  const out: Node[] = [];
  if (Array.isArray(docker)) {
    const g = groupByCompose(docker);
    for (const p of g.projects) out.push({ kind: 'compose', inst, project: p.name, containers: p.containers });
    for (const c of g.standalone) out.push({ kind: 'docker', inst, c });
  }
  if (inst.snapshots.length) out.push({ kind: 'snapshots', inst });
  out.push({ kind: 'prop', label: 'Type', value: inst.type });
  for (const ip of inst.ipv4) out.push({ kind: 'prop', label: 'IPv4', value: ip });
  out.push({ kind: 'prop', label: 'Created', value: inst.createdAt.toLocaleString() });
  return out;
}

export function snapshotChildren(inst: LxcInstance): Node[] {
  return inst.snapshots.map((s) => ({ kind: 'snapshot', inst, name: s.name, createdAt: s.createdAt }));
}

export function dockerChildren(c: DockerContainer): Node[] {
  return [
    { kind: 'prop', label: 'Image', value: c.image },
    { kind: 'prop', label: 'Ports', value: c.ports || '—' },
    { kind: 'prop', label: 'Status', value: c.status },
    { kind: 'prop', label: 'ID', value: c.id },
  ];
}
