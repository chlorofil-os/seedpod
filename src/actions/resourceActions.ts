import * as vscode from 'vscode';
import { runCli } from '../cli';
import { openInspect } from '../inspect';
import type { ResNode } from '../tree/resourceProviders';
import { confirm, withProgress } from './ui';

export function registerResourceActions(images: { refresh(): void }): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('seedpod.image.delete', async (n: ResNode) => {
      if (n?.kind !== 'image') return;
      const label = n.image.alias ?? n.image.fingerprint.slice(0, 12);
      if (!(await confirm(`Delete image ${label}?`, 'Delete'))) return;
      await withProgress(`Deleting image ${label}`, () => runCli(['image', 'delete', n.image.fingerprint]));
      images.refresh();
    }),
    vscode.commands.registerCommand('seedpod.network.inspect', (n: ResNode) =>
      n?.kind === 'network' ? openInspect(`network-${n.net.name}`, [['network', 'show', n.net.name]], 'yaml') : undefined),
    vscode.commands.registerCommand('seedpod.storage.inspect', (n: ResNode) =>
      n?.kind === 'pool' ? openInspect(`storage-${n.pool.name}`, [['storage', 'show', n.pool.name]], 'yaml') : undefined),
  ];
}
