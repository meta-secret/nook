enum EvidenceStatus {
  Held = 'HELD',
  Pending = 'PENDING',
  Recorded = 'RECORDED',
  Sealed = 'SEALED',
}

export class VaultIdentityEvidence {
  constructor(private readonly request: boolean) {}
  get status(): EvidenceStatus {
    const recorded = this.request

    return recorded ? EvidenceStatus.Recorded : EvidenceStatus.Pending
  }
}

export class AtomicGenesisEvidence {
  constructor(private readonly request: boolean) {}
  get status(): EvidenceStatus {
    const sealed = this.request

    return sealed ? EvidenceStatus.Sealed : EvidenceStatus.Held
  }
}
