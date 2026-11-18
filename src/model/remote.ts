import * as path from 'node:path';

export type SettingsPlan =
  | { kind: 'unchanged' }
  | { kind: 'write'; text: string }
  | { kind: 'invalid'; reason: string };

/** Merges `wanted` into the machine's VS Code settings.json text. Keys Seedpod doesn't manage are kept; a file it can't parse is never overwritten. */
export function planMachineSettings(existing: string, wanted: Record<string, unknown>): SettingsPlan {
  let cur: unknown = {};
  if (existing.trim()) {
    try {
      cur = JSON.parse(existing);
    } catch (e) {
      return { kind: 'invalid', reason: (e as Error).message };
    }
  }
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return { kind: 'invalid', reason: 'not a JSON object' };
  const obj = cur as Record<string, unknown>;
  const changed = Object.entries(wanted).filter(([k, v]) => JSON.stringify(obj[k]) !== JSON.stringify(v));
  if (!changed.length) return { kind: 'unchanged' };
  return { kind: 'write', text: JSON.stringify({ ...obj, ...wanted }, null, 2) };
}

/** `~`, `~/x` and relative paths are resolved against the remote user's home; '' means no folder. */
export function resolveRemoteFolder(folder: string, home: string): string | undefined {
  const f = folder.trim();
  if (!f) return undefined;
  if (f.startsWith('/')) return path.posix.normalize(f);
  const rest = f === '~' ? '' : f.startsWith('~/') ? f.slice(2) : f;
  return path.posix.join(home, rest).replace(/(.)\/$/, '$1');
}

/** Output of READ_SETUP: the home directory on the first line, then the settings file. */
export function splitHome(out: string): { home: string; settings: string } {
  const nl = out.indexOf('\n');
  return nl < 0 ? { home: out.trim(), settings: '' } : { home: out.slice(0, nl).trim(), settings: out.slice(nl + 1) };
}

const HOME = 'h=$(getent passwd "$1" | cut -d: -f6); [ -n "$h" ] || { echo "no user $1 in this machine" >&2; exit 3; }';

/** `sh -c` body, args: user. Prints the user's home, then their VS Code Server machine settings (if any). */
export const READ_SETUP = `${HOME}; printf '%s\\n' "$h"; cat "$h/.vscode-server/data/Machine/settings.json" 2>/dev/null || true`;

/** `sh -c` body, args: user, settings text. Runs as root, so it hands every directory it may have created back to the user. */
export const WRITE_SETUP = `set -e; ${HOME}; d="$h/.vscode-server/data/Machine"; mkdir -p "$d"; ` +
  `printf '%s\\n' "$2" > "$d/settings.json.seedpod"; mv "$d/settings.json.seedpod" "$d/settings.json"; ` +
  `chown "$1:$(id -gn "$1")" "$h/.vscode-server" "$h/.vscode-server/data" "$d" "$d/settings.json"`;
