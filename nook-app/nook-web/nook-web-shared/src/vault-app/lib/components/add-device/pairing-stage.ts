/** Where adding a device stands; the flow shows one stage at a time. */
export enum PairingStage {
  /** The key in use is not a member of the identity, so it cannot invite.
   * The paired extension's key is one until a member invites it. */
  NotMember = "not-member",
  /** The identity has no cloud mount another device can reach. */
  Cloud = "cloud",
  /** A cloud copy exists; the invite is not made yet. */
  Invite = "invite",
  /** The invite is out. It carries the vault keys, so the new device joins
   * by itself: nothing is left to approve or wait for here. */
  Issued = "issued",
}

type PairingFacts = {
  /** The key in use is an active member of the identity. */
  readonly member: boolean;
  readonly cloudReady: boolean;
  readonly inviteReady: boolean;
};

export class PairingProgress {
  constructor(private readonly facts: PairingFacts) {}

  get stage(): PairingStage {
    const { member, cloudReady, inviteReady } = this.facts;
    if (!cloudReady) return PairingStage.Cloud;
    if (!member) return PairingStage.NotMember;
    return inviteReady ? PairingStage.Issued : PairingStage.Invite;
  }

  /** Index into the two progress steps: cloud copy, invite. Past the last
   * step once the invite is out, so every step shows done. */
  get step(): number {
    switch (this.stage) {
      case PairingStage.Cloud:
        return 0;
      case PairingStage.NotMember:
      case PairingStage.Invite:
        return 1;
      case PairingStage.Issued:
        return 2;
    }
  }
}
