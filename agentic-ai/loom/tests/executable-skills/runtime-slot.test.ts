import { expect, test } from 'bun:test';
import { LoomFailureCode } from '../../src/loom-failure.ts';
import type { ExecutableSkillContainerCandidate } from '../../src/executable-skills/runtime-docker.ts';
import {
  executeExecutableSkillInRuntimeSlot,
  MINIMUM_RUNTIME_EXECUTION_MILLISECONDS,
  type ExecutableSkillRuntimeSlotClock,
  type ExecuteExecutableSkillInRuntimeSlotRequest,
} from '../../src/executable-skills/runtime-slot.ts';

const systemClock: ExecutableSkillRuntimeSlotClock = { now: Date.now };

function candidate(label: string): ExecutableSkillContainerCandidate {
  return {
    imageDigest: `sha256:${label.padEnd(64, '0')}`,
    serializedResult: label,
  };
}

test('serializes executable skill container lifecycles', async () => {
  const events: string[] = [];
  let releaseFirst = (): void => {};
  let markFirstStarted = (): void => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstRequest: ExecuteExecutableSkillInRuntimeSlotRequest = {
    clock: systemClock,
    deadlineExpiresAt: Date.now() + 60_000,
    execute: async () => {
      events.push('first-start');
      markFirstStarted();
      await firstGate;
      events.push('first-end');
      return candidate('a');
    },
    signal: false,
  };
  const secondRequest: ExecuteExecutableSkillInRuntimeSlotRequest = {
    clock: systemClock,
    deadlineExpiresAt: Date.now() + 60_000,
    execute: async () => {
      events.push('second-start');
      return candidate('b');
    },
    signal: false,
  };

  const first = executeExecutableSkillInRuntimeSlot(firstRequest);
  await firstStarted;
  const second = executeExecutableSkillInRuntimeSlot(secondRequest);
  await Promise.resolve();
  expect(events).toEqual(['first-start']);
  releaseFirst();
  await Promise.all([first, second]);
  expect(events).toEqual(['first-start', 'first-end', 'second-start']);
});

test('aborted slot wait releases its queue position', async () => {
  let releaseFirst = (): void => {};
  let markFirstStarted = (): void => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstRequest: ExecuteExecutableSkillInRuntimeSlotRequest = {
    clock: systemClock,
    deadlineExpiresAt: Date.now() + 60_000,
    execute: async () => {
      markFirstStarted();
      await firstGate;
      return candidate('a');
    },
    signal: false,
  };
  const controller = new AbortController();
  const abortedRequest: ExecuteExecutableSkillInRuntimeSlotRequest = {
    clock: systemClock,
    deadlineExpiresAt: Date.now() + 60_000,
    execute: async () => candidate('b'),
    signal: controller.signal,
  };
  const finalRequest: ExecuteExecutableSkillInRuntimeSlotRequest = {
    clock: systemClock,
    deadlineExpiresAt: Date.now() + 60_000,
    execute: async () => candidate('c'),
    signal: false,
  };

  const first = executeExecutableSkillInRuntimeSlot(firstRequest);
  await firstStarted;
  const aborted = executeExecutableSkillInRuntimeSlot(abortedRequest);
  controller.abort();
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('slot was aborted'),
  };
  await expect(aborted).rejects.toMatchObject(expectedFailure);
  const final = executeExecutableSkillInRuntimeSlot(finalRequest);
  releaseFirst();
  await first;
  expect((await final).serializedResult).toBe('c');
});

test('observes cancellation that predates slot listener installation', async () => {
  const controller = new AbortController();
  controller.abort();
  let executed = false;
  const request: ExecuteExecutableSkillInRuntimeSlotRequest = {
    clock: systemClock,
    deadlineExpiresAt: Date.now() + 60_000,
    execute: async () => {
      executed = true;
      return candidate('a');
    },
    signal: controller.signal,
  };
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('slot was aborted'),
  };

  await expect(
    executeExecutableSkillInRuntimeSlot(request),
  ).rejects.toMatchObject(expectedFailure);
  expect(executed).toBe(false);
});

test('observes cancellation during slot listener installation', async () => {
  const controller = new AbortController();
  let executed = false;
  const clock: ExecutableSkillRuntimeSlotClock = {
    now: () => {
      controller.abort();
      return Date.now();
    },
  };
  const request: ExecuteExecutableSkillInRuntimeSlotRequest = {
    clock,
    deadlineExpiresAt: Date.now() + 60_000,
    execute: async () => {
      executed = true;
      return candidate('a');
    },
    signal: controller.signal,
  };

  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
  };
  await expect(
    executeExecutableSkillInRuntimeSlot(request),
  ).rejects.toMatchObject(expectedFailure);
  expect(executed).toBe(false);
});

test('hands queued work the declared minimum operation budget', async () => {
  let releaseFirst = (): void => {};
  let markFirstStarted = (): void => {};
  let fakeNow = 60_000;
  let observedBudget = 0;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstRequest: ExecuteExecutableSkillInRuntimeSlotRequest = {
    clock: systemClock,
    deadlineExpiresAt: Date.now() + 60_000,
    execute: async () => {
      markFirstStarted();
      await firstGate;
      return candidate('a');
    },
    signal: false,
  };
  const fakeClock: ExecutableSkillRuntimeSlotClock = { now: () => fakeNow };
  const queuedRequest: ExecuteExecutableSkillInRuntimeSlotRequest = {
    clock: fakeClock,
    deadlineExpiresAt: 100_000,
    execute: async () => {
      observedBudget = queuedRequest.deadlineExpiresAt - fakeClock.now();
      return candidate('b');
    },
    signal: false,
  };

  const first = executeExecutableSkillInRuntimeSlot(firstRequest);
  await firstStarted;
  const queued = executeExecutableSkillInRuntimeSlot(queuedRequest);
  fakeNow = 100_000 - MINIMUM_RUNTIME_EXECUTION_MILLISECONDS;
  releaseFirst();
  await Promise.all([first, queued]);

  expect(observedBudget).toBe(MINIMUM_RUNTIME_EXECUTION_MILLISECONDS);
});

test('bounds pending executable skill runtime work', async () => {
  let releaseFirst = (): void => {};
  let markFirstStarted = (): void => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstRequest: ExecuteExecutableSkillInRuntimeSlotRequest = {
    clock: systemClock,
    deadlineExpiresAt: Date.now() + 60_000,
    execute: async () => {
      markFirstStarted();
      await firstGate;
      return candidate('a');
    },
    signal: false,
  };
  const first = executeExecutableSkillInRuntimeSlot(firstRequest);
  await firstStarted;
  const pending: Promise<ExecutableSkillContainerCandidate>[] = [];
  for (let index = 0; index < 8; index += 1) {
    const queuedRequest: ExecuteExecutableSkillInRuntimeSlotRequest = {
      clock: systemClock,
      deadlineExpiresAt: Date.now() + 60_000,
      execute: async () => candidate(String(index)),
      signal: false,
    };
    pending.push(executeExecutableSkillInRuntimeSlot(queuedRequest));
  }
  const overflowRequest: ExecuteExecutableSkillInRuntimeSlotRequest = {
    clock: systemClock,
    deadlineExpiresAt: Date.now() + 60_000,
    execute: async () => candidate('overflow'),
    signal: false,
  };
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('queue reached its capacity'),
  };

  await expect(
    executeExecutableSkillInRuntimeSlot(overflowRequest),
  ).rejects.toMatchObject(expectedFailure);
  releaseFirst();
  await first;
  await Promise.all(pending);
});
