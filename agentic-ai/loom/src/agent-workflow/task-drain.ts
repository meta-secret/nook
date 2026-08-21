import { TaskTerminalKind } from './domain.ts';
import type { TaskTerminal } from './domain.ts';
import { UnconfirmedTaskTeardownError } from './runtime.ts';

export type RunningTask<TTask extends string> = {
  readonly task: TTask;
  readonly completion: Promise<TaskTerminal<TTask>>;
};

export async function drainRunningTasks<TTask extends string>(
  running: readonly RunningTask<TTask>[],
): Promise<readonly TaskTerminal<TTask>[]> {
  const outcomes = await Promise.all(
    running.map(async (entry): Promise<readonly TaskTerminal<TTask>[]> => {
      try {
        return [await entry.completion];
      } catch (error) {
        return error instanceof UnconfirmedTaskTeardownError
          ? [unconfirmedTeardownTerminal(entry.task)]
          : [];
      }
    }),
  );
  return outcomes.flat();
}

export function unconfirmedTeardownTerminal<TTask extends string>(
  task: TTask,
): TaskTerminal<TTask> {
  return {
    kind: TaskTerminalKind.Failed,
    task,
    attempt: 1,
    summary:
      'Task teardown was not confirmed before the hard deadline. The attempt is terminal and its workspace must not be reused.',
  };
}
