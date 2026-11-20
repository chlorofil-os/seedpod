import * as vscode from 'vscode';
import { runCli, execArgs, CliError } from '../cli';
import { LxcInstance, parseInstances } from '../model/lxc';
import { DockerContainer, parseDockerPs, classifyDockerError, dockerHoverMarkdown } from '../model/docker';
import { instanceDescription, instanceHoverMarkdown, mdEscape } from '../model/format';
import { Node, GroupBy, buildRoots, instanceChildren, snapshotChildren, dockerChildren, dockerKey } from './nodes';

export const UNREACHABLE = 'LXD not reachable — check seedpod.cliPath';

/**
 * contextValue suffix. Only Running/Frozen/Stopped get lifecycle menus; anything else (Error, Starting, Stopping,
 * Freezing, Unknown, …) is `other` and keeps just the state-independent actions (log, inspect, snapshot, delete).
 */
export function instanceState(status: string): 'running' | 'frozen' | 'stopped' | 'other' {
  switch (status) {
    case 'Running': return 'running';
    case 'Frozen': return 'frozen';
    case 'Stopped': return 'stopped';
    default: return 'other';
  }
}

const green = new vscode.ThemeColor('testing.iconPassed');
const red = new vscode.ThemeColor('testing.iconFailed');

export class ContainersProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private instances: LxcInstance[] = [];
  private loadError?: string;
  private stale = true;
  /** Bumped by every refresh(); a load started under an older generation must not overwrite a newer one. */
  private gen = 0;
  private inflight?: { gen: number; done: Promise<void> };
  private filter = '';
  private groupBy?: GroupBy;
  private readonly docker = new Map<string, DockerContainer[] | 'none'>();
  private readonly dockerErrors = new Map<string, string>();
  private readonly lastStatus = new Map<string, string>();
  private readonly expanded = new Set<string>();

  constructor(private readonly log: vscode.OutputChannel) {}

  /** Re-read `lxc list` on the next render; `docker: true` (manual Refresh) also re-checks Docker in every machine. */
  refresh(opts: { docker?: boolean } = {}): void {
    this.stale = true;
    this.gen++;
    if (opts.docker) {
      this.docker.clear();
      this.dockerErrors.clear();
    }
    this.emitter.fire(undefined);
  }

  setFilter(s: string): void {
    this.filter = s;
    void vscode.commands.executeCommand('setContext', 'seedpod.filterActive', !!s);
    this.emitter.fire(undefined);
  }

  getFilter(): string {
    return this.filter;
  }

  getGroupBy(): GroupBy {
    if (this.groupBy) return this.groupBy;
    const v = vscode.workspace.getConfiguration('seedpod').get<string>('groupBy');
    return v === 'project' || v === 'none' ? v : 'stack';
  }

  toggleGroupBy(): GroupBy {
    const order: GroupBy[] = ['stack', 'project', 'none'];
    this.groupBy = order[(order.indexOf(this.getGroupBy()) + 1) % order.length];
    this.emitter.fire(undefined);
    return this.groupBy;
  }

  markExpanded(inst: LxcInstance): void {
    this.expanded.add(dockerKey(inst));
  }

  unmarkExpanded(inst: LxcInstance): void {
    this.expanded.delete(dockerKey(inst));
  }

  /** Running machines whose node is currently expanded. */
  loadedMachines(): LxcInstance[] {
    return this.instances.filter((i) => i.status === 'Running' && this.expanded.has(dockerKey(i)));
  }

  isNoDocker(inst: LxcInstance): boolean {
    return this.docker.get(dockerKey(inst)) === 'none';
  }

  /** Reload docker for one machine; re-render only when the result changed. */
  async refreshDocker(inst: LxcInstance): Promise<void> {
    const key = dockerKey(inst);
    const before = JSON.stringify(this.docker.get(key) ?? null) + (this.dockerErrors.get(key) ?? '');
    await this.loadDocker(inst);
    const after = JSON.stringify(this.docker.get(key) ?? null) + (this.dockerErrors.get(key) ?? '');
    if (before !== after) this.emitter.fire(undefined);
  }

  /** One `lxc list` per generation: concurrent renders share it, and a superseded result is dropped. */
  private loadInstances(): Promise<void> {
    if (this.inflight?.gen === this.gen) return this.inflight.done;
    const gen = this.gen;
    const done = this.doLoadInstances(gen).finally(() => {
      if (this.inflight?.done === done) this.inflight = undefined;
    });
    this.inflight = { gen, done };
    return done;
  }

  private async doLoadInstances(gen: number): Promise<void> {
    let instances: LxcInstance[];
    let loadError: string | undefined;
    try {
      instances = parseInstances(await runCli(['list', '--all-projects', '--format', 'json']));
    } catch (e) {
      instances = [];
      loadError = UNREACHABLE;
      this.log.appendLine(`lxc list failed: ${(e as Error).message}`);
    }
    // A refresh() arrived while `lxc list` ran: this result may predate it. Keep `stale` set; the render that
    // refresh() triggered loads the newer state.
    if (gen !== this.gen) return;
    this.instances = instances;
    this.loadError = loadError;
    for (const i of this.instances) {
      const key = dockerKey(i);
      if (this.lastStatus.get(key) !== i.status) {
        this.docker.delete(key);
        this.dockerErrors.delete(key);
      }
      this.lastStatus.set(key, i.status);
    }
    this.stale = false;
  }

  private async loadDocker(inst: LxcInstance): Promise<void> {
    const key = dockerKey(inst);
    if (inst.status !== 'Running') {
      this.docker.delete(key);
      return;
    }
    try {
      const out = await runCli(execArgs(inst.name, inst.project, ['docker', 'ps', '-a', '--format', '{{json .}}']));
      this.docker.set(key, parseDockerPs(out));
      this.dockerErrors.delete(key);
    } catch (e) {
      const err = e as CliError;
      const kind = classifyDockerError(err);
      if (kind === 'missing') {
        this.docker.set(key, 'none');
        this.dockerErrors.delete(key);
      } else if (kind === 'down') {
        // Daemon still starting (or stopped): show nothing, and let the poller try again.
        this.docker.set(key, []);
        this.dockerErrors.delete(key);
      } else {
        // Keep an entry so a re-render does not re-query; the poller retries.
        const prev = this.docker.get(key);
        this.docker.set(key, Array.isArray(prev) ? prev : []);
        this.dockerErrors.set(key, `docker: ${err.message.split('\n')[0]}`);
        this.log.appendLine(`docker ps in ${key} failed: ${err.message}`);
      }
    }
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      if (this.stale) await this.loadInstances();
      if (this.loadError) return [{ kind: 'error', message: this.loadError }];
      return buildRoots(this.instances, { groupBy: this.getGroupBy(), filter: this.filter, docker: this.docker });
    }
    switch (node.kind) {
      case 'project':
        return node.children;
      case 'instance': {
        const key = dockerKey(node.inst);
        this.markExpanded(node.inst);
        if (node.inst.status === 'Running' && !this.docker.has(key)) await this.loadDocker(node.inst);
        const kids = instanceChildren(node.inst, this.docker.get(key));
        const err = this.dockerErrors.get(key);
        return err ? [{ kind: 'error', message: err }, ...kids] : kids;
      }
      case 'compose':
        return node.containers.map((c) => ({ kind: 'docker', inst: node.inst, c }));
      case 'docker':
        return dockerChildren(node.c);
      case 'snapshots':
        return snapshotChildren(node.inst);
      default:
        return [];
    }
  }

  async resolveTreeItem(item: vscode.TreeItem, node: Node, token: vscode.CancellationToken): Promise<vscode.TreeItem> {
    if (node.kind !== 'docker' || item.tooltip) return item;
    const c = node.c;
    try {
      const out = await runCli(execArgs(node.inst.name, node.inst.project, ['docker', 'inspect', c.id]));
      if (token.isCancellationRequested) return item;
      const m = new vscode.MarkdownString(dockerHoverMarkdown(out, node.inst.ipv4[0]));
      m.supportHtml = false;
      item.tooltip = m;
    } catch (e) {
      this.log.appendLine(`docker inspect ${c.id} in ${dockerKey(node.inst)} failed: ${(e as Error).message}`);
      item.tooltip = `${c.name}\n${c.image}\n${c.status}`;
    }
    return item;
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const C = vscode.TreeItemCollapsibleState;
    switch (node.kind) {
      case 'error': {
        const t = new vscode.TreeItem(node.message, C.None);
        t.iconPath = new vscode.ThemeIcon('warning');
        t.contextValue = 'seedpod.error';
        return t;
      }
      case 'project': {
        const t = new vscode.TreeItem(node.project, C.Expanded);
        t.id = `${node.by}:${node.project}`;
        t.description = node.by === 'project' ? 'LXD project' : undefined;
        t.tooltip = `${node.by === 'project' ? 'LXD project' : 'Stack'} ${node.project} · ${node.children.length} machine${node.children.length === 1 ? '' : 's'}`;
        t.iconPath = new vscode.ThemeIcon(node.by === 'project' ? 'server-environment' : 'layers');
        t.contextValue = 'seedpod.project';
        return t;
      }
      case 'instance': {
        const i = node.inst;
        const t = new vscode.TreeItem(i.name, C.Collapsed);
        t.id = `instance:${dockerKey(i)}`;
        t.description = instanceDescription(i, new Date());
        t.tooltip = new vscode.MarkdownString(instanceHoverMarkdown(i, new Date()));
        const state = instanceState(i.status);
        t.contextValue = `seedpod.instance.${state}`;
        t.iconPath =
          state === 'running' ? new vscode.ThemeIcon('debug-start', green)
          : state === 'frozen' ? new vscode.ThemeIcon('debug-pause')
          : state === 'stopped' ? new vscode.ThemeIcon('debug-stop', red)
          : i.status === 'Error' ? new vscode.ThemeIcon('error', red)
          : new vscode.ThemeIcon('sync~spin');
        return t;
      }
      case 'compose': {
        const t = new vscode.TreeItem(node.project, C.Collapsed);
        t.id = `compose:${dockerKey(node.inst)}:${node.project}`;
        t.iconPath = new vscode.ThemeIcon('type-hierarchy');
        t.contextValue = 'seedpod.compose';
        t.tooltip = new vscode.MarkdownString(
          [`### ${mdEscape(node.project)}`, '', `Compose project · ${node.containers.length} containers`, '',
            ...node.containers.map((c) => `- ${c.state === 'running' ? '▶' : '■'} ${mdEscape(c.composeService ?? c.name)} · ${mdEscape(c.status)}`)].join('\n'),
        );
        return t;
      }
      case 'docker': {
        const c = node.c;
        const t = new vscode.TreeItem(c.image, C.Collapsed);
        t.id = `docker:${dockerKey(node.inst)}:${c.id}`;
        t.description = `${c.name} · ${c.status}`;
        const running = c.state === 'running';
        t.contextValue = running ? 'seedpod.docker.running' : 'seedpod.docker.stopped';
        t.iconPath = running ? new vscode.ThemeIcon('debug-start', green) : new vscode.ThemeIcon('debug-stop', red);
        return t;
      }
      case 'snapshots': {
        const t = new vscode.TreeItem(`Snapshots (${node.inst.snapshots.length})`, C.Collapsed);
        t.id = `snapshots:${dockerKey(node.inst)}`;
        t.iconPath = new vscode.ThemeIcon('history');
        return t;
      }
      case 'snapshot': {
        const t = new vscode.TreeItem(node.name, C.None);
        t.id = `snapshot:${dockerKey(node.inst)}:${node.name}`;
        t.description = node.createdAt.toLocaleString();
        t.iconPath = new vscode.ThemeIcon('history');
        t.contextValue = 'seedpod.snapshot';
        return t;
      }
      case 'prop': {
        const t = new vscode.TreeItem(node.label, C.None);
        t.description = node.value;
        t.iconPath = new vscode.ThemeIcon('symbol-property');
        return t;
      }
    }
  }
}
