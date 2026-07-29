enum EvidenceStatus {
  Held = 'HELD',
  Pending = 'PENDING',
  Recorded = 'RECORDED',
  Sealed = 'SEALED',
}

export function vaultIdentityEvidenceStatus(recorded: boolean): EvidenceStatus {
  return recorded ? EvidenceStatus.Recorded : EvidenceStatus.Pending
}

export function atomicGenesisEvidenceStatus(sealed: boolean): EvidenceStatus {
  return sealed ? EvidenceStatus.Sealed : EvidenceStatus.Held
}
