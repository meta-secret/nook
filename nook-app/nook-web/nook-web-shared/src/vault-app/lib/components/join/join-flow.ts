/** Which device of a join the reader is looking from. */
export enum JoinSide {
  /** This device is the one joining the identity. */
  Joining = "joining",
  /** This device already belongs to the identity and invites another. */
  Inviting = "inviting",
}

/** The steps of adding a device to an identity, in order. */
export enum JoinStep {
  /** The member device creates an invite link. */
  Invite = 1,
  /** The new device redeems it and makes its own passkey. */
  Redeem = 2,
  /** The member device approves the request. */
  Approve = 3,
  /** The new device downloads the identity's vaults. */
  Download = 4,
}

export enum JoinStepState {
  Done = "done",
  Current = "current",
  Upcoming = "upcoming",
}

/** Where a step stands relative to the step in progress. */
export class JoinStepProgress {
  constructor(private readonly current: JoinStep) {}

  stateOf(step: JoinStep): JoinStepState {
    if (step < this.current) return JoinStepState.Done;
    if (step === this.current) return JoinStepState.Current;
    return JoinStepState.Upcoming;
  }
}

/** The three places a join passes through. */
export enum JoinNodeKind {
  Member = "member",
  Provider = "provider",
  Joiner = "joiner",
}
