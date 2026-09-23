export enum VaultOperationStaleKind {
  RequestSuperseded = "request-superseded",
  ContextReplaced = "context-replaced",
  OwnerReleased = "owner-released",
}

/** A successful operation result that no longer belongs to the current context. */
export class VaultOperationStale {
  constructor(readonly kind: VaultOperationStaleKind) {}
}
