import type { TaskTerminal } from './domain.ts';

export type RunningTask<TTask extends string> = {
  readonly task: TTask;
  readonly completion: Promise<TaskTerminal<TTask>>;
};

export async function drainRunningTasks<TTask extends string>(
  running: readonly RunningTask<TTask>[],
): Promise<readonly TaskTerminal<TTask>[]> {
  const outcomes = await Promise.allSettled(
    running.map((entry) => entry.completion),
  );
  return outcomes.flatMap((outcome) =>
    outcome.status === 'fulfilled' ? [outcome.value] : [],
  );
}
