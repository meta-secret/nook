import {
  authenticateModuleDeliverySourceCommit,
  trustedModuleDeliveryPlanSnapshot,
} from './authority.ts';
import { ModuleDeliveryTaskKind } from './domain.ts';
import { runModuleDeliveryGit } from './git-command.ts';

import type { ValidatedModuleDeliveryPlan } from './domain.ts';

export type FreezeModuleDeliveryAdmissionSourceRequest = Readonly<{
  acceptedPlan: ValidatedModuleDeliveryPlan;
  repositoryRoot: string;
}>;

export type FrozenModuleDeliveryAdmissionSource = Readonly<{
  acceptedPlan: ValidatedModuleDeliveryPlan;
  repositoryRoot: string;
}>;

export function freezeModuleDeliveryAdmissionSource(
  request: FreezeModuleDeliveryAdmissionSourceRequest,
): FrozenModuleDeliveryAdmissionSource {
  const acceptedPlan = trustedModuleDeliveryPlanSnapshot(request.acceptedPlan);
  const repositoryRoot = authenticateModuleDeliverySourceCommit({
    repositoryRoot: request.repositoryRoot,
    sourceCommit: acceptedPlan.plan.sourceCommit,
  });
  assertExactWritesAreNotSourceDirectories({ acceptedPlan, repositoryRoot });
  return Object.freeze({ acceptedPlan, repositoryRoot });
}

function assertExactWritesAreNotSourceDirectories(
  request: FrozenModuleDeliveryAdmissionSource,
): void {
  for (const node of request.acceptedPlan.plan.nodes) {
    if (node.kind !== ModuleDeliveryTaskKind.Write) continue;
    for (const write of node.resources.write) {
      if (write.includes('*')) continue;
      const result = runModuleDeliveryGit({
        cwd: request.repositoryRoot,
        args: [
          'ls-tree',
          '-z',
          request.acceptedPlan.plan.sourceCommit,
          '--',
          write,
        ],
      });
      if (result.stdout.subarray(0, 12).toString('utf8') === '040000 tree ')
        throw new Error(
          `Exact ordinary write claim names a source directory: ${write}`,
        );
    }
  }
}
