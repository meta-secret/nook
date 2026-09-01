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
      const segments = write.split('/');
      for (let length = 1; length < segments.length; length += 1) {
        const ancestor = segments.slice(0, length).join('/');
        const result = sourceTreeEntry({ ...request, path: ancestor });
        if (
          result.stdout.length > 0 &&
          result.stdout.subarray(0, 12).toString('utf8') !== '040000 tree '
        )
          throw new Error(
            `Exact ordinary write claim has a non-directory source ancestor: ${ancestor}`,
          );
      }
      const result = sourceTreeEntry({ ...request, path: write });
      if (result.stdout.subarray(0, 12).toString('utf8') === '040000 tree ')
        throw new Error(
          `Exact ordinary write claim names a source directory: ${write}`,
        );
    }
  }
}

function sourceTreeEntry(
  request: FrozenModuleDeliveryAdmissionSource & Readonly<{ path: string }>,
) {
  return runModuleDeliveryGit({
    cwd: request.repositoryRoot,
    args: [
      'ls-tree',
      '-z',
      request.acceptedPlan.plan.sourceCommit,
      '--',
      request.path,
    ],
  });
}
