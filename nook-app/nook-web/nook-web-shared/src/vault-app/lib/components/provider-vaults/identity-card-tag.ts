/** Which words an identity card's tag uses. */
export enum IdentityCardTag {
  /** How the identity stands with this browser, as the recovery screen and
   * the access check say it. */
  Standing = "standing",
  /** What setup can do with it: member, not a member, join requested. */
  Setup = "setup",
}
