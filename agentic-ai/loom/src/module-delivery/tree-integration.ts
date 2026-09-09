import { ModuleRepositoryGit } from './git-command.ts';

import type { ModuleWorktreeHandle } from './workspace.ts';

export class ModuleWaveTree {
  private constructor(private readonly request: ApplyModuleWaveTreeRequest) {}
  static apply(request: ApplyModuleWaveTreeRequest): string {
    return new ModuleWaveTree(request).execute();
  }
  private execute(): string {
    const request = this.request;
    let head = request.currentHead;
    for (const handoff of request.handoffs) {
      if (handoff.baselineCommit !== head)
        throw new Error(
          `Shared-branch handoff ${handoff.taskId} has a stale baseline.`,
        );
      if (
        ModuleRepositoryGit.runModuleDeliveryGit({
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
        throw new Error(
          `Shared-branch handoff ${handoff.taskId} is not linear.`,
        );
      head = handoff.commit;
    }
    return head;
  }
}

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
