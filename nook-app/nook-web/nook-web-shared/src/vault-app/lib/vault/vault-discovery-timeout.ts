export const VAULT_ASSESS_TIMEOUT_ERROR_NAME = "VaultAssessTimeoutError";

export type VaultDiscoveryTimeout = {
  completion: Promise<never>;
  cancel(): void;
};

export function startVaultDiscoveryTimeout({
  message,
  timeoutMs,
}: {
  readonly message: string;
  readonly timeoutMs: number;
}): VaultDiscoveryTimeout {
  const controller = new AbortController();
  // eslint-disable-next-line max-params -- Promise owns this positional executor signature.
  const completion = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new Error(message);
      timeoutError.name = VAULT_ASSESS_TIMEOUT_ERROR_NAME;
      reject(timeoutError);
    }, timeoutMs);
    const addEventListenerArgs: Parameters<
      typeof controller.signal.addEventListener
    >[2] = {
      once: true,
    };
    controller.signal.addEventListener(
      "abort",
      () => clearTimeout(timer),
      addEventListenerArgs,
    );
  });
  return {
    completion,
    cancel: () => controller.abort(),
  };
}
