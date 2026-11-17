import type { LxcNetwork } from './lxc';

export function visibleNetworks(ns: LxcNetwork[], showUnmanaged: boolean): LxcNetwork[] {
  return ns
    .filter((n) => showUnmanaged || n.managed)
    .sort((a, b) => (a.managed === b.managed ? a.name.localeCompare(b.name) : a.managed ? -1 : 1));
}
