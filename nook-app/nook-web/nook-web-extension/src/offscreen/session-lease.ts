import { err, ok, type Result } from 'neverthrow'

export enum ExtensionSessionLeaseFailure { Locked = 'EXTENSION_SESSION_LOCKED' }

enum ExtensionSessionLeaseKind {
  Active = 'active',
  Expired = 'expired',
}
/** Only an active lease can renew its deadline; stale aliases fail at the effect. */
export class ActiveExtensionSessionLease {
  private state = ExtensionSessionLeaseKind.Active
  private deadline: number
  private timer: ReturnType<typeof setTimeout>
  private constructor(
    private readonly request: {
      generation: number
      durationMs: number
      onExpire: () => void
    },
  ) {
    this.deadline = Date.now() + request.durationMs
    this.timer = setTimeout(() => this.expire(), request.durationMs)
  }
  static start(request: {
    generation: number
    durationMs: number
    onExpire: () => void
  }): ActiveExtensionSessionLease {
    return new ActiveExtensionSessionLease(request)
  }
  renew(generation: number): Result<void, ExtensionSessionLeaseFailure> {
    if (
      this.state !== ExtensionSessionLeaseKind.Active ||
      generation !== this.request.generation ||
      Date.now() >= this.deadline
    )
      return err(ExtensionSessionLeaseFailure.Locked)
    clearTimeout(this.timer)
    this.deadline = Date.now() + this.request.durationMs
    this.timer = setTimeout(() => this.expire(), this.request.durationMs)
    return ok(undefined)
  }
  stop(): void {
    this.state = ExtensionSessionLeaseKind.Expired
    clearTimeout(this.timer)
  }
  private expire(): void {
    if (this.state !== ExtensionSessionLeaseKind.Active) return
    this.stop()
    this.request.onExpire()
  }
}
