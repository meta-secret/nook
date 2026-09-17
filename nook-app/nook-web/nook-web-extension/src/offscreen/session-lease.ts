import { err, ok, type Result } from 'neverthrow'

export enum ExtensionSessionLeaseFailure {
  Locked = 'EXTENSION_SESSION_LOCKED',
}

export enum ExtensionSessionLeaseRenewal {
  Renewed = 'EXTENSION_SESSION_LEASE_RENEWED',
}

enum ExtensionSessionLeaseKind {
  Active = 'active',
  Expired = 'expired',
}

type ExtensionSessionLeaseState =
  | {
      readonly kind: ExtensionSessionLeaseKind.Active
      readonly deadline: number
      readonly timer: ReturnType<typeof setTimeout>
    }
  | { readonly kind: ExtensionSessionLeaseKind.Expired }

export class ExtensionSessionGeneration {
  private constructor(private readonly value: number) {}

  static initial(): ExtensionSessionGeneration {
    return new ExtensionSessionGeneration(0)
  }

  next(): ExtensionSessionGeneration {
    return new ExtensionSessionGeneration(this.value + 1)
  }

  matches(candidate: ExtensionSessionGeneration): boolean {
    return this.value === candidate.value
  }
}

type ExtensionSessionLeaseRequest = {
  readonly generation: ExtensionSessionGeneration
  readonly durationMs: number
  readonly onExpire: () => void
}

/** Only an active lease can renew its deadline; stale aliases fail at the effect. */
export class ActiveExtensionSessionLease {
  private state: ExtensionSessionLeaseState

  constructor(private readonly request: ExtensionSessionLeaseRequest) {
    this.state = {
      kind: ExtensionSessionLeaseKind.Active,
      deadline: Date.now() + request.durationMs,
      timer: setTimeout(() => this.expire(), request.durationMs),
    }
  }

  renew(
    generation: ExtensionSessionGeneration,
  ): Result<ExtensionSessionLeaseRenewal, ExtensionSessionLeaseFailure> {
    const active = this.state
    if (
      active.kind !== ExtensionSessionLeaseKind.Active ||
      !this.request.generation.matches(generation) ||
      Date.now() >= active.deadline
    )
      return err(ExtensionSessionLeaseFailure.Locked)
    clearTimeout(active.timer)
    this.state = {
      kind: ExtensionSessionLeaseKind.Active,
      deadline: Date.now() + this.request.durationMs,
      timer: setTimeout(() => this.expire(), this.request.durationMs),
    }
    return ok(ExtensionSessionLeaseRenewal.Renewed)
  }

  stop(): void {
    const active = this.state
    this.state = { kind: ExtensionSessionLeaseKind.Expired }
    if (active.kind === ExtensionSessionLeaseKind.Active)
      clearTimeout(active.timer)
  }

  private expire(): void {
    if (this.state.kind !== ExtensionSessionLeaseKind.Active) return
    this.stop()
    this.request.onExpire()
  }
}
