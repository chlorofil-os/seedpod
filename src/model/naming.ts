const pad = (n: number) => String(n).padStart(2, '0');

export function defaultSnapshotName(d: Date): string {
  return `snap-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Returns an error message, or undefined when the name is acceptable. */
export function validateSnapshotName(s: string, existing: string[] = []): string | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s)) return 'Letters, digits, ".", "_" and "-" only; must start with a letter or digit.';
  if (existing.includes(s)) return `A snapshot named "${s}" already exists.`;
  return undefined;
}
