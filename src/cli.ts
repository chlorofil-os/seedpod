import { execFile, spawn, ChildProcess } from 'node:child_process';
import * as path from 'node:path';

export type Cli = 'lxc' | 'incus';

export class CliError extends Error {
  constructor(message: string, public code: number | string | undefined, public stderr: string, public timedOut = false) {
    super(message);
  }
}

let resolver: (() => string | undefined) | undefined;

/** The extension plugs in its `seedpod.cliPath` setting here; standalone users (the MCP server) fall back to $SEEDPOD_CLI. */
export function setCliPathResolver(fn: (() => string | undefined) | undefined): void {
  resolver = fn;
}

export function cliPath(): string {
  return resolver?.() || process.env.SEEDPOD_CLI || 'lxc';
}

export function cliKind(p: string): Cli {
  return path.basename(p) === 'incus' ? 'incus' : 'lxc';
}

export function snapshotArgs(kind: Cli, op: 'create' | 'restore' | 'delete', instance: string, snap: string, project: string): string[] {
  const proj = ['--project', project];
  if (kind === 'incus') {
    return ['snapshot', op, instance, snap, ...proj];
  }
  switch (op) {
    case 'create': return ['snapshot', instance, snap, ...proj];
    case 'restore': return ['restore', instance, snap, ...proj];
    case 'delete': return ['delete', `${instance}/${snap}`, ...proj];
  }
}

export function execArgs(instance: string, project: string, cmd: string[]): string[] {
  return ['exec', instance, '--project', project, '--', ...cmd];
}

export function runCli(args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cliPath(), args, { timeout: opts.timeoutMs ?? 15000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean; signal?: string | null };
        const how = e.killed ? `timed out after ${(opts.timeoutMs ?? 15000) / 1000}s` : e.signal ? `killed by ${e.signal}` : `exit code ${e.code}`;
        reject(new CliError(stderr.trim() || `${path.basename(cliPath())} ${args.join(' ')}: ${how}`, e.code, stderr, !!e.killed));
        return;
      }
      resolve(stdout);
    });
    // lxc reads YAML from stdin when it is not a TTY (e.g. `lxc snapshot`); an open pipe hangs it.
    child.stdin?.end();
  });
}

export function spawnCli(args: string[]): ChildProcess {
  return spawn(cliPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** `sh -c` wrapper that prefers bash. It keeps stderr intact (bash writes its prompt there) and uses an explicit branch, because dash/busybox abort the script on a failed `exec`. */
export function shellCommand(login: boolean): string[] {
  const l = login ? ' -l' : '';
  return ['sh', '-c', `if command -v bash >/dev/null 2>&1; then exec bash${l}; else exec sh${l}; fi`];
}

/** Shared timeouts for lifecycle calls (extension and MCP server alike). */
export const SLOW = { timeoutMs: 120_000 };
/** Snapshots on a `dir` pool copy the whole filesystem; allow far longer than lifecycle calls. */
export const SNAPSHOT = { timeoutMs: 600_000 };
/** Below SLOW's client timeout, so LXD reports the timeout rather than the client being killed. */
export const STOP_TIMEOUT_S = 100;

/**
 * `lxc stop --timeout` expired; the only stop failure for which force-stopping is the right offer.
 * Our own client kill (`timedOut`) and transport errors (`dial unix … i/o timeout`) are not: LXD never reported a stop timeout.
 */
export function isStopTimeout(err: string | { message: string; timedOut?: boolean }): boolean {
  const message = typeof err === 'string' ? err : err.message;
  if (typeof err !== 'string' && err.timedOut) return false;
  if (/i\/o timeout|dial (unix|tcp)|connection refused|timed out after \d+s/i.test(message)) return false;
  return /deadline exceeded|timed? ?out/i.test(message);
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Allowlist for calls an `seedpod-inspect:` document may run; the URI is attacker-reachable, so only read-only shapes pass. */
export function isReadOnlyCall(args: string[]): boolean {
  const [a, b] = args;
  if (a === 'config' && b === 'show') return true;
  if (a === 'info') return true;
  if ((a === 'network' || a === 'storage') && b === 'show') return true;
  if (a === 'exec') {
    return args.length === 8 && args[2] === '--project' && args[4] === '--' && args[5] === 'docker' && args[6] === 'inspect' && SAFE_ID.test(args[7]);
  }
  return false;
}

/** Like runCli, but a non-zero exit resolves with its code instead of rejecting (for running arbitrary commands). */
export function runCliResult(args: string[], opts: { timeoutMs?: number } = {}): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = execFile(cliPath(), args, { timeout: opts.timeoutMs ?? 60000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean; signal?: string }) | null;
      if (e && typeof e.code !== 'number' && !e.killed) {
        reject(new CliError(e.message, e.code, stderr));
        return;
      }
      resolve({ exitCode: e ? (typeof e.code === 'number' ? e.code : -1) : 0, stdout, stderr, timedOut: !!e?.killed });
    });
    // lxc reads YAML from stdin when it is not a TTY (e.g. `lxc snapshot`); an open pipe hangs it.
    child.stdin?.end();
  });
}

export const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
