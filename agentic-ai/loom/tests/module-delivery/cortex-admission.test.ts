import { describe, expect, test } from 'bun:test';
import { chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import {
  CORTEX_TEAM_WRITER_EXPERT,
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  createModuleDeliveryAdmissionState,
  createModuleDeliveryGenerationAuthority,
  decodeAndValidateModuleDeliveryPlan,
  recordModuleDeliveryAttemptLeases,
  selectModuleDeliveryAdmissions,
} from '../../src/module-delivery/index.ts';
import type {
  CreateModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryGenerationAuthorityRequest,
  ModuleDeliveryExpectedLineage,
  ModuleDeliveryPlanV2,
  RecordModuleDeliveryAttemptLeasesRequest,
  SelectModuleDeliveryAdmissionsRequest,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import { TeamKey } from '../../src/team-agents/catalog.ts';
import { CORTEX_AUTHORING_SKILL_PATHS } from '../../src/team-agents/context.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
  writeFixtureFile,
} from './worktree-test-support.ts';
import type { FixtureFileWrite, GitFixture } from './worktree-test-support.ts';

const SRE_CONTEXT = [
  '.cortex/teams/sre/AGENTS.md',
  '.cortex/teams/sre/knowledge-graph.md',
] as const;
const SRE_SKILL =
  '.cortex/teams/sre/dynamic-skills/github-actions-only-validation.md';

interface CortexFixtureFileWriteRequest {
  readonly fixture: GitFixture;
  readonly relativePath: string;
}

function write(request: CortexFixtureFileWriteRequest): void {
  const { fixture, relativePath } = request;
  const fileWrite: FixtureFileWrite = {
    fixture,
    relativePath,
    contents: `${relativePath}\n`,
  };
  writeFixtureFile(fileWrite);
}

function plan(sourceCommit: string): ModuleDeliveryPlanV2 {
  return {
    version: 2,
    generation: 7,
    sourceCommit,
    maxConcurrency: 1,
    maxAgentDepth: 3,
    maxAttempts: 2,
    parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'gizmo-prime',
      validationCommands: ['task loom:verify'],
    },
    nodes: [
      {
        kind: ModuleDeliveryTaskKind.Write,
        taskId: 'sre-cortex-writer',
        team: TeamKey.Sre,
        functionalOwner: TeamKey.Sre,
        acceptanceOwner: TeamKey.Sre,
        parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
        expert: CORTEX_TEAM_WRITER_EXPERT,
        moduleRoot: '.cortex/teams/sre',
        consumerOutcome: 'SRE guidance and its shared index are current.',
        baseline: {
          kind: ModuleDeliveryBaselineKind.SourceCommit,
          sourceCommit,
        },
        agentDepthLimit: 3,
        dependencies: [],
        resources: {
          read: [SRE_SKILL],
          write: [
            '.cortex/teams/sre/workflows/quality.md',
            '.cortex/shared/product-specs/index.md',
          ],
          evidenceSurface: [],
        },
        cortexAuthoring: {
          selectedSkillPaths: [SRE_SKILL],
          sharedWriteClaims: ['.cortex/shared/product-specs/index.md'],
        },
        parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES.filter(
          (claim) => claim !== '.cortex/**',
        ),
        acceptance: {
          commands: ['task loom:cortex-audit'],
          evidence: ['SRE Cortex guidance is indexed and audited.'],
        },
        workspace: {
          kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree,
          expectedCommitHandoff: true,
        },
      },
    ],
    edgeContracts: [],
  };
}

function validate(value: ModuleDeliveryPlanV2): ValidatedModuleDeliveryPlan {
  const result = decodeAndValidateModuleDeliveryPlan(JSON.stringify(value));
  if (result.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error(JSON.stringify(result.issues));
  return result;
}

function lineage(
  accepted: ValidatedModuleDeliveryPlan,
): readonly ModuleDeliveryExpectedLineage[] {
  return accepted.plan.nodes.map((node) => ({
    taskId: node.taskId,
    parentLineage: node.parentLineage,
  }));
}

describe('Cortex module-delivery admission', () => {
  test('freezes context reads, accepts regular blob modes, and records the lease', () => {
    const fixture = createGitFixture();
    try {
      for (const path of [
        ...SRE_CONTEXT,
        ...CORTEX_AUTHORING_SKILL_PATHS,
        SRE_SKILL,
      ]) {
        const writeRequest: CortexFixtureFileWriteRequest = {
          fixture,
          relativePath: path,
        };
        write(writeRequest);
      }
      chmodSync(
        join(fixture.sourceRoot, CORTEX_AUTHORING_SKILL_PATHS[0]),
        0o755,
      );
      fixtureGit(fixture)(['add', '--all']);
      fixtureGit(fixture)(['commit', '--quiet', '-m', 'cortex context']);
      const sourceCommit = fixtureGit(fixture)(['rev-parse', 'HEAD']);
      const accepted = validate(plan(sourceCommit));
      const generationRequest: CreateModuleDeliveryGenerationAuthorityRequest =
        {
          acceptedPlan: accepted,
          expectedLineage: lineage(accepted),
          repositoryRoot: fixture.sourceRoot,
        };
      const authority =
        createModuleDeliveryGenerationAuthority(generationRequest);
      rmSync(join(fixture.sourceRoot, CORTEX_AUTHORING_SKILL_PATHS[1]));
      fixtureGit(fixture)(['add', '--all']);
      fixtureGit(fixture)(['commit', '--quiet', '-m', 'checkout drift']);
      const replacementCommit = fixtureGit(fixture)(['rev-parse', 'HEAD']);
      fixtureGit(fixture)(['replace', sourceCommit, replacementCommit]);
      const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
        authority,
        acceptedPlan: accepted,
        headCommit: sourceCommit,
        integratedWriterFrontiers: [],
        acceptedEvidence: [],
      };
      const state = createModuleDeliveryAdmissionState(stateRequest);
      const selectionRequest: SelectModuleDeliveryAdmissionsRequest = {
        authority,
        acceptedPlan: accepted,
        state,
      };
      const selection = selectModuleDeliveryAdmissions(selectionRequest);
      const admission = selection.admissions[0];
      const expectedContext = [
        ...SRE_CONTEXT,
        ...CORTEX_AUTHORING_SKILL_PATHS,
        SRE_SKILL,
      ];
      expect(admission?.generation).toBe(7);
      expect(admission?.startingFrontier).toBe(sourceCommit);
      expect(admission?.context?.contextPaths).toEqual(expectedContext);
      expect(admission?.resources.read).toEqual(expectedContext);
      const leaseRequest: RecordModuleDeliveryAttemptLeasesRequest = {
        authority,
        state,
        admissions: selection.admissions,
      };
      const recorded = recordModuleDeliveryAttemptLeases(leaseRequest);
      expect(recorded.leases[0]?.planDigest).toBe(accepted.planDigest);
      expect(recorded.leases[0]?.context?.skillPaths).toEqual([
        ...CORTEX_AUTHORING_SKILL_PATHS,
        SRE_SKILL,
      ]);
    } finally {
      disposeGitFixture(fixture);
    }
  });
});
