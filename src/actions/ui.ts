import * as vscode from 'vscode';

/** Modal confirmation naming the target; resolves true only when the verb button is chosen. */
export async function confirm(message: string, verb: string, detail?: string): Promise<boolean> {
  return (await vscode.window.showWarningMessage(message, { modal: true, detail }, verb)) === verb;
}

/** Runs a CLI action with a window progress indicator and surfaces its stderr on failure. Returns false on failure. */
export async function withProgress(title: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title }, fn);
    return true;
  } catch (e) {
    void vscode.window.showErrorMessage(`${title} failed: ${(e as Error).message}`);
    return false;
  }
}
