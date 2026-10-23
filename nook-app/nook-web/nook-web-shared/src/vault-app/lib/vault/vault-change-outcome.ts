/**
 * The vault engine finished a change to the open session (opening it, saving
 * or deleting a secret, an enrollment). Nothing comes back with it: what the
 * page shows is read afterwards, a page of secrets at a time.
 */
export enum VaultChangeOutcome {
  Completed = "completed",
}
