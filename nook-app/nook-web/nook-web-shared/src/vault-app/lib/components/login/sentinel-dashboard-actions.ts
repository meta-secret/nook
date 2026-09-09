type SentinelDashboardAction = {
  readonly allowed: boolean;
  readonly setBusy: (busy: boolean) => void;
  readonly action: () => void | Promise<void>;
};

type SentinelRequestCopy = {
  readonly request: string;
  readonly onCopied: () => void;
  readonly onFailure: () => void;
};

export class SentinelDashboardInteraction {
  constructor(private readonly request: SentinelDashboardAction) {}
  async execute(): Promise<void> {
    const { allowed, setBusy, action } = this.request;
    if (!allowed) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }
}
export class SentinelRequestClipboard {
  constructor(private readonly request: SentinelRequestCopy) {}
  async execute(): Promise<void> {
    const { request, onCopied, onFailure } = this.request;
    if (!request) return;
    try {
      await navigator.clipboard.writeText(request);
      onCopied();
    } catch {
      onFailure();
    }
  }
}
