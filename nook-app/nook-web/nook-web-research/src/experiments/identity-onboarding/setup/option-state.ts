/** Where a picked option is: waiting to be picked, working on it (a passkey
 * prompt, a sign-in), or done. */
export enum OptionState {
  Idle = 'idle',
  Working = 'working',
  Done = 'done',
}

/** What an option's step knows about it; working wins over done. */
export type OptionProgress = {
  readonly working: boolean
  readonly done: boolean
}

export function optionState(progress: OptionProgress): OptionState {
  if (progress.working) return OptionState.Working
  return progress.done ? OptionState.Done : OptionState.Idle
}
