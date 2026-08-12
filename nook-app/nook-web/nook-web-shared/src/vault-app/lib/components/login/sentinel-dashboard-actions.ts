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

export async function runSentinelDashboardAction({
  allowed,
  setBusy,
  action,
}: SentinelDashboardAction): Promise<void> {
  if (!allowed) return;
  setBusy(true);
  try {
    await action();
  } finally {
    setBusy(false);
  }
}

export async function copySentinelRequest({
  request,
  onCopied,
  onFailure,
}: SentinelRequestCopy): Promise<void> {
  if (!request) return;
  try {
    await navigator.clipboard.writeText(request);
    onCopied();
  } catch {
    onFailure();
  }
}
