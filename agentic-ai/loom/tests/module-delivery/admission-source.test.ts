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
  ModuleGenerationAuthority,
  ModuleDeliveryPlanDecoder,
} from '../../src/module-delivery/index.ts';

import { ModuleAdmissionSource } from '../../src/module-delivery/admission-source.ts';

import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';

import type {
  ModuleDeliveryPlanV2,
  ModuleDeliveryWriteNodeV2,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';

export class ModuleDeliveryAdmissionSourceScenario {
  private constructor(
    private readonly request: {
      readonly sourceCommit: string;
      readonly generation: number;
      readonly moduleRoot: string;
      readonly write: string;
    },
  ) {}

  static acceptedPlan(request: {
    readonly sourceCommit: string;
    readonly generation: number;
    readonly moduleRoot: string;
    readonly write: string;
  }): ValidatedModuleDeliveryPlan {
    return new ModuleDeliveryAdmissionSourceScenario(request).execute();
  }

  private execute(): ValidatedModuleDeliveryPlan {
    const request = this.request;
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
        kind: ModuleDeliveryWorkspaceKind.SharedCheckout,
        expectedCommitHandoff: true,
      },
    };
    const plan: ModuleDeliveryPlanV2 = {
      version: MODULE_DELIVERY_PLAN_VERSION,
      generation: request.generation,
      sourceCommit: request.sourceCommit,
      maxConcurrency: 1,
      maxAgentDepth: 1,
      maxAttempts: 1,
      parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
      parentJoin: {
        kind: ModuleDeliveryJoinKind.DirectCommits,
        owner: 'delivery-owner',
        validationCommands: ['task test'],
      },
      nodes: [node],
      edgeContracts: [],
    };
    const result = ModuleDeliveryPlanDecoder.decodeAndValidate(
      JSON.stringify(plan),
    );
    if (result.status !== ModuleDeliveryValidationStatus.Accepted)
      throw new Error(JSON.stringify(result.issues));
    return result;
  }
}

test('classifies exact writes against the frozen source tree', () => {
  const fixture = ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
  try {
    const exactPath = 'infra/k0s/scripts/k0s-worker-mesh-reconcile';
    ModuleDeliveryWorktreeTestSupportScenario.writeFixtureFile({
      fixture,
      relativePath: exactPath,
      contents: '#!/bin/sh\n',
    });
    ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'add',
      '--all',
    ]);
    ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'commit',
      '--quiet',
      '-m',
      'owned paths',
    ]);
    const sourceCommit = ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(
      fixture,
    )(['rev-parse', 'HEAD']);
    const acceptedFile = ModuleDeliveryAdmissionSourceScenario.acceptedPlan({
      sourceCommit,
      generation: 1,
      moduleRoot: 'infra/k0s/scripts',
      write: exactPath,
    });
    expect(() =>
      ModuleAdmissionSource.freeze({
        acceptedPlan: acceptedFile,
        repositoryRoot: fixture.sourceRoot,
      }),
    ).not.toThrow();

    const acceptedDirectory =
      ModuleDeliveryAdmissionSourceScenario.acceptedPlan({
        sourceCommit,
        generation: 2,
        moduleRoot: 'infra/k0s',
        write: 'infra/k0s/scripts',
      });
    expect(() =>
      ModuleAdmissionSource.freeze({
        acceptedPlan: acceptedDirectory,
        repositoryRoot: fixture.sourceRoot,
      }),
    ).toThrow('names a source directory');

    const acceptedBelowFile =
      ModuleDeliveryAdmissionSourceScenario.acceptedPlan({
        sourceCommit,
        generation: 3,
        moduleRoot: 'infra/k0s/scripts',
        write: `${exactPath}/child.md`,
      });
    expect(() =>
      ModuleAdmissionSource.freeze({
        acceptedPlan: acceptedBelowFile,
        repositoryRoot: fixture.sourceRoot,
      }),
    ).toThrow('non-directory source ancestor');

    const expectedLineage = acceptedFile.plan.nodes.map((node) => ({
      taskId: node.taskId,
      parentLineage: node.parentLineage,
    }));
    const authority =
      ModuleGenerationAuthority.createModuleDeliveryGenerationAuthority({
        acceptedPlan: acceptedFile,
        expectedLineage,
        repositoryRoot: fixture.sourceRoot,
      });
    const previousState =
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState({
        authority,
        acceptedPlan: acceptedFile,
        headCommit: sourceCommit,
        integratedWriterFrontiers: [],
        acceptedEvidence: [],
      });
    expect(() =>
      ModuleGenerationAuthority.restartModuleDeliveryGeneration({
        authority,
        acceptedPlan: acceptedDirectory,
        previousState,
        expectedLineage,
      }),
    ).toThrow('names a source directory');
  } finally {
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(fixture);
  }
});
