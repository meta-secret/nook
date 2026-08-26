import type { ExecutableSkillContainerCandidate } from './runtime-docker.ts';
import {
  throwExecutableSkillRuntimeFailure,
  type ThrowExecutableSkillRuntimeFailureRequest,
} from './runtime-failure.ts';

export type ExecutableSkillRuntimeSlotExecutor =
  () => Promise<ExecutableSkillContainerCandidate>;

export type ExecuteExecutableSkillInRuntimeSlotRequest = {
  readonly clock: ExecutableSkillRuntimeSlotClock;
  readonly deadlineExpiresAt: number;
  readonly execute: ExecutableSkillRuntimeSlotExecutor;
  readonly signal: AbortSignal | false;
};

export type ExecutableSkillRuntimeSlotClock = {
  readonly now: () => number;
};

type ExecutableSkillRuntimeSlot = {
  readonly release: () => void;
};

enum RuntimeSlotWaitKind {
  Interrupted = 'interrupted',
  Ready = 'ready',
}

type RuntimeSlotWaitOutcome =
  RuntimeSlotWaitKind.Interrupted | RuntimeSlotWaitKind.Ready;

type RuntimeSlotWait = {
  readonly dispose: () => void;
  readonly promise: Promise<RuntimeSlotWaitOutcome>;
};

type WaitForRuntimeSlotRequest = {
  readonly clock: ExecutableSkillRuntimeSlotClock;
  readonly deadlineExpiresAt: number;
  readonly previous: Promise<void>;
  readonly signal: AbortSignal | false;
};

let runtimeTail: Promise<void> = Promise.resolve();
let runtimePending = 0;
export const MINIMUM_RUNTIME_EXECUTION_MILLISECONDS = 34_000;
const MAXIMUM_PENDING_RUNTIME_EXECUTIONS = 8;

export async function executeExecutableSkillInRuntimeSlot(
  request: ExecuteExecutableSkillInRuntimeSlotRequest,
): Promise<ExecutableSkillContainerCandidate> {
  try {
    const slot = await acquireRuntimeSlot(request);
    try {
      assertRuntimeSlotBudget(request);
      return await request.execute();
    } finally {
      slot.release();
    }
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error
          ? error
          : 'Executable skill runtime slot failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
}

async function acquireRuntimeSlot(
  request: ExecuteExecutableSkillInRuntimeSlotRequest,
): Promise<ExecutableSkillRuntimeSlot> {
  if (runtimePending >= MAXIMUM_PENDING_RUNTIME_EXECUTIONS) {
    throw new Error('Executable skill runtime queue reached its capacity.');
  }
  runtimePending += 1;
  const previous = runtimeTail;
  let releaseCurrent = (): void => {};
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  runtimeTail = previous.then(() => current);
  const waitRequest: WaitForRuntimeSlotRequest = {
    clock: request.clock,
    deadlineExpiresAt: request.deadlineExpiresAt,
    previous,
    signal: request.signal,
  };
  const wait = waitForRuntimeSlot(waitRequest);
  let outcome: RuntimeSlotWaitOutcome;
  try {
    outcome = await wait.promise;
  } finally {
    wait.dispose();
    runtimePending -= 1;
  }
  if (outcome === RuntimeSlotWaitKind.Interrupted) {
    releaseCurrent();
    assertRuntimeSlotBudget(request);
    throw new Error('Executable skill runtime slot wait was interrupted.');
  }
  let released = false;
  const slot: ExecutableSkillRuntimeSlot = {
    release: () => {
      if (released) return;
      released = true;
      releaseCurrent();
    },
  };
  return Object.freeze(slot);
}

function waitForRuntimeSlot(
  request: WaitForRuntimeSlotRequest,
): RuntimeSlotWait {
  let timer: ReturnType<typeof setTimeout> | false = false;
  let listener: (() => void) | false = false;
  const promise = new Promise<RuntimeSlotWaitOutcome>((resolve) => {
    request.previous.then(() => resolve(RuntimeSlotWaitKind.Ready));
    const delay = Math.max(
      0,
      request.deadlineExpiresAt -
        MINIMUM_RUNTIME_EXECUTION_MILLISECONDS -
        request.clock.now(),
    );
    timer = setTimeout(() => resolve(RuntimeSlotWaitKind.Interrupted), delay);
    if (request.signal !== false) {
      listener = () => resolve(RuntimeSlotWaitKind.Interrupted);
      if (request.signal.aborted) {
        resolve(RuntimeSlotWaitKind.Interrupted);
        return;
      }
      request.signal.addEventListener('abort', listener);
      if (request.signal.aborted) resolve(RuntimeSlotWaitKind.Interrupted);
    }
  });
  const wait: RuntimeSlotWait = {
    dispose: () => {
      if (timer !== false) clearTimeout(timer);
      if (request.signal !== false && listener !== false) {
        request.signal.removeEventListener('abort', listener);
      }
    },
    promise,
  };
  return Object.freeze(wait);
}

function assertRuntimeSlotBudget(
  request: ExecuteExecutableSkillInRuntimeSlotRequest,
): void {
  if (request.signal !== false && request.signal.aborted) {
    throw new Error('Executable skill runtime slot was aborted.');
  }
  if (
    request.deadlineExpiresAt - request.clock.now() <
    MINIMUM_RUNTIME_EXECUTION_MILLISECONDS
  ) {
    throw new Error('Executable skill runtime execution budget expired.');
  }
}
