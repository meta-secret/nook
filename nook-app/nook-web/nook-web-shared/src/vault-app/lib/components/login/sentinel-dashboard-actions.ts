export async function runSentinelDashboardAction({
  allowed,
  setBusy,
  action,
}: {
  readonly allowed: boolean;
  readonly setBusy: (busy: boolean) => void;
  readonly action: () => void | Promise<void>;
}): Promise<void> {
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
}: {
  readonly request: string;
  readonly onCopied: () => void;
  readonly onFailure: () => void;
}): Promise<void> {
  if (!request) return;
  try {
    await navigator.clipboard.writeText(request);
    onCopied();
  } catch {
    onFailure();
  }
}
