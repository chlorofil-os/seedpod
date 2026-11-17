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
