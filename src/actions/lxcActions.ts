import * as vscode from 'vscode';
import { runCli, cliPath, cliKind, execArgs, snapshotArgs, shellCommand, isStopTimeout, SLOW, SNAPSHOT, STOP_TIMEOUT_S, CliError, SAFE_NAME } from '../cli';
import { planMachineSettings, resolveRemoteFolder, splitHome, READ_SETUP, WRITE_SETUP } from '../model/remote';
import { openInspect } from '../inspect';
import { defaultSnapshotName, validateSnapshotName } from '../model/naming';
import type { LxcInstance } from '../model/lxc';
import type { Node } from '../tree/nodes';
import type { ContainersProvider } from '../tree/containersProvider';
import { confirm, withProgress } from './ui';

const instOf = (n: Node | undefined): LxcInstance | undefined =>
  n && (n.kind === 'instance' || n.kind === 'snapshot' || n.kind === 'snapshots') ? n.inst : undefined;

export function openShell(name: string, args: string[]): void {
  const t = vscode.window.createTerminal({ name, shellPath: cliPath(), shellArgs: args });
  t.show();
}

export function registerLxcActions(provider: ContainersProvider): vscode.Disposable[] {
  const proj = (i: LxcInstance) => ['--project', i.project];
  const lifecycle = (verb: string, title: (i: LxcInstance) => string, extra: string[] = []) =>
    async (n: Node) => {
      const i = instOf(n);
      if (!i) return;
      await withProgress(title(i), () => runCli([verb, i.name, ...extra, ...proj(i)], SLOW));
      provider.refresh();
    };

  return [
    vscode.commands.registerCommand('seedpod.instance.start', lifecycle('start', (i) => `Starting ${i.name}`)),
    vscode.commands.registerCommand('seedpod.instance.restart', lifecycle('restart', (i) => `Restarting ${i.name}`)),
    vscode.commands.registerCommand('seedpod.instance.freeze', lifecycle('pause', (i) => `Freezing ${i.name}`)),
    vscode.commands.registerCommand('seedpod.instance.unfreeze', lifecycle('start', (i) => `Unfreezing ${i.name}`)),

    vscode.commands.registerCommand('seedpod.instance.stop', async (n: Node) => {
      const i = instOf(n);
      if (!i) return;
      try {
        // LXD enforces the timeout itself, so the client never gives up while the server is still stopping.
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Stopping ${i.name}` }, () =>
          runCli(['stop', i.name, '--timeout', String(STOP_TIMEOUT_S), ...proj(i)], SLOW));
      } catch (e) {
        const msg = (e as Error).message;
        if (isStopTimeout(e as CliError)) {
          const force = await confirm(`${i.name} did not stop within ${STOP_TIMEOUT_S}s.`, 'Force stop', msg);
          if (force) await withProgress(`Force-stopping ${i.name}`, () => runCli(['stop', i.name, '--force', ...proj(i)], SLOW));
        } else {
          void vscode.window.showErrorMessage(`Stopping ${i.name} failed: ${msg}`);
        }
      }
      provider.refresh();
    }),

    vscode.commands.registerCommand('seedpod.instance.shell', (n: Node) => {
      const i = instOf(n);
      if (i) openShell(i.name, execArgs(i.name, i.project, shellCommand(true)));
    }),

    vscode.commands.registerCommand('seedpod.instance.log', (n: Node) => {
      const i = instOf(n);
      if (i) return openInspect(`${i.name}-log`, [['info', i.name, '--show-log', ...proj(i)]], 'log');
    }),

    vscode.commands.registerCommand('seedpod.instance.inspect', (n: Node) => {
      const i = instOf(n);
      if (i) return openInspect(i.name, [['config', 'show', i.name, '--expanded', ...proj(i)], ['info', i.name, ...proj(i)]], 'yaml');
    }),

    vscode.commands.registerCommand('seedpod.instance.copyIp', async (n: Node) => {
      const ip = instOf(n)?.ipv4[0];
      if (!ip) return void vscode.window.showInformationMessage('This container has no IPv4 address.');
      await vscode.env.clipboard.writeText(ip);
      vscode.window.setStatusBarMessage(`Copied ${ip}`, 3000);
    }),

    vscode.commands.registerCommand('seedpod.instance.remoteSsh', async (n: Node) => {
      const i = instOf(n);
      const ip = i?.ipv4[0];
      if (!i || !ip) return void vscode.window.showInformationMessage('This container has no IPv4 address.');
      const c = vscode.workspace.getConfiguration('seedpod.remoteSsh');
      const user = c.get<string>('user') || 'ubuntu';
      if (!SAFE_NAME.test(user)) return void vscode.window.showErrorMessage(`seedpod.remoteSsh.user is not a valid user name: ${user}`);
      const folder = c.get<string>('folder') ?? '';
      const wanted = c.get<Record<string, unknown>>('machineSettings') ?? {};
      const authority = `ssh-remote+${user}@${ip}`;

      let target: string | undefined;
      if (folder.trim() || Object.keys(wanted).length) {
        try {
          await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Setting up VS Code on ${i.name}` }, async () => {
            const { home, settings } = splitHome(await runCli(execArgs(i.name, i.project, ['sh', '-c', READ_SETUP, 'sh', user])));
            target = resolveRemoteFolder(folder, home);
            if (!Object.keys(wanted).length) return;
            const plan = planMachineSettings(settings, wanted);
            if (plan.kind === 'invalid') {
              void vscode.window.showWarningMessage(`Left ${home}/.vscode-server/data/Machine/settings.json on ${i.name} unchanged: it is not plain JSON (${plan.reason}).`);
            } else if (plan.kind === 'write') {
              await runCli(execArgs(i.name, i.project, ['sh', '-c', WRITE_SETUP, 'sh', user, plan.text]));
            }
          });
        } catch (e) {
          void vscode.window.showWarningMessage(`Could not set up VS Code on ${i.name}: ${(e as Error).message}. Opening it anyway.`);
          target = folder.trim().startsWith('/') ? folder.trim() : undefined;
        }
      }
      if (target) {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.from({ scheme: 'vscode-remote', authority, path: target }), { forceNewWindow: true });
      } else {
        await vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: authority, reuseWindow: false });
      }
    }),

    vscode.commands.registerCommand('seedpod.instance.snapshot', async (n: Node) => {
      const i = instOf(n);
      if (!i) return;
      const existing = i.snapshots.map((s) => s.name);
      const name = await vscode.window.showInputBox({
        title: `Snapshot ${i.name}`,
        value: defaultSnapshotName(new Date()),
        validateInput: (s) => validateSnapshotName(s, existing),
      });
      if (!name) return;
      await withProgress(`Snapshotting ${i.name}`, () => runCli(snapshotArgs(cliKind(cliPath()), 'create', i.name, name, i.project), SNAPSHOT));
      provider.refresh();
    }),

    vscode.commands.registerCommand('seedpod.snapshot.restore', async (n: Node) => {
      if (n?.kind !== 'snapshot') return;
      const { inst: i, name } = n;
      if (!(await confirm(`Restore ${i.name} to snapshot "${name}"?`, 'Restore', 'The container\'s current state is lost.'))) return;
      await withProgress(`Restoring ${i.name}`, () => runCli(snapshotArgs(cliKind(cliPath()), 'restore', i.name, name, i.project), SNAPSHOT));
      provider.refresh();
    }),

    vscode.commands.registerCommand('seedpod.snapshot.delete', async (n: Node) => {
      if (n?.kind !== 'snapshot') return;
      const { inst: i, name } = n;
      if (!(await confirm(`Delete snapshot "${name}" of ${i.name}?`, 'Delete'))) return;
      await withProgress(`Deleting snapshot ${name}`, () => runCli(snapshotArgs(cliKind(cliPath()), 'delete', i.name, name, i.project), SNAPSHOT));
      provider.refresh();
    }),

    vscode.commands.registerCommand('seedpod.instance.delete', async (n: Node) => {
      const i = instOf(n);
      if (!i) return;
      const running = i.status !== 'Stopped';
      if (!(await confirm(`Delete container ${i.name}?`, 'Delete', 'This removes the container and all its snapshots. It cannot be undone.'))) return;
      if (running && !(await confirm(`${i.name} is ${i.status.toLowerCase()}. Force-delete it?`, 'Force delete'))) return;
      await withProgress(`Deleting ${i.name}`, () => runCli(['delete', i.name, ...(running ? ['--force'] : []), ...proj(i)], SLOW));
      provider.refresh();
    }),

    vscode.commands.registerCommand('seedpod.filter', async () => {
      const s = await vscode.window.showInputBox({ title: 'Filter containers', prompt: 'Name substring (matches loaded Docker containers too). Empty clears.', value: provider.getFilter() });
      if (s !== undefined) provider.setFilter(s);
    }),
    vscode.commands.registerCommand('seedpod.clearFilter', () => provider.setFilter('')),
    vscode.commands.registerCommand('seedpod.groupBy', () => provider.toggleGroupBy()),
  ];
}
