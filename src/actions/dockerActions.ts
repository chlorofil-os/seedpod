import * as vscode from 'vscode';
import { runCli, execArgs, shellCommand, SLOW } from '../cli';
import { openInspect } from '../inspect';
import type { Node } from '../tree/nodes';
import type { ContainersProvider } from '../tree/containersProvider';
import { confirm, withProgress } from './ui';
import { openShell } from './lxcActions';

type DockerNode = Extract<Node, { kind: 'docker' }>;
type ComposeNode = Extract<Node, { kind: 'compose' }>;

export function registerDockerActions(provider: ContainersProvider): vscode.Disposable[] {
  const docker = (n: DockerNode, args: string[]) => execArgs(n.inst.name, n.inst.project, ['docker', ...args]);
  const compose = (n: ComposeNode, verb: string) => execArgs(n.inst.name, n.inst.project, ['docker', 'compose', '-p', n.project, verb]);
  const simple = (verb: 'start' | 'stop' | 'restart', label: string) => async (n: Node) => {
    if (n?.kind !== 'docker') return;
    await withProgress(`${label} ${n.c.name}`, () => runCli(docker(n, [verb, n.c.id]), SLOW));
    await provider.refreshDocker(n.inst);
  };
  const composeCmd = (verb: 'start' | 'stop' | 'restart', label: string, ask: boolean) => async (n: Node) => {
    if (n?.kind !== 'compose') return;
    if (ask && !(await confirm(`Stop all containers of compose project "${n.project}" in ${n.inst.name}?`, 'Stop all'))) return;
    await withProgress(`${label} ${n.project}`, () => runCli(compose(n, verb), SLOW));
    await provider.refreshDocker(n.inst);
  };

  return [
    vscode.commands.registerCommand('seedpod.docker.start', simple('start', 'Starting')),
    vscode.commands.registerCommand('seedpod.docker.stop', simple('stop', 'Stopping')),
    vscode.commands.registerCommand('seedpod.docker.restart', simple('restart', 'Restarting')),
    vscode.commands.registerCommand('seedpod.docker.remove', async (n: Node) => {
      if (n?.kind !== 'docker') return;
      if (!(await confirm(`Remove container ${n.c.name} in ${n.inst.name}?`, 'Remove', 'Runs docker rm -f; the container is stopped if running.'))) return;
      await withProgress(`Removing ${n.c.name}`, () => runCli(docker(n, ['rm', '-f', n.c.id]), SLOW));
      await provider.refreshDocker(n.inst);
    }),
    vscode.commands.registerCommand('seedpod.docker.logs', (n: Node) => {
      if (n?.kind === 'docker') openShell(`${n.c.name} logs`, docker(n, ['logs', '-f', '--tail', '200', n.c.id]));
    }),
    vscode.commands.registerCommand('seedpod.docker.shell', (n: Node) => {
      if (n?.kind === 'docker') openShell(n.c.name, execArgs(n.inst.name, n.inst.project, ['docker', 'exec', '-it', n.c.id, ...shellCommand(false)]));
    }),
    vscode.commands.registerCommand('seedpod.docker.inspect', (n: Node) => {
      if (n?.kind === 'docker') return openInspect(n.c.name, [docker(n, ['inspect', n.c.id])], 'json');
    }),
    vscode.commands.registerCommand('seedpod.compose.start', composeCmd('start', 'Starting', false)),
    vscode.commands.registerCommand('seedpod.compose.restart', composeCmd('restart', 'Restarting', false)),
    vscode.commands.registerCommand('seedpod.compose.stop', composeCmd('stop', 'Stopping', true)),
  ];
}
