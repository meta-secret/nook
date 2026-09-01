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
  const exactWrites = request.acceptedPlan.plan.nodes.flatMap((node) =>
    node.kind === ModuleDeliveryTaskKind.Write
      ? node.resources.write.filter((write) => !write.includes('*'))
      : [],
  );
  if (exactWrites.length === 0) return;
  const sourceTree = sourceTreeKinds(request);
  for (const write of exactWrites) {
    const segments = write.split('/');
    for (let length = 1; length < segments.length; length += 1) {
      const ancestor = segments.slice(0, length).join('/');
      if (sourceTree.entries.has(ancestor) && !sourceTree.trees.has(ancestor))
        throw new Error(
          `Exact ordinary write claim has a non-directory source ancestor: ${ancestor}`,
        );
    }
    if (sourceTree.trees.has(write))
      throw new Error(
        `Exact ordinary write claim names a source directory: ${write}`,
      );
  }
}

function sourceTreeKinds(request: FrozenModuleDeliveryAdmissionSource) {
  const result = runModuleDeliveryGit({
    cwd: request.repositoryRoot,
    args: ['ls-tree', '-r', '-t', '-z', request.acceptedPlan.plan.sourceCommit],
  });
  const entries = new Set<string>();
  const trees = new Set<string>();
  for (const entry of result.stdout.toString('utf8').split('\0')) {
    if (!entry) continue;
    const separator = entry.indexOf('\t');
    if (separator < 0) throw new Error('Source tree entry is malformed.');
    const path = entry.slice(separator + 1);
    entries.add(path);
    if (entry.startsWith('040000 tree ')) trees.add(path);
  }
  return { entries, trees } as const;
}
