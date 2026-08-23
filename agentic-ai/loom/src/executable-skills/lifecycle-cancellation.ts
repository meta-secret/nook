import { ExecutableSkillCancellationError } from './runtime-errors.ts';

export type ExecutableSkillCancellationWait = {
  readonly dispose: () => void;
  readonly promise: Promise<'cancelled'>;
};

export function waitForExecutableSkillCancellation(
  signal: AbortSignal | false,
): ExecutableSkillCancellationWait {
  let listener: (() => void) | false = false;
  const promise = new Promise<'cancelled'>((resolve) => {
    if (signal === false) return;
    if (signal.aborted) {
      resolve('cancelled');
      return;
    }
    listener = () => resolve('cancelled');
    signal.addEventListener('abort', listener);
  });
  return {
    promise,
    dispose: () => {
      if (signal !== false && listener !== false) {
        signal.removeEventListener('abort', listener);
      }
    },
  };
}

export function assertExecutableSkillNotCancelled(
  signal: AbortSignal | false,
): void {
  if (signal !== false && signal.aborted) {
    throw new ExecutableSkillCancellationError(false);
  }
}
