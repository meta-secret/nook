/** Where adding a device stands; the flow shows one stage at a time. */
export enum PairingStage {
  /** The identity has no cloud mount another device can reach. */
  Cloud = "cloud",
  /** A cloud copy exists; the invite is not made yet. */
  Invite = "invite",
  /** The invite is out; no request has arrived. */
  Waiting = "waiting",
  /** A device asks to join and waits for approval. */
  Request = "request",
  /** A request was approved from this flow. */
  Approved = "approved",
}

type PairingFacts = {
  readonly cloudReady: boolean;
  readonly inviteReady: boolean;
  readonly requestCount: number;
  readonly approved: boolean;
};

export class PairingProgress {
  constructor(private readonly facts: PairingFacts) {}

  get stage(): PairingStage {
    const { cloudReady, inviteReady, requestCount, approved } = this.facts;
    if (approved) return PairingStage.Approved;
    if (!cloudReady) return PairingStage.Cloud;
    // A request from an earlier invite still needs an answer.
    if (requestCount > 0) return PairingStage.Request;
    return inviteReady ? PairingStage.Waiting : PairingStage.Invite;
  }

  /** Index into the three progress steps: cloud copy, invite, approve.
   * Past the last step once approved, so every step shows done. */
  get step(): number {
    switch (this.stage) {
      case PairingStage.Cloud:
        return 0;
      case PairingStage.Invite:
        return 1;
      case PairingStage.Waiting:
      case PairingStage.Request:
        return 2;
      case PairingStage.Approved:
        return 3;
    }
  }
}
