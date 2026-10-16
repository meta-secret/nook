/** Where adding a device stands; the flow shows one stage at a time. */
export enum PairingStage {
  /** The identity has no cloud mount another device can reach. */
  Cloud = "cloud",
  /** A cloud copy exists; the invite is not made yet. */
  Invite = "invite",
  /** The invite is out; no device has joined with it yet. */
  Waiting = "waiting",
  /** A device joined the identity with the invite. */
  Joined = "joined",
}

type PairingFacts = {
  readonly cloudReady: boolean;
  readonly inviteReady: boolean;
  /** Member app ids when the invite went out; `false` before it did. */
  readonly membersAtInvite: readonly string[] | false;
  /** Member app ids now. */
  readonly members: readonly string[];
};

export class PairingProgress {
  constructor(private readonly facts: PairingFacts) {}

  get stage(): PairingStage {
    const { cloudReady, inviteReady } = this.facts;
    if (this.joined) return PairingStage.Joined;
    if (!cloudReady) return PairingStage.Cloud;
    return inviteReady ? PairingStage.Waiting : PairingStage.Invite;
  }

  /** A device the invite admitted: a member that was not one when the
   * invite went out. */
  get joined(): boolean {
    const { inviteReady, membersAtInvite, members } = this.facts;
    if (!inviteReady || membersAtInvite === false) return false;
    return members.some((appId) => !membersAtInvite.includes(appId));
  }

  /** Index into the three progress steps: cloud copy, invite, join.
   * Past the last step once joined, so every step shows done. */
  get step(): number {
    switch (this.stage) {
      case PairingStage.Cloud:
        return 0;
      case PairingStage.Invite:
        return 1;
      case PairingStage.Waiting:
        return 2;
      case PairingStage.Joined:
        return 3;
    }
  }
}
