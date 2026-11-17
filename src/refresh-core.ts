export function nextBackoff(prevMs: number): number {
  return Math.min(Math.max(prevMs * 2, 1000), 30000);
}

export class Debouncer {
  private timer?: NodeJS.Timeout;
  constructor(private readonly ms: number, private readonly fn: () => void) {}

  trigger(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.fn();
    }, this.ms);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/** Lifecycle actions that change nothing a view shows; our own `lxc exec` polling emits instance-exec. */
const NOISE = /^instance-(exec|log-retrieved|file-|console|metadata-retrieved|metadata-template-)/;

export function isStateEvent(line: string): boolean {
  try {
    const action = JSON.parse(line)?.metadata?.action;
    return typeof action !== 'string' || !NOISE.test(action);
  } catch {
    return true;
  }
}
