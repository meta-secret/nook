import { gitText, runModuleDeliveryGit } from './git-command.ts';
import { ModuleDeliveryTaskKind } from './domain.ts';

import type { ValidatedModuleDeliveryPlan } from './domain.ts';
import type { GitCommandRequest } from './git-command.ts';

export type CanonicalModuleFinalizationInspection = Readonly<{
  repositoryRoot: string;
  previousHeadCommit: string;
  canonicalHeadCommit: string;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  integratedTaskIds: readonly string[];
}>;

export function validatedCanonicalWriterClosure(
  inspection: CanonicalModuleFinalizationInspection,
): readonly string[] {
  const treeRequest: GitCommandRequest = {
    cwd: inspection.repositoryRoot,
    args: [
      'rev-parse',
      `${inspection.previousHeadCommit}^{tree}`,
      `${inspection.canonicalHeadCommit}^{tree}`,
    ],
  };
  const [previousTree, canonicalTree] = gitText(
    runModuleDeliveryGit(treeRequest),
  ).split('\n');
  if (!previousTree || previousTree !== canonicalTree)
    throw new Error('Final module join changed the integrated tree.');
  const writerTaskIds = inspection.acceptedPlan.topologicalOrder.filter(
    (taskId) =>
      inspection.acceptedPlan.plan.nodes.some(
        (node) =>
          node.taskId === taskId && node.kind === ModuleDeliveryTaskKind.Write,
      ),
  );
  if (
    JSON.stringify(writerTaskIds) !==
    JSON.stringify(inspection.integratedTaskIds)
  )
    throw new Error('Final module join lacks complete writer closure.');
  return Object.freeze(writerTaskIds);
}
