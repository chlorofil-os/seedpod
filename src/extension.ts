import * as vscode from 'vscode';
import { setCliPathResolver } from './cli';
import { ContainersProvider } from './tree/containersProvider';
import { ImagesProvider, NetworksProvider, StorageProvider } from './tree/resourceProviders';
import { InspectProvider, INSPECT_SCHEME } from './inspect';
import { registerResourceActions } from './actions/resourceActions';
import { registerLxcActions } from './actions/lxcActions';
import { registerDockerActions } from './actions/dockerActions';
import { LxcMonitor, DockerPoller } from './refresh';
import type { Node } from './tree/nodes';

export function activate(context: vscode.ExtensionContext): void {
  setCliPathResolver(() => vscode.workspace.getConfiguration('seedpod').get<string>('cliPath'));
  const log = vscode.window.createOutputChannel('Seedpod');
  const containers = new ContainersProvider(log);
  const images = new ImagesProvider(log);
  const networks = new NetworksProvider(log);
  const storage = new StorageProvider(log);

  const containersView = vscode.window.createTreeView<Node>('seedpod.containers', { treeDataProvider: containers, showCollapseAll: true });
  containersView.onDidExpandElement((e) => {
    if (e.element.kind === 'instance') containers.markExpanded(e.element.inst);
  });
  containersView.onDidCollapseElement((e) => {
    if (e.element.kind === 'instance') containers.unmarkExpanded(e.element.inst);
  });

  const setRemoteSsh = () =>
    vscode.commands.executeCommand('setContext', 'seedpod.hasRemoteSsh', !!vscode.extensions.getExtension('ms-vscode-remote.remote-ssh'));
  void setRemoteSsh();

  const refreshAll = () => {
    containers.refresh({ docker: true });
    images.refresh();
    networks.refresh();
    storage.refresh();
  };

  const monitor = new LxcMonitor(log);
  monitor.start(() => {
    containers.refresh();
    images.refresh();
    storage.refresh();
  });
  const poller = new DockerPoller(containers);
  poller.configure();

  context.subscriptions.push(
    log,
    monitor,
    poller,
    containersView,
    vscode.window.registerTreeDataProvider('seedpod.images', images),
    vscode.window.registerTreeDataProvider('seedpod.networks', networks),
    vscode.window.registerTreeDataProvider('seedpod.storage', storage),
    vscode.workspace.registerTextDocumentContentProvider(INSPECT_SCHEME, new InspectProvider()),
    vscode.commands.registerCommand('seedpod.refresh', refreshAll),
    vscode.commands.registerCommand('seedpod.images.refresh', () => images.refresh()),
    vscode.commands.registerCommand('seedpod.networks.refresh', () => networks.refresh()),
    vscode.commands.registerCommand('seedpod.storage.refresh', () => storage.refresh()),
    ...registerResourceActions(images),
    ...registerLxcActions(containers),
    ...registerDockerActions(containers),
    vscode.extensions.onDidChange(setRemoteSsh),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('seedpod.cliPath')) {
        refreshAll();
        monitor.restart();
      }
      if (e.affectsConfiguration('seedpod.docker.pollInterval')) poller.configure();
      if (e.affectsConfiguration('seedpod.networks.showUnmanaged')) networks.refresh();
    }),
  );
}

export function deactivate(): void {}
