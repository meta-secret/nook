import { ModuleRepositoryGit } from './git-command.ts';

import { ModuleDeliveryTaskKind } from './domain.ts';

import type { ValidatedModuleDeliveryPlan } from './domain.ts';

import type { GitCommandRequest } from './git-command.ts';

export class CanonicalWriterClosure {
  private constructor(
    private readonly request: CanonicalModuleFinalizationInspection,
  ) {}
  static validate(
    inspection: CanonicalModuleFinalizationInspection,
  ): readonly string[] {
    return new CanonicalWriterClosure(inspection).execute();
  }
  private execute(): readonly string[] {
    const inspection = this.request;
    const treeRequest: GitCommandRequest = {
      cwd: inspection.repositoryRoot,
      args: [
        'rev-parse',
        `${inspection.previousHeadCommit}^{tree}`,
        `${inspection.canonicalHeadCommit}^{tree}`,
      ],
    };
    const [previousTree, canonicalTree] = ModuleRepositoryGit.gitText(
      ModuleRepositoryGit.runModuleDeliveryGit(treeRequest),
    ).split('\n');
    if (!previousTree || previousTree !== canonicalTree)
      throw new Error('Final module join changed the integrated tree.');
    const writerTaskIds = inspection.acceptedPlan.topologicalOrder.filter(
      (taskId) =>
        inspection.acceptedPlan.plan.nodes.some(
          (node) =>
            node.taskId === taskId &&
            node.kind === ModuleDeliveryTaskKind.Write,
        ),
    );
    const integratedTaskIds = new Set(inspection.integratedTaskIds);
    if (
      integratedTaskIds.size !== inspection.integratedTaskIds.length ||
      writerTaskIds.length !== inspection.integratedTaskIds.length ||
      writerTaskIds.some((taskId) => !integratedTaskIds.has(taskId))
    )
      throw new Error('Final module join lacks complete writer closure.');
    return Object.freeze(writerTaskIds);
  }
}

export type CanonicalModuleFinalizationInspection = Readonly<{
  repositoryRoot: string;
  previousHeadCommit: string;
  canonicalHeadCommit: string;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  integratedTaskIds: readonly string[];
}>;
