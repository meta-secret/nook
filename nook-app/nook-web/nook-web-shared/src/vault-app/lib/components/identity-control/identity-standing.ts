import type { IdentityControlSnapshot } from "$app-wasm";

/** Typed questions about the current installation's identity standing. */
export class IdentityStandingPresentation {
  constructor(private readonly snapshot: IdentityControlSnapshot | false) {}

  private is(standing: IdentityControlSnapshot["standing"]): boolean {
    return this.snapshot !== false && this.snapshot.standing === standing;
  }

  isMember(): boolean {
    return this.is("member");
  }

  isRevoked(): boolean {
    return this.is("revoked");
  }

  isPendingJoin(): boolean {
    return this.is("pendingJoin");
  }
}
