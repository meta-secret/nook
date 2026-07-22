export async function runSentinelDashboardAction(
  allowed: boolean,
  setBusy: (busy: boolean) => void,
  action: () => unknown | Promise<unknown>,
): Promise<void> {
  if (!allowed) return;
  setBusy(true);
  try {
    await action();
  } finally {
    setBusy(false);
  }
}

export async function copySentinelRequest(
  request: string,
  onCopied: () => void,
  onFailure: () => void,
): Promise<void> {
  if (!request) return;
  try {
    await navigator.clipboard.writeText(request);
    onCopied();
  } catch {
    onFailure();
  }
}
