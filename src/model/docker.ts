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
