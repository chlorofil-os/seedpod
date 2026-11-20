import type { LxcInstance } from './lxc';

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** Docker-style uptime: "Up 14 minutes", "Up 3 hours", "Up 2 days". */
export function formatUptime(since: Date, now: Date): string {
  const s = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 1000));
  if (s < 60) return 'Up Less than a minute';
  const m = Math.floor(s / 60);
  if (m < 60) return `Up ${plural(m, 'minute')}`;
  const h = Math.floor(m / 60);
  if (h < 48) return `Up ${plural(h, 'hour')}`;
  return `Up ${plural(Math.floor(h / 24), 'day')}`;
}

export function instanceDescription(i: LxcInstance, now: Date): string {
  const parts: string[] = [];
  if (i.os) parts.push(i.os);
  if (i.status === 'Running') {
    if (i.ipv4[0]) parts.push(i.ipv4[0]);
    parts.push(i.lastUsedAt ? formatUptime(i.lastUsedAt, now) : 'Running');
  } else {
    parts.push(i.status);
  }
  return parts.join(' · ');
}

/** Characters that Markdown would otherwise read as formatting in a hover. */
export function mdEscape(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');
}

/** `tcp:0.0.0.0:8080` → { proto: 'tcp', addr: '0.0.0.0', port: '8080' }; IPv6 addresses may be bracketed. */
function splitListen(s: string): { proto: string; addr: string; port: string } {
  const m = /^(\w+):(.*):(\d[\d-]*)$/.exec(s);
  return m ? { proto: m[1], addr: m[2].replace(/^\[|\]$/g, ''), port: m[3] } : { proto: '', addr: '', port: s };
}

/**
 * Markdown hover for an LXD machine: Status, Ports (proxy devices, which listen on the LXD host), Volumes (disk
 * devices), Networks (nic devices), Limits and Snapshots, all from `lxc list` data, so it runs no CLI call.
 */
export function instanceHoverMarkdown(i: LxcInstance, now: Date): string {
  const md = mdEscape;
  const out: string[] = [`### ${md(i.name)} (${md(i.type === 'virtual-machine' ? 'VM' : i.type)})`, '', '#### Status', '', md(instanceDescription(i, now))];
  out.push('', `Project ${md(i.project)} · created ${md(i.createdAt.toLocaleString())}`);
  const devs = Object.entries(i.devices).sort(([a], [b]) => a.localeCompare(b));

  const ports = devs.filter(([, d]) => d.type === 'proxy' && d.listen).map(([name, d]) => {
    const l = splitListen(d.listen);
    const c = d.connect ? splitListen(d.connect) : undefined;
    const host = l.addr === '0.0.0.0' || l.addr === '::' || l.addr === '' ? 'localhost' : l.addr;
    const link = /^\d+$/.test(l.port) && l.proto === 'tcp' ? `[${md(l.port)}](http://${host.includes(':') ? `[${host}]` : host}:${l.port})` : md(l.port);
    return `- ${link} ➔ ${md(c?.port ?? '?')} ${md(l.proto)} (${md(name)})`;
  });
  if (ports.length) out.push('', '#### Ports', '', ...ports);

  const disks = devs.filter(([, d]) => d.type === 'disk').map(([name, d]) => {
    const src = d.source ?? (d.pool ? `pool ${d.pool}` : name);
    return `- ${md(src)} ➔ ${md(d.path ?? '')}${d.readonly === 'true' ? ' (RO)' : ''}`;
  });
  if (disks.length) out.push('', '#### Volumes', '', ...disks);

  const nics = devs.filter(([, d]) => d.type === 'nic').map(([name, d]) => {
    const net = d.network ?? d.parent ?? d.nictype ?? '';
    return `- ${md(d.name ?? name)}${net ? ` · ${md(net)}` : ''}`;
  });
  if (i.ipv4.length) nics.push(...i.ipv4.map((ip) => `- ${md(ip)}`));
  if (nics.length) out.push('', '#### Networks', '', ...nics);

  const lim = [i.limits.cpu && `CPU ${md(i.limits.cpu)}`, i.limits.memory && `memory ${md(i.limits.memory)}`].filter(Boolean);
  if (lim.length) out.push('', '#### Limits', '', lim.join(' · '));

  if (i.snapshots.length) {
    const last = [...i.snapshots].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    out.push('', '#### Snapshots', '', `${i.snapshots.length} · latest ${md(last.name)} (${md(last.createdAt.toLocaleString())})`);
  }
  return out.join('\n');
}
