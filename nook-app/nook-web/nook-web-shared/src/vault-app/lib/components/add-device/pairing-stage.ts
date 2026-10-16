/** Where adding a device stands; the flow shows one stage at a time. */
export enum PairingStage {
  /** The identity has no cloud mount another device can reach. */
  Cloud = "cloud",
  /** A cloud copy exists; the invite is not made yet. */
  Invite = "invite",
  /** The invite is out. It carries the vault keys, so the new device joins
   * by itself: nothing is left to approve or wait for here. */
  Issued = "issued",
}

type PairingFacts = {
  readonly cloudReady: boolean;
  readonly inviteReady: boolean;
};

export class PairingProgress {
  constructor(private readonly facts: PairingFacts) {}

  get stage(): PairingStage {
    const { cloudReady, inviteReady } = this.facts;
    if (!cloudReady) return PairingStage.Cloud;
    return inviteReady ? PairingStage.Issued : PairingStage.Invite;
  }

  /** Index into the two progress steps: cloud copy, invite. Past the last
   * step once the invite is out, so every step shows done. */
  get step(): number {
    switch (this.stage) {
      case PairingStage.Cloud:
        return 0;
      case PairingStage.Invite:
        return 1;
      case PairingStage.Issued:
        return 2;
    }
  }
}
