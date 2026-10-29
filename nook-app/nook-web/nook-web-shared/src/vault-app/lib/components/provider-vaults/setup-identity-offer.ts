/** The one button an identity's setup card offers. */
export enum SetupIdentityOffer {
  /** A member continues: setup finishes on it. */
  Continue = "continue",
  /** Anyone else asks to join it. */
  Join = "join",
  /** A join already asked is read again. */
  Check = "check",
  /** The identity in use, or one another identity here holds. */
  NoAction = "no-action",
}
