/** Where a picked option is: waiting to be picked, working on it (a passkey
 * prompt, a sign-in), or done. */
export enum OptionState {
  Idle = 'idle',
  Working = 'working',
  Done = 'done',
}
