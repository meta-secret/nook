export const VAULT_ASSESS_TIMEOUT_ERROR_NAME = "VaultAssessTimeoutError";

type VaultDiscoveryTimeoutSchedule = {
  readonly message: string;
  readonly timeoutMs: number;
};

/** Owns the pending discovery deadline until its enclosing operation settles. */
export class VaultDiscoveryTimeout {
  private readonly controller = new AbortController();
  readonly completion: Promise<never>;

  constructor({ message, timeoutMs }: VaultDiscoveryTimeoutSchedule) {
    // eslint-disable-next-line max-params -- Promise owns its executor signature.
    this.completion = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        const timeoutError = new Error(message);
        timeoutError.name = VAULT_ASSESS_TIMEOUT_ERROR_NAME;
        reject(timeoutError);
      }, timeoutMs);
      this.controller.signal.addEventListener(
        "abort",
        () => clearTimeout(timer),
        { once: true },
      );
    });
  }

  cancel(): void {
    this.controller.abort();
  }
}
