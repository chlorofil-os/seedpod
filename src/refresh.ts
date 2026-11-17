import * as vscode from 'vscode';
import type { ChildProcess } from 'node:child_process';
import { spawnCli } from './cli';
import { Debouncer, nextBackoff, isStateEvent } from './refresh-core';
import type { ContainersProvider } from './tree/containersProvider';

/** Follows `lxc monitor` lifecycle events and calls onEvent (debounced). Restarts with backoff when the process dies. */
export class LxcMonitor implements vscode.Disposable {
  private child?: ChildProcess;
  private restartTimer?: NodeJS.Timeout;
  private backoff = 0;
  private disposed = false;
  private debouncer?: Debouncer;

  constructor(private readonly log: vscode.OutputChannel) {}

  start(onEvent: () => void): void {
    this.debouncer = new Debouncer(500, onEvent);
    this.spawn();
  }

  /** Restart now (e.g. after seedpod.cliPath changed) with a fresh backoff. */
  restart(): void {
    this.backoff = 0;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    const old = this.child;
    this.child = undefined;
    old?.kill();
    this.spawn();
  }

  private spawn(): void {
    if (this.disposed) return;
    const startedAt = Date.now();
    let ended = false;
    const reconnect = this.backoff > 0;
    const child = spawnCli(['monitor', '--all-projects', '--type=lifecycle', '--format', 'json']);
    this.child = child;
    let buf = '';
    child.stdout?.on('data', (d) => {
      buf += String(d);
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      if (lines.some((l) => l.trim() && isStateEvent(l))) this.debouncer?.trigger();
    });
    // After an outage (LXD restarted, snap refresh) nothing else would tell the views to reload.
    const healthy = reconnect ? setTimeout(() => {
      if (!ended && this.child === child) this.debouncer?.trigger();
    }, 2000) : undefined;
    child.stderr?.on('data', (d) => this.log.appendLine(`monitor: ${String(d).trim()}`));
    const onEnd = (why: string) => {
      if (ended || this.disposed || this.child !== child) return;
      ended = true;
      if (healthy) clearTimeout(healthy);
      if (Date.now() - startedAt > 60_000) this.backoff = 0;
      this.backoff = nextBackoff(this.backoff);
      this.log.appendLine(`monitor ${why}; restarting in ${this.backoff / 1000}s`);
      this.restartTimer = setTimeout(() => this.spawn(), this.backoff);
    };
    child.on('error', (e) => onEnd(`failed: ${e.message}`));
    child.on('close', (code) => onEnd(`exited (${code})`));
  }

  dispose(): void {
    this.disposed = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.debouncer?.dispose();
    this.child?.kill();
  }
}

/** Polls docker inside running machines the user has expanded; LXD events do not cover nested Docker. */
export class DockerPoller implements vscode.Disposable {
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly provider: ContainersProvider) {}

  configure(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const secs = vscode.workspace.getConfiguration('seedpod').get<number>('docker.pollInterval') ?? 10;
    if (secs > 0) this.timer = setInterval(() => void this.tick(), secs * 1000);
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const inst of this.provider.loadedMachines()) {
        if (!this.provider.isNoDocker(inst)) await this.provider.refreshDocker(inst);
      }
    } finally {
      this.busy = false;
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
