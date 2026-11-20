// Minimal stand-in for the parts of the vscode API the providers and actions touch.
const cfg = { 'seedpod.cliPath': 'lxc', 'seedpod.docker.pollInterval': 0, 'seedpod.networks.showUnmanaged': false };
const calls = [];
const handlers = {};
globalThis.__vscode = { cfg, calls, handlers, answers: {} };
class EventEmitter { constructor() { this.l = []; this.event = (f) => { this.l.push(f); return { dispose() {} }; }; } fire(x) { this.l.forEach((f) => f(x)); } dispose() {} }
class TreeItem { constructor(label, c) { this.label = label; this.collapsibleState = c; } }
class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } }
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor(value = '') { this.value = value; } }
const rec = (name) => async (...a) => { calls.push([name, ...a]); return globalThis.__vscode.answers[name]; };
module.exports = {
  EventEmitter, TreeItem, ThemeIcon, ThemeColor, MarkdownString,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ProgressLocation: { Window: 10 },
  Uri: { from: (o) => ({ ...o, toString: () => `${o.scheme}:${o.path}?${o.query}` }) },
  env: { clipboard: { writeText: rec('clipboard') } },
  extensions: { getExtension: () => undefined, onDidChange: () => ({ dispose() {} }) },
  workspace: {
    getConfiguration: (s) => ({ get: (k) => cfg[`${s}.${k}`] }),
    openTextDocument: async (u) => { calls.push(['openTextDocument', u.toString()]); return u; },
  },
  window: {
    createTerminal: (o) => { calls.push(['createTerminal', o]); return { show() {} }; },
    showWarningMessage: rec('showWarningMessage'), showErrorMessage: rec('showErrorMessage'),
    showInformationMessage: rec('showInformationMessage'), showInputBox: rec('showInputBox'),
    setStatusBarMessage: (...a) => calls.push(['status', ...a]),
    withProgress: (_o, fn) => fn(),
    showTextDocument: rec('showTextDocument'),
  },
  commands: {
    executeCommand: async (...a) => { calls.push(['executeCommand', ...a]); },
    registerCommand: (id, fn) => { handlers[id] = fn; return { dispose() {} }; },
  },
};
