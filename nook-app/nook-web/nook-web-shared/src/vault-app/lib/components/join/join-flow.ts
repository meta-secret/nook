/** Which device of a join the reader is looking from. */
export enum JoinSide {
  /** This device is the one joining the identity. */
  Joining = "joining",
  /** This device already belongs to the identity and invites another. */
  Inviting = "inviting",
}

/** The three places a join passes through. */
export enum JoinNodeKind {
  Member = "member",
  Provider = "provider",
  Joiner = "joiner",
}
