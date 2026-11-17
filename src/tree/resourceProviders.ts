import * as vscode from 'vscode';
import { runCli } from '../cli';
import { LxcImage, LxcNetwork, LxcPool, LxcVolume, parseImages, parseNetworks, parsePools, parseVolumes } from '../model/lxc';
import { visibleNetworks } from '../model/resources';
import { UNREACHABLE } from './containersProvider';

export type ResNode =
  | { kind: 'error'; message: string }
  | { kind: 'image'; image: LxcImage }
  | { kind: 'network'; net: LxcNetwork }
  | { kind: 'pool'; pool: LxcPool }
  | { kind: 'volume'; pool: string; vol: LxcVolume };

abstract class BaseProvider implements vscode.TreeDataProvider<ResNode> {
  protected readonly emitter = new vscode.EventEmitter<ResNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  constructor(protected readonly log: vscode.OutputChannel) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  protected abstract roots(): Promise<ResNode[]>;
  protected async children(_n: ResNode): Promise<ResNode[]> {
    return [];
  }
  abstract getTreeItem(n: ResNode): vscode.TreeItem;

  async getChildren(n?: ResNode): Promise<ResNode[]> {
    try {
      return n ? await this.children(n) : await this.roots();
    } catch (e) {
      this.log.appendLine(`${this.constructor.name}: ${(e as Error).message}`);
      return [{ kind: 'error', message: n ? (e as Error).message.split('\n')[0] : UNREACHABLE }];
    }
  }

  protected errorItem(message: string): vscode.TreeItem {
    const t = new vscode.TreeItem(message);
    t.iconPath = new vscode.ThemeIcon('warning');
    t.contextValue = 'seedpod.error';
    return t;
  }
}

export class ImagesProvider extends BaseProvider {
  protected async roots(): Promise<ResNode[]> {
    return parseImages(await runCli(['image', 'list', '--format', 'json'])).map((image) => ({ kind: 'image', image }));
  }
  getTreeItem(n: ResNode): vscode.TreeItem {
    if (n.kind !== 'image') return this.errorItem(n.kind === 'error' ? n.message : '');
    const t = new vscode.TreeItem(n.image.alias ?? n.image.fingerprint.slice(0, 12));
    t.id = `image:${n.image.fingerprint}`;
    t.description = `${n.image.description} · ${(n.image.size / 1048576).toFixed(1)} MiB`;
    t.tooltip = `${n.image.fingerprint}\n${n.image.description}\n${n.image.type}`;
    t.iconPath = new vscode.ThemeIcon('package');
    t.contextValue = 'seedpod.image';
    return t;
  }
}

export class NetworksProvider extends BaseProvider {
  protected async roots(): Promise<ResNode[]> {
    const show = vscode.workspace.getConfiguration('seedpod').get<boolean>('networks.showUnmanaged') ?? false;
    return visibleNetworks(parseNetworks(await runCli(['network', 'list', '--format', 'json'])), show).map((net) => ({ kind: 'network', net }));
  }
  getTreeItem(n: ResNode): vscode.TreeItem {
    if (n.kind !== 'network') return this.errorItem(n.kind === 'error' ? n.message : '');
    const t = new vscode.TreeItem(n.net.name);
    t.id = `network:${n.net.name}`;
    t.description = [n.net.type, n.net.ipv4, n.net.managed ? `used by ${n.net.usedBy}` : 'unmanaged'].filter(Boolean).join(' · ');
    t.iconPath = new vscode.ThemeIcon('type-hierarchy');
    t.contextValue = 'seedpod.network';
    return t;
  }
}

export class StorageProvider extends BaseProvider {
  protected async roots(): Promise<ResNode[]> {
    return parsePools(await runCli(['storage', 'list', '--format', 'json'])).map((pool) => ({ kind: 'pool', pool }));
  }
  protected async children(n: ResNode): Promise<ResNode[]> {
    if (n.kind !== 'pool') return [];
    const vols = parseVolumes(await runCli(['storage', 'volume', 'list', n.pool.name, '--format', 'json']));
    return vols.map((vol) => ({ kind: 'volume', pool: n.pool.name, vol }));
  }
  getTreeItem(n: ResNode): vscode.TreeItem {
    if (n.kind === 'pool') {
      const t = new vscode.TreeItem(n.pool.name, vscode.TreeItemCollapsibleState.Collapsed);
      t.id = `pool:${n.pool.name}`;
      t.description = `${n.pool.driver} · used by ${n.pool.usedBy}`;
      t.tooltip = n.pool.source;
      t.iconPath = new vscode.ThemeIcon('database');
      t.contextValue = 'seedpod.pool';
      return t;
    }
    if (n.kind === 'volume') {
      const t = new vscode.TreeItem(n.vol.name);
      t.id = `volume:${n.pool}:${n.vol.type}:${n.vol.name}`;
      t.description = `${n.vol.type} · ${n.vol.contentType}`;
      t.iconPath = new vscode.ThemeIcon('database');
      return t;
    }
    return this.errorItem(n.kind === 'error' ? n.message : '');
  }
}
