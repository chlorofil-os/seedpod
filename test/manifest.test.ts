import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
const itemMenus: { command: string; when: string }[] = pkg.contributes.menus['view/item/context'];

/** Does a `when` clause's viewItem test accept this contextValue? */
function accepts(when: string, ctx: string): boolean {
  const re = /viewItem =~ \/(.+?)\/(?:\s|$)/.exec(when);
  if (re) return new RegExp(re[1]).test(ctx);
  const eq = /viewItem == (\S+)/.exec(when);
  return !!eq && eq[1] === ctx;
}

// Every contextValue the trees emit that is meant to have actions.
const EXPECTED: Record<string, string[]> = {
  'seedpod.instance.running': ['seedpod.instance.stop', 'seedpod.instance.shell', 'seedpod.instance.inspect', 'seedpod.instance.delete'],
  'seedpod.instance.stopped': ['seedpod.instance.start', 'seedpod.instance.delete'],
  'seedpod.instance.frozen': ['seedpod.instance.unfreeze'],
  'seedpod.docker.running': ['seedpod.docker.stop', 'seedpod.docker.shell', 'seedpod.docker.logs', 'seedpod.docker.remove'],
  'seedpod.docker.stopped': ['seedpod.docker.start', 'seedpod.docker.remove'],
  'seedpod.compose': ['seedpod.compose.start', 'seedpod.compose.stop', 'seedpod.compose.restart'],
  'seedpod.snapshot': ['seedpod.snapshot.restore', 'seedpod.snapshot.delete'],
  'seedpod.image': ['seedpod.image.delete'],
  'seedpod.network': ['seedpod.network.inspect'],
  'seedpod.pool': ['seedpod.storage.inspect'],
};

for (const [ctx, commands] of Object.entries(EXPECTED)) {
  test(`context menu for ${ctx}`, () => {
    const offered = itemMenus.filter((m) => accepts(m.when, ctx)).map((m) => m.command);
    for (const c of commands) assert.ok(offered.includes(c), `${c} missing for ${ctx}; offered: ${offered.join(', ') || 'nothing'}`);
  });
}

test('no menu condition still refers to the pre-rename lxc.* ids', () => {
  for (const m of itemMenus) assert.ok(!/lxc\\?\./.test(m.when), m.when);
});

test('every menu command is a contributed command', () => {
  const ids = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
  for (const m of itemMenus) assert.ok(ids.has(m.command), m.command);
});
