import { err, type Result } from "neverthrow";
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";

enum DiscoveryDeadlineState {
  Waiting = "waiting",
  Expired = "expired",
  Completed = "completed",
}

type DiscoveryDeadlineRequest = { readonly timeoutMs: number };
type DiscoveryCompletion<T, E> = {
  readonly operation: Promise<Result<T, E>>;
  readonly releaseLateValue: (value: T) => void;
};

/** Owns discovery's deadline and rejects publication of late native handles. */
export class VaultDiscoveryTimeout {
  private state = DiscoveryDeadlineState.Waiting;
  private readonly controller = new AbortController();
  readonly completion: Promise<Result<never, VaultStorageFailure>>;

  constructor({ timeoutMs }: DiscoveryDeadlineRequest) {
    this.completion = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.state = DiscoveryDeadlineState.Expired;
        resolve(err(new VaultStorageFailure(VaultStorageFailureKind.TimedOut)));
      }, timeoutMs);
      this.controller.signal.addEventListener(
        "abort",
        () => clearTimeout(timer),
        {
          once: true,
        },
      );
    });
  }

  async waitFor<T, E>({
    operation,
    releaseLateValue,
  }: DiscoveryCompletion<T, E>): Promise<Result<T, E | VaultStorageFailure>> {
    const observed = operation.then((outcome) => {
      if (this.state === DiscoveryDeadlineState.Expired && outcome.isOk()) {
        releaseLateValue(outcome.value);
        return err(new VaultStorageFailure(VaultStorageFailureKind.TimedOut));
      }
      return outcome;
    });
    try {
      return await Promise.race([observed, this.completion]);
    } finally {
      this.cancel();
    }
  }

  cancel(): void {
    this.controller.abort();
    if (this.state === DiscoveryDeadlineState.Waiting)
      this.state = DiscoveryDeadlineState.Completed;
  }
}
