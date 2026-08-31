import { expect, test } from 'bun:test';

import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import {
  MODULE_DELIVERY_PLAN_VERSION,
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryTaskProfile,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  TeamKey,
  decodeAndValidateModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import { freezeModuleDeliveryAdmissionSource } from '../../src/module-delivery/admission-source.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
  writeFixtureFile,
} from './worktree-test-support.ts';

import type {
  ModuleDeliveryPlanV2,
  ModuleDeliveryWriteNodeV2,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';

function acceptedPlan(request: {
  readonly sourceCommit: string;
  readonly moduleRoot: string;
  readonly write: string;
}): ValidatedModuleDeliveryPlan {
  const node: ModuleDeliveryWriteNodeV2 = {
    kind: ModuleDeliveryTaskKind.Write,
    taskId: 'sre-writer',
    team: TeamKey.Sre,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: ModuleDeliveryTaskProfile.Ordinary,
    moduleRoot: request.moduleRoot,
    consumerOutcome: 'The exact SRE-owned path is updated.',
    baseline: {
      kind: ModuleDeliveryBaselineKind.SourceCommit,
      sourceCommit: request.sourceCommit,
    },
    agentDepthLimit: 1,
    dependencies: [],
    resources: { read: [], write: [request.write], evidenceSurface: [] },
    parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
    acceptance: { commands: ['task test'], evidence: ['tests pass'] },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree,
      expectedCommitHandoff: true,
    },
  };
  const plan: ModuleDeliveryPlanV2 = {
    version: MODULE_DELIVERY_PLAN_VERSION,
    generation: 1,
    sourceCommit: request.sourceCommit,
    maxConcurrency: 1,
    maxAgentDepth: 1,
    maxAttempts: 1,
    parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'delivery-owner',
      validationCommands: ['task test'],
    },
    nodes: [node],
    edgeContracts: [],
  };
  const result = decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan));
  if (result.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error(JSON.stringify(result.issues));
  return result;
}

test('classifies exact writes against the frozen source tree', () => {
  const fixture = createGitFixture();
  try {
    const exactPath = 'infra/k0s/scripts/k0s-worker-mesh-reconcile';
    writeFixtureFile({
      fixture,
      relativePath: exactPath,
      contents: '#!/bin/sh\n',
    });
    fixtureGit(fixture)(['add', '--all']);
    fixtureGit(fixture)(['commit', '--quiet', '-m', 'owned paths']);
    const sourceCommit = fixtureGit(fixture)(['rev-parse', 'HEAD']);
    const acceptedFile = acceptedPlan({
      sourceCommit,
      moduleRoot: 'infra/k0s/scripts',
      write: exactPath,
    });
    expect(() =>
      freezeModuleDeliveryAdmissionSource({
        acceptedPlan: acceptedFile,
        repositoryRoot: fixture.sourceRoot,
      }),
    ).not.toThrow();

    const acceptedDirectory = acceptedPlan({
      sourceCommit,
      moduleRoot: 'infra/k0s',
      write: 'infra/k0s/scripts',
    });
    expect(() =>
      freezeModuleDeliveryAdmissionSource({
        acceptedPlan: acceptedDirectory,
        repositoryRoot: fixture.sourceRoot,
      }),
    ).toThrow('names a source directory');
  } finally {
    disposeGitFixture(fixture);
  }
});
