export interface LxcSnapshot { name: string; createdAt: Date }

export interface LxcInstance {
  name: string;
  project: string;
  status: 'Running' | 'Stopped' | 'Frozen' | string;
  type: 'container' | 'virtual-machine' | string;
  os?: string;
  ipv4: string[];
  lastUsedAt?: Date;
  createdAt: Date;
  snapshots: LxcSnapshot[];
}

export interface LxcImage { fingerprint: string; alias?: string; description: string; size: number; type: string }
export interface LxcNetwork { name: string; type: string; managed: boolean; ipv4?: string; usedBy: number }
export interface LxcPool { name: string; driver: string; source?: string; usedBy: number }
export interface LxcVolume { name: string; type: string; contentType: string }

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Interfaces that belong to nested container runtimes or loopback, not the machine's own address. */
const HIDDEN_IFACE = /^(lo|docker\d*|br-|veth|cni|flannel|virbr)/;

function date(s: unknown): Date | undefined {
  if (typeof s !== 'string' || s.startsWith('0001-')) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

function ipv4Of(network: Record<string, any> | null | undefined): string[] {
  if (!network) return [];
  const names = Object.keys(network).filter((n) => !HIDDEN_IFACE.test(n));
  names.sort((a, b) => (a === 'eth0' ? -1 : b === 'eth0' ? 1 : a.localeCompare(b)));
  const out: string[] = [];
  for (const n of names) {
    for (const a of network[n]?.addresses ?? []) {
      if (a.family === 'inet' && !String(a.address).startsWith('127.')) out.push(a.address);
    }
  }
  return out;
}

function osOf(cfg: Record<string, string> | undefined): string | undefined {
  const os = cfg?.['image.os'];
  if (!os) return undefined;
  const ver = cfg?.['image.version'] ?? cfg?.['image.release'];
  return ver ? `${os.toLowerCase()} ${ver}` : os.toLowerCase();
}

export function parseInstances(json: string): LxcInstance[] {
  const arr: any[] = JSON.parse(json) ?? [];
  return arr.map((c) => ({
    name: c.name,
    project: c.project || 'default',
    status: c.status,
    type: c.type,
    os: osOf(c.expanded_config),
    ipv4: ipv4Of(c.state?.network),
    lastUsedAt: date(c.last_used_at),
    createdAt: date(c.created_at) ?? new Date(0),
    snapshots: (c.snapshots ?? []).map((s: any) => ({ name: s.name, createdAt: date(s.created_at) ?? new Date(0) })),
  }));
}

export function parseImages(json: string): LxcImage[] {
  const arr: any[] = JSON.parse(json) ?? [];
  return arr.map((i) => ({
    fingerprint: i.fingerprint,
    alias: i.aliases?.[0]?.name,
    description: i.properties?.description ?? '',
    size: i.size ?? 0,
    type: i.type,
  }));
}

export function parseNetworks(json: string): LxcNetwork[] {
  const arr: any[] = JSON.parse(json) ?? [];
  return arr.map((n) => ({
    name: n.name,
    type: n.type,
    managed: !!n.managed,
    ipv4: n.config?.['ipv4.address'] || undefined,
    usedBy: (n.used_by ?? []).length,
  }));
}

export function parsePools(json: string): LxcPool[] {
  const arr: any[] = JSON.parse(json) ?? [];
  return arr.map((p) => ({ name: p.name, driver: p.driver, source: p.config?.source, usedBy: (p.used_by ?? []).length }));
}

export function parseVolumes(json: string): LxcVolume[] {
  const arr: any[] = JSON.parse(json) ?? [];
  return arr
    .filter((v) => !String(v.name).includes('/'))
    .map((v) => ({ name: v.name, type: v.type, contentType: v.content_type ?? '' }));
}
