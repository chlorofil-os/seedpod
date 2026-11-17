import { z } from 'zod';
import { runCli, runCliResult, execArgs, snapshotArgs, cliKind, cliPath, CliError, SAFE_NAME, SLOW, SNAPSHOT, STOP_TIMEOUT_S } from '../cli';
import { LxcInstance, parseInstances, parseImages, parseNetworks, parsePools } from '../model/lxc';
import { parseDockerPs, groupByCompose, classifyDockerError, DockerContainer } from '../model/docker';
import { formatUptime } from '../model/format';
import { defaultSnapshotName, validateSnapshotName } from '../model/naming';
import { visibleNetworks } from '../model/resources';

export interface ToolAnnotations { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: boolean }

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  input: z.ZodRawShape;
  annotations: ToolAnnotations;
  write: boolean;
  run(args: Record<string, unknown>): Promise<unknown>;
}

export interface ToolOptions {
  /** Drop every tool that changes state. */
  readOnly: boolean;
  /** Machines no write tool may touch (exec included). */
  protect: string[];
}

const name = (what: string) => z.string().describe(what);

function check(value: unknown, what: string): string {
  if (typeof value !== 'string' || !SAFE_NAME.test(value)) throw new Error(`Invalid ${what}: ${JSON.stringify(value)}`);
  return value;
}

async function machines(): Promise<LxcInstance[]> {
  return parseInstances(await runCli(['list', '--all-projects', '--format', 'json']));
}

async function resolveMachine(machine: unknown, project?: unknown): Promise<LxcInstance> {
  const n = check(machine, 'machine name');
  const p = project === undefined ? undefined : check(project, 'project');
  const found = (await machines()).filter((i) => i.name === n && (!p || i.project === p));
  if (found.length === 0) throw new Error(`No machine named "${n}"${p ? ` in project ${p}` : ''}.`);
  if (found.length > 1) throw new Error(`"${n}" exists in several projects (${found.map((i) => i.project).join(', ')}); pass project.`);
  return found[0];
}

const summarize = (c: DockerContainer) => ({
  name: c.name, image: c.image, state: c.state, status: c.status, ports: c.ports || undefined, service: c.composeService,
});

export function createTools(opts: ToolOptions): ToolDef[] {
  // A snapshot can outlast the client's request timeout; a retry must not start a second copy of the same machine.
  const snapshotting = new Set<string>();
  const guard = (i: LxcInstance) => {
    if (opts.protect.includes(i.name)) throw new Error(`${i.name} is protected (SEEDPOD_PROTECT); write tools refuse to touch it.`);
    return i;
  };
  const ro: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
  const machineArgs = {
    machine: name('LXD instance name, as listed by list_machines'),
    project: z.string().optional().describe('LXD project; only needed when the name exists in several projects'),
  };

  const all: ToolDef[] = [
    {
      name: 'list_machines', title: 'List LXD machines', write: false, annotations: ro,
      description: 'List every LXD instance across projects with status, OS, IPv4, uptime, snapshots and whether it is protected from write tools.',
      input: {},
      run: async () => {
        const now = new Date();
        return {
          machines: (await machines()).map((i) => ({
            name: i.name, project: i.project, type: i.type, status: i.status, os: i.os, ipv4: i.ipv4,
            uptime: i.status === 'Running' && i.lastUsedAt ? formatUptime(i.lastUsedAt, now) : undefined,
            snapshots: i.snapshots.map((s) => s.name), protected: opts.protect.includes(i.name),
          })),
        };
      },
    },
    {
      name: 'machine_info', title: 'Machine config and state', write: false, annotations: ro,
      description: 'Expanded configuration (YAML) and `lxc info` output for one machine.',
      input: machineArgs,
      run: async (a) => {
        const i = await resolveMachine(a.machine, a.project);
        const p = ['--project', i.project];
        return { config: await runCli(['config', 'show', i.name, '--expanded', ...p]), info: await runCli(['info', i.name, ...p]) };
      },
    },
    {
      name: 'machine_log', title: 'Machine log', write: false, annotations: ro,
      description: 'The LXC log for one machine (`lxc info --show-log`).',
      input: machineArgs,
      run: async (a) => {
        const i = await resolveMachine(a.machine, a.project);
        return { log: await runCli(['info', i.name, '--show-log', '--project', i.project]) };
      },
    },
    {
      name: 'list_docker', title: 'Docker containers in a machine', write: false, annotations: ro,
      description: 'Docker containers running inside one LXD machine, grouped by compose project. Reports "not installed" or "daemon not running" instead of failing.',
      input: machineArgs,
      run: async (a) => {
        const i = await resolveMachine(a.machine, a.project);
        if (i.status !== 'Running') return { machine: i.name, docker: `machine is ${i.status.toLowerCase()}` };
        try {
          const g = groupByCompose(parseDockerPs(await runCli(execArgs(i.name, i.project, ['docker', 'ps', '-a', '--format', '{{json .}}']))));
          return {
            machine: i.name,
            compose: g.projects.map((p) => ({ project: p.name, containers: p.containers.map(summarize) })),
            standalone: g.standalone.map(summarize),
          };
        } catch (e) {
          const kind = classifyDockerError(e as CliError);
          if (kind === 'missing') return { machine: i.name, docker: 'not installed' };
          if (kind === 'down') return { machine: i.name, docker: 'daemon not running' };
          throw e;
        }
      },
    },
    {
      name: 'docker_logs', title: 'Docker container logs', write: false, annotations: ro,
      description: 'Recent logs of a Docker container inside a machine (not followed).',
      input: { ...machineArgs, container: name('Container name or ID'), tail: z.number().int().min(1).max(5000).optional().describe('Lines from the end (default 200)'), since: z.string().optional().describe('Docker --since value, e.g. "10m" or an RFC3339 time') },
      run: async (a) => {
        const i = await resolveMachine(a.machine, a.project);
        const c = check(a.container, 'container');
        if (a.since !== undefined && !/^[0-9A-Za-z][0-9A-Za-z:.+-]*$/.test(String(a.since))) throw new Error(`Invalid since: ${JSON.stringify(a.since)}`);
        const since = a.since === undefined ? [] : ['--since', String(a.since)];
        const r = await runCliResult(execArgs(i.name, i.project, ['docker', 'logs', '--tail', String(a.tail ?? 200), ...since, c]));
        return { exitCode: r.exitCode, logs: r.stdout + r.stderr };
      },
    },
    {
      name: 'docker_inspect', title: 'Inspect Docker container', write: false, annotations: ro,
      description: '`docker inspect` for a container inside a machine.',
      input: { ...machineArgs, container: name('Container name or ID') },
      run: async (a) => {
        const i = await resolveMachine(a.machine, a.project);
        return JSON.parse(await runCli(execArgs(i.name, i.project, ['docker', 'inspect', check(a.container, 'container')])));
      },
    },
    {
      name: 'list_resources', title: 'Images, networks and storage', write: false, annotations: ro,
      description: 'LXD images, managed networks and storage pools of the current project.',
      input: {},
      run: async () => ({
        images: parseImages(await runCli(['image', 'list', '--format', 'json'])),
        networks: visibleNetworks(parseNetworks(await runCli(['network', 'list', '--format', 'json'])), false),
        storage: parsePools(await runCli(['storage', 'list', '--format', 'json'])),
      }),
    },
    {
      name: 'machine_action', title: 'Start/stop a machine', write: true,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      description: 'Start, stop, restart, freeze or unfreeze an LXD machine. Stop waits up to 100s for a clean shutdown and never forces.',
      input: { ...machineArgs, action: z.enum(['start', 'stop', 'restart', 'freeze', 'unfreeze']) },
      run: async (a) => {
        const i = guard(await resolveMachine(a.machine, a.project));
        const verb = { start: ['start'], stop: ['stop'], restart: ['restart'], freeze: ['pause'], unfreeze: ['start'] }[a.action as string];
        if (!verb) throw new Error(`Invalid action: ${String(a.action)}`);
        const extra = a.action === 'stop' ? ['--timeout', String(STOP_TIMEOUT_S)] : [];
        await runCli([...verb, i.name, ...extra, '--project', i.project], SLOW);
        return { machine: i.name, action: a.action, ok: true };
      },
    },
    {
      name: 'create_snapshot', title: 'Snapshot a machine', write: true,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      description: 'Create a snapshot of a machine. On a dir pool this copies the whole filesystem and can take minutes; ' +
        'if the call times out, check list_machines before retrying. A second snapshot of the same machine is refused while one runs. ' +
        'There is deliberately no restore or delete tool.',
      input: { ...machineArgs, name: z.string().optional().describe('Snapshot name (default snap-YYYYMMDD-HHmm)') },
      run: async (a) => {
        const i = guard(await resolveMachine(a.machine, a.project));
        const snap = (a.name as string | undefined) ?? defaultSnapshotName(new Date());
        const bad = validateSnapshotName(snap, i.snapshots.map((s) => s.name));
        if (bad) throw new Error(bad);
        const key = `${i.project}/${i.name}`;
        if (snapshotting.has(key)) throw new Error(`A snapshot of ${i.name} is already running; wait for it, then check list_machines.`);
        snapshotting.add(key);
        try {
          await runCli(snapshotArgs(cliKind(cliPath()), 'create', i.name, snap, i.project), SNAPSHOT);
        } finally {
          snapshotting.delete(key);
        }
        return { machine: i.name, snapshot: snap };
      },
    },
    {
      name: 'docker_action', title: 'Start/stop a Docker container', write: true,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      description: 'Start, stop or restart a Docker container inside a machine. Removing containers is not offered.',
      input: { ...machineArgs, container: name('Container name or ID'), action: z.enum(['start', 'stop', 'restart']) },
      run: async (a) => {
        const i = guard(await resolveMachine(a.machine, a.project));
        const action = String(a.action);
        if (!['start', 'stop', 'restart'].includes(action)) throw new Error(`Invalid action: ${action}`);
        await runCli(execArgs(i.name, i.project, ['docker', action, check(a.container, 'container')]), SLOW);
        return { machine: i.name, container: a.container, action, ok: true };
      },
    },
    {
      name: 'compose_action', title: 'Start/stop a compose project', write: true,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      description: 'Start, stop or restart every container of a docker compose project inside a machine.',
      input: {
        machine: machineArgs.machine,
        lxd_project: machineArgs.project,
        compose_project: name('docker compose project name, as listed by list_docker'),
        action: z.enum(['start', 'stop', 'restart']),
      },
      run: async (a) => {
        const i = guard(await resolveMachine(a.machine, a.lxd_project));
        const action = String(a.action);
        if (!['start', 'stop', 'restart'].includes(action)) throw new Error(`Invalid action: ${action}`);
        await runCli(execArgs(i.name, i.project, ['docker', 'compose', '-p', check(a.compose_project, 'compose project'), action]), SLOW);
        return { machine: i.name, compose: a.compose_project, action, ok: true };
      },
    },
    {
      name: 'exec', title: 'Run a command in a machine', write: true,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      description: 'Run a command inside a machine as root and return exit code, stdout and stderr. `command` is an argv array, not a shell string; use ["sh","-c","..."] for shell syntax.',
      input: { ...machineArgs, command: z.array(z.string()).min(1).describe('argv, e.g. ["docker","compose","ps"]'), timeout_seconds: z.number().int().min(1).max(600).optional() },
      run: async (a) => {
        const i = guard(await resolveMachine(a.machine, a.project));
        const cmd = a.command as string[];
        if (!Array.isArray(cmd) || cmd.length === 0 || !cmd.every((x) => typeof x === 'string')) throw new Error('command must be a non-empty array of strings');
        const r = await runCliResult(execArgs(i.name, i.project, cmd), { timeoutMs: ((a.timeout_seconds as number | undefined) ?? 60) * 1000 });
        return { machine: i.name, ...r };
      },
    },
  ];
  return opts.readOnly ? all.filter((t) => !t.write) : all;
}
