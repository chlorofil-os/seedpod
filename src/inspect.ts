import * as vscode from 'vscode';
import { runCli, isReadOnlyCall } from './cli';

export const INSPECT_SCHEME = 'seedpod-inspect';

/** Read-only documents whose text is the output of one or more CLI calls, joined with a YAML document separator. */
export class InspectProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const calls: string[][] = JSON.parse(new URLSearchParams(uri.query).get('calls') ?? '[]');
    const parts: string[] = [];
    for (const args of calls) {
      if (!Array.isArray(args) || !args.every((a) => typeof a === 'string') || !isReadOnlyCall(args)) {
        parts.push(`# refused: ${JSON.stringify(args)} is not a read-only call`);
        continue;
      }
      try {
        parts.push((await runCli(args)).trimEnd());
      } catch (e) {
        parts.push(`# ${args.join(' ')} failed:\n# ${(e as Error).message.replace(/\n/g, '\n# ')}`);
      }
    }
    return parts.join('\n---\n') + '\n';
  }
}

/** Opens `<title>.<ext>` built from the given CLI calls; a fresh query each time so it is never stale. */
export async function openInspect(title: string, calls: string[][], language: 'yaml' | 'json' | 'log'): Promise<void> {
  const safe = title.replace(/[^A-Za-z0-9._-]/g, '_');
  const query = new URLSearchParams({ calls: JSON.stringify(calls), t: String(Date.now()) }).toString();
  const uri = vscode.Uri.from({ scheme: INSPECT_SCHEME, path: `/${safe}.${language}`, query });
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: true });
}
