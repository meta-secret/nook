import { runModuleDeliveryGit } from './git-command.ts';
import type { ModuleWorktreeHandle } from './workspace.ts';

export type TreeHandoff = {
  readonly taskId: string;
  readonly baselineCommit: string;
  readonly commit: string;
};

export type ApplyModuleWaveTreeRequest = {
  readonly workspace: ModuleWorktreeHandle;
  readonly currentHead: string;
  readonly handoffs: readonly TreeHandoff[];
};

export function applyModuleWaveTree(
  request: ApplyModuleWaveTreeRequest,
): string {
  let head = request.currentHead;
  for (const handoff of request.handoffs) {
    if (handoff.baselineCommit !== head)
      throw new Error(
        `Shared-branch handoff ${handoff.taskId} has a stale baseline.`,
      );
    if (
      runModuleDeliveryGit({
        cwd: request.workspace.sourceRepositoryRoot,
        args: [
          'merge-base',
          '--is-ancestor',
          handoff.baselineCommit,
          handoff.commit,
        ],
        allowFailure: true,
      }).exitCode !== 0
    )
      throw new Error(`Shared-branch handoff ${handoff.taskId} is not linear.`);
    head = handoff.commit;
  }
  return head;
}
