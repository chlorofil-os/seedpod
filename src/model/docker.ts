import { mdEscape as md } from './format';

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  composeProject?: string;
  composeService?: string;
}

/** `docker ps --format '{{json .}}'` flattens labels into "k=v,k=v"; values may contain commas, so match keys by anchor. */
function label(labels: string, key: string): string | undefined {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|,)${esc}=([^,]*)`).exec(labels);
  return m ? m[1] : undefined;
}

export function parseDockerPs(out: string): DockerContainer[] {
  const result: DockerContainer[] = [];
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const labels = String(o.Labels ?? '');
    result.push({
      id: String(o.ID ?? ''),
      name: String(o.Names ?? ''),
      image: String(o.Image ?? ''),
      state: String(o.State ?? ''),
      status: String(o.Status ?? ''),
      ports: String(o.Ports ?? ''),
      composeProject: label(labels, 'com.docker.compose.project'),
      composeService: label(labels, 'com.docker.compose.service'),
    });
  }
  return result;
}

const byName = (a: DockerContainer, b: DockerContainer) => a.name.localeCompare(b.name);

export function groupByCompose(cs: DockerContainer[]): { projects: { name: string; containers: DockerContainer[] }[]; standalone: DockerContainer[] } {
  const map = new Map<string, DockerContainer[]>();
  const standalone: DockerContainer[] = [];
  for (const c of cs) {
    if (c.composeProject) {
      const list = map.get(c.composeProject) ?? [];
      list.push(c);
      map.set(c.composeProject, list);
    } else {
      standalone.push(c);
    }
  }
  const projects = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, containers]) => ({ name, containers: containers.sort(byName) }));
  return { projects, standalone: standalone.sort(byName) };
}

/** missing = no docker binary (stable, cache it); down = daemon not answering yet (retry); error = anything else. */
export function classifyDockerError(e: { code?: number | string; stderr?: string }): 'missing' | 'down' | 'error' {
  const err = e.stderr ?? '';
  if (e.code === 127 || /executable file not found|command not found|not found in \$PATH/i.test(err)) return 'missing';
  if (/Cannot connect to the Docker daemon|Is the docker daemon running/i.test(err)) return 'down';
  return 'error';
}

export function isNoDockerError(e: { code?: number | string; stderr?: string }): boolean {
  return classifyDockerError(e) !== 'error';
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const MOUNT_KIND: Record<string, string> = { volume: 'Named volume', bind: 'Bind mount', tmpfs: 'tmpfs', npipe: 'Named pipe' };

/**
 * Markdown hover for one container from `docker inspect <id>` output: name and short ID, then Image, Ports, Volumes,
 * Networks. Published ports link to `http://<machineIp>:<port>`; a port bound to loopback inside the machine is not
 * reachable from the host, so it stays plain text.
 */
export function dockerHoverMarkdown(inspectJson: string, machineIp?: string): string {
  const arr: any[] = JSON.parse(inspectJson);
  const c = Array.isArray(arr) ? arr[0] : undefined;
  if (!c) throw new Error('docker inspect returned no container');
  const name = String(c.Name ?? '').replace(/^\//, '');
  const id = String(c.Id ?? '').slice(0, 12);
  const imageId = String(c.Image ?? '').replace(/^sha256:/, '').slice(0, 12);
  const out: string[] = [`### ${md(name)} (${md(id)})`, '', '#### Image', '', `${md(String(c.Config?.Image ?? ''))}${imageId ? ` (${imageId})` : ''}`];

  const ports: string[] = [];
  const seen = new Set<string>();
  for (const [key, binds] of Object.entries<any>(c.NetworkSettings?.Ports ?? {})) {
    const [cport, proto = 'tcp'] = key.split('/');
    if (!Array.isArray(binds) || binds.length === 0) continue;
    for (const b of binds) {
      const hostIp = String(b.HostIp ?? '');
      const hostPort = String(b.HostPort ?? '');
      const loopback = hostIp.startsWith('127.') || hostIp === '::1';
      const dedupe = `${loopback ? hostIp : '*'}:${hostPort}/${cport}/${proto}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const target = !hostIp || hostIp === '0.0.0.0' || hostIp === '::' ? machineIp : loopback ? undefined : hostIp;
      const shown = loopback ? `${hostIp}:${hostPort}` : hostPort;
      const link = target ? `[${md(shown)}](http://${target.includes(':') ? `[${target}]` : target}:${hostPort})` : md(shown);
      ports.push(`- ${link} ➔ ${md(cport)} ${md(proto)}`);
    }
  }
  if (ports.length) out.push('', '#### Ports', '', ...ports);

  const mounts = (c.Mounts ?? []).map((m: any) => {
    const src = m.Type === 'volume' ? m.Name : m.Source;
    const kind = MOUNT_KIND[m.Type] ?? String(m.Type ?? '');
    return `- ${md(String(src ?? ''))} ➔ ${md(String(m.Destination ?? ''))} (${md(kind)}, ${m.RW ? 'RW' : 'RO'})`;
  });
  if (mounts.length) out.push('', '#### Volumes', '', ...mounts);

  const nets = Object.keys(c.NetworkSettings?.Networks ?? {}).sort().map((n) => `- ${md(n)}`);
  if (nets.length) out.push('', '#### Networks', '', ...nets);
  return out.join('\n');
}
