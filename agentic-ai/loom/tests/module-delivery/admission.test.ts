import {
  ModuleDeliveryAdmissionScenario,
  ROOT,
  SOURCE,
  PLAN,
  gamma,
  fixture,
  consumer,
  beta,
  alpha,
} from './admission.fixture.ts';
import type {
  GenerationPlanRequest,
  Runtime,
  LeaseRequest,
  CancelledLeaseRequest,
  GenerationRestartRequest,
  EvidenceSubmissionRequest,
} from './admission.fixture.ts';
export { ModuleDeliveryAdmissionScenario } from './admission.fixture.ts';
import { afterAll, describe, expect, test } from 'bun:test';

import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';

import { TeamKey } from '../../src/team-agents/catalog.ts';

import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';

import type { FixtureFileWrite } from './worktree-test-support.ts';

import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryAdmissionSelectionStatus,
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryGenerationFenceKind,
  ModuleDeliveryTaskKind,
  ModuleGenerationAuthority,
} from '../../src/module-delivery/index.ts';

import type {
  CreateModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryGenerationAuthorityRequest,
  ModuleDeliveryAdmissionState,
  ModuleDeliveryPlanV2,
  ModuleDeliveryReadOnlyNodeV2,
  RecordModuleDeliveryAttemptDispositionRequest,
  RecordModuleDeliveryAttemptLeasesRequest,
  RestartModuleDeliveryGenerationRequest,
  SelectModuleDeliveryAdmissionsRequest,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';

import type { ModuleDeliveryEvidenceSubmissionVerification } from '../../src/module-delivery/evidence.ts';

const replacementWrite: FixtureFileWrite = {
  fixture,
  relativePath: 'module/replacement.txt',
  contents: 'replacement\n',
};

ModuleDeliveryWorktreeTestSupportScenario.writeFixtureFile(replacementWrite);

ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)(['add', '--all']);

ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
  'commit',
  '--quiet',
  '-m',
  'replacement',
]);

const REPLACEMENT_SOURCE = ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(
  fixture,
)(['rev-parse', 'HEAD']);

const foreignFixture =
  ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();

const foreignWrite: FixtureFileWrite = {
  fixture: foreignFixture,
  relativePath: 'module/foreign.txt',
  contents: 'foreign\n',
};

ModuleDeliveryWorktreeTestSupportScenario.writeFixtureFile(foreignWrite);

ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(foreignFixture)([
  'add',
  '--all',
]);

ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(foreignFixture)([
  'commit',
  '--quiet',
  '-m',
  'foreign',
]);

const FOREIGN_SOURCE = ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(
  foreignFixture,
)(['rev-parse', 'HEAD']);

type PlanConcurrencyUpdate = { readonly maxConcurrency: number };

describe('module delivery admission authority', () => {
  test('serializes writers and rejects unproven writer frontiers', () => {
    const active = ModuleDeliveryAdmissionScenario.runtime(
      ModuleDeliveryAdmissionScenario.validate(PLAN),
    );
    const first = ModuleDeliveryAdmissionScenario.select(active);
    expect(first.admissions.map(({ taskId }) => taskId)).toEqual(['alpha']);
    expect(first.pendingTaskIds).toContain('beta');
    const forgedFrontier = {
      taskId: 'alpha',
      attempt: 1,
      generation: 1,
      planDigest: active.accepted.planDigest,
      headCommit: '89abcdef0123456789abcdef0123456789abcdef',
      integratedTaskIds: ['alpha'],
    } as never;
    const unrelatedFrontier = {
      taskId: 'beta',
      attempt: 1,
      generation: 1,
      planDigest: active.accepted.planDigest,
      headCommit: 'f'.repeat(40),
      integratedTaskIds: ['beta'],
    } as never;
    const advancedStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: '89abcdef0123456789abcdef0123456789abcdef',
      integratedWriterFrontiers: [forgedFrontier, unrelatedFrontier],
      acceptedEvidence: [],
    };
    expect(() =>
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
        advancedStateRequest,
      ),
    ).toThrow('capability is invalid');
    const arbitraryHeadRequest = {
      ...advancedStateRequest,
      integratedWriterFrontiers: [],
    };
    expect(() =>
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
        arbitraryHeadRequest,
      ),
    ).toThrow('lacks integration authority');
  });

  test('snapshots validated metadata and rejects forged plans and lineage', () => {
    const accepted = ModuleDeliveryAdmissionScenario.validate(PLAN);
    const active = ModuleDeliveryAdmissionScenario.runtime(accepted);
    const sourceNode = accepted.plan.nodes.find(
      ({ taskId }) => taskId === 'alpha',
    );
    if (!sourceNode) throw new Error('Alpha node is missing.');
    (sourceNode.resources.read as string[]).push(`${ROOT}/forged/**`);
    const planRequest = {
      authority: active.authority,
      acceptedPlan: accepted,
    };
    const exposedNode = ModuleGenerationAuthority.moduleDeliveryAuthorityPlan(
      planRequest,
    ).plan.nodes.find(({ taskId }) => taskId === 'alpha');
    if (!exposedNode) throw new Error('Exposed alpha node is missing.');
    (exposedNode.resources.read as string[]).push(`${ROOT}/exposed/**`);
    const admission = ModuleDeliveryAdmissionScenario.select(
      active,
    ).admissions.find(({ taskId }) => taskId === 'alpha');
    expect(admission?.resources.read).not.toContain(`${ROOT}/forged/**`);
    expect(admission?.resources.read).not.toContain(`${ROOT}/exposed/**`);

    const forged: ValidatedModuleDeliveryPlan = {
      ...ModuleDeliveryAdmissionScenario.validate(PLAN),
      topologicalOrder: ['consumer', 'alpha', 'beta'],
    };
    const forgedAuthorityRequest =
      ModuleDeliveryAdmissionScenario.authorityRequest(forged);
    expect(() =>
      ModuleGenerationAuthority.createModuleDeliveryGenerationAuthority(
        forgedAuthorityRequest,
      ),
    ).toThrow('metadata is inconsistent');

    for (const sourceCommit of [
      'f'.repeat(40),
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
        'rev-parse',
        `${SOURCE}:module/seed.txt`,
      ]),
    ]) {
      const sourceAuthorityRequest =
        ModuleDeliveryAdmissionScenario.authorityRequest(
          ModuleDeliveryAdmissionScenario.validate(
            ModuleDeliveryAdmissionScenario.planAt(sourceCommit),
          ),
        );
      expect(() =>
        ModuleGenerationAuthority.createModuleDeliveryGenerationAuthority(
          sourceAuthorityRequest,
        ),
      ).toThrow('source commit is not authenticated');
    }
    const noncanonicalRootRequest: CreateModuleDeliveryGenerationAuthorityRequest =
      {
        ...ModuleDeliveryAdmissionScenario.authorityRequest(
          ModuleDeliveryAdmissionScenario.validate(PLAN),
        ),
        repositoryRoot: `${fixture.sourceRoot}/module`,
      };
    expect(() =>
      ModuleGenerationAuthority.createModuleDeliveryGenerationAuthority(
        noncanonicalRootRequest,
      ),
    ).toThrow('repository root is not canonical');

    const wrongLineage = ModuleDeliveryAdmissionScenario.lineage(
      ModuleDeliveryAdmissionScenario.validate(PLAN),
    ).map(({ taskId }) => ({
      taskId,
      parentLineage: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: 'forged-task',
        agent: 'forged-agent',
        attempt: 2,
      },
    }));
    const wrongLineageAuthorityRequest = {
      ...ModuleDeliveryAdmissionScenario.authorityRequest(
        ModuleDeliveryAdmissionScenario.validate(PLAN),
      ),
      expectedLineage: wrongLineage,
    };
    expect(() =>
      ModuleGenerationAuthority.createModuleDeliveryGenerationAuthority(
        wrongLineageAuthorityRequest,
      ),
    ).toThrow('Expected lineage is invalid');
  });

  test('rejects forged states, admissions, attempts, and conflicts atomically', () => {
    const active = ModuleDeliveryAdmissionScenario.runtime(
      ModuleDeliveryAdmissionScenario.validate(PLAN),
    );
    const admission =
      ModuleDeliveryAdmissionScenario.select(active).admissions[0];
    if (!admission) throw new Error('Admission is missing.');
    const forgedState: ModuleDeliveryAdmissionState = { ...active.state };
    const forgedSelectionRequest: SelectModuleDeliveryAdmissionsRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      state: forgedState,
    };
    expect(() =>
      ModuleGenerationAuthority.selectModuleDeliveryAdmissions(
        forgedSelectionRequest,
      ),
    ).toThrow('authority is invalid');
    const exactLeaseRequest: RecordModuleDeliveryAttemptLeasesRequest = {
      authority: active.authority,
      state: active.state,
      admissions: [admission],
    };
    const forgedAdmission = { ...admission, taskId: 'beta', attempt: 4 };
    const invalidAdmissions = [[admission, admission], [forgedAdmission]];
    for (const admissions of invalidAdmissions) {
      const invalidRequest = { ...exactLeaseRequest, admissions };
      expect(() =>
        ModuleGenerationAuthority.recordModuleDeliveryAttemptLeases(
          invalidRequest,
        ),
      ).toThrow('capability is invalid');
    }
    expect(
      ModuleGenerationAuthority.recordModuleDeliveryAttemptLeases(
        exactLeaseRequest,
      ).leases,
    ).toHaveLength(1);
  });

  test('retains lease history through disposition and reports exhausted closure', () => {
    const exhaustionPlan: ModuleDeliveryPlanV2 = {
      ...PLAN,
      maxConcurrency: 1,
    };
    const active = ModuleDeliveryAdmissionScenario.runtime(
      ModuleDeliveryAdmissionScenario.validate(exhaustionPlan),
    );
    const firstLeaseRequest: LeaseRequest = {
      runtime: active,
      taskId: 'alpha',
    };
    const firstLease = ModuleDeliveryAdmissionScenario.lease(firstLeaseRequest);
    const dispositionRequest: RecordModuleDeliveryAttemptDispositionRequest = {
      authority: active.authority,
      state: active.state,
      lease: firstLease,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.FinalUnusable,
        conclusion: ModuleDeliveryGenerationFenceKind.Cancelled,
      },
    };
    const dispositionState =
      ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition(
        dispositionRequest,
      );
    const retryRuntime: Runtime = {
      ...active,
      state: dispositionState,
    };
    const retry = ModuleDeliveryAdmissionScenario.select(
      retryRuntime,
    ).admissions.find(({ taskId }) => taskId === 'alpha');
    expect(retry?.startingFrontier).toBe(firstLease.startingFrontier);

    const secondLeaseRequest = { runtime: retryRuntime, taskId: 'alpha' };
    const secondLease =
      ModuleDeliveryAdmissionScenario.lease(secondLeaseRequest);
    const secondDispositionRequest: RecordModuleDeliveryAttemptDispositionRequest =
      { ...dispositionRequest, state: dispositionState, lease: secondLease };
    const exhaustedState =
      ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition(
        secondDispositionRequest,
      );
    const exhaustedRuntime: Runtime = {
      ...retryRuntime,
      state: exhaustedState,
    };
    const exhaustedSelection =
      ModuleDeliveryAdmissionScenario.select(exhaustedRuntime);
    const selected = ModuleDeliveryAdmissionSelectionStatus.Selected;
    expect(exhaustedSelection.status).toBe(selected);
    expect(exhaustedSelection.blockedTaskIds).toEqual(['alpha', 'consumer']);
    const betaLeaseRequest: LeaseRequest = {
      runtime: exhaustedRuntime,
      taskId: 'beta',
    };
    ModuleDeliveryAdmissionScenario.lease(betaLeaseRequest);
    const ongoingSelection =
      ModuleDeliveryAdmissionScenario.select(exhaustedRuntime);
    expect(ongoingSelection.status).toBe(selected);
    expect(ongoingSelection.admissions).toEqual([]);
    expect(ongoingSelection.pendingTaskIds).toEqual(['gamma']);
  });

  test('rejects replacement failures transactionally and keeps the prior generation usable', () => {
    const firstPlanRequest: GenerationPlanRequest = {
      sourceCommit: SOURCE,
      generation: 1,
      includeGamma: false,
    };
    const active = ModuleDeliveryAdmissionScenario.runtime(
      ModuleDeliveryAdmissionScenario.validate(
        ModuleDeliveryAdmissionScenario.generationPlan(firstPlanRequest),
      ),
    );
    const assertPriorGenerationUsable = (): void => {
      const current = ModuleDeliveryAdmissionScenario.select(active);
      expect(current.admissions.map(({ generation }) => generation)).toEqual([
        1,
      ]);
    };
    const replacementPlanRequest: GenerationPlanRequest = {
      sourceCommit: REPLACEMENT_SOURCE,
      generation: 2,
      includeGamma: true,
    };
    const replacement = ModuleDeliveryAdmissionScenario.validate(
      ModuleDeliveryAdmissionScenario.generationPlan(replacementPlanRequest),
    );
    const sameGenerationRequest: GenerationRestartRequest = {
      runtime: active,
      acceptedPlan: active.accepted,
    };
    expect(() =>
      ModuleGenerationAuthority.restartModuleDeliveryGeneration(
        ModuleDeliveryAdmissionScenario.restartRequest(sameGenerationRequest),
      ),
    ).toThrow('newer immutable generation');
    assertPriorGenerationUsable();

    const forged: ValidatedModuleDeliveryPlan = {
      ...replacement,
      executionPrecedence: [],
    };
    const forgedRequest: GenerationRestartRequest = {
      runtime: active,
      acceptedPlan: forged,
    };
    expect(() =>
      ModuleGenerationAuthority.restartModuleDeliveryGeneration(
        ModuleDeliveryAdmissionScenario.restartRequest(forgedRequest),
      ),
    ).toThrow('metadata is inconsistent');
    assertPriorGenerationUsable();

    const blob = ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'rev-parse',
      `${SOURCE}:module/seed.txt`,
    ]);
    for (const sourceCommit of ['f'.repeat(40), blob, FOREIGN_SOURCE]) {
      const invalidPlanRequest: GenerationPlanRequest = {
        sourceCommit,
        generation: 2,
        includeGamma: true,
      };
      const invalidRestartRequest: GenerationRestartRequest = {
        runtime: active,
        acceptedPlan: ModuleDeliveryAdmissionScenario.validate(
          ModuleDeliveryAdmissionScenario.generationPlan(invalidPlanRequest),
        ),
      };
      expect(() =>
        ModuleGenerationAuthority.restartModuleDeliveryGeneration(
          ModuleDeliveryAdmissionScenario.restartRequest(invalidRestartRequest),
        ),
      ).toThrow('source commit is not authenticated');
      assertPriorGenerationUsable();
    }

    const validRestartRequest: GenerationRestartRequest = {
      runtime: active,
      acceptedPlan: replacement,
    };
    const wrongLineageRequest =
      ModuleDeliveryAdmissionScenario.restartRequest(validRestartRequest);
    const wrongLineage: RestartModuleDeliveryGenerationRequest = {
      ...wrongLineageRequest,
      expectedLineage: wrongLineageRequest.expectedLineage.map(
        ({ taskId }) => ({
          taskId,
          parentLineage: {
            kind: AgentAttemptParentKind.AgentAttempt,
            task: 'forged-task',
            agent: 'forged-agent',
            attempt: 2,
          },
        }),
      ),
    };
    expect(() =>
      ModuleGenerationAuthority.restartModuleDeliveryGeneration(wrongLineage),
    ).toThrow('Expected lineage is invalid');
    assertPriorGenerationUsable();

    const alphaLeaseRequest: LeaseRequest = {
      runtime: active,
      taskId: alpha.taskId,
    };
    const leasedAlpha =
      ModuleDeliveryAdmissionScenario.lease(alphaLeaseRequest);
    const blockedRestartRequest: GenerationRestartRequest = {
      runtime: active,
      acceptedPlan: replacement,
    };
    expect(() =>
      ModuleGenerationAuthority.restartModuleDeliveryGeneration(
        ModuleDeliveryAdmissionScenario.restartRequest(blockedRestartRequest),
      ),
    ).toThrow('terminal release evidence');
    expect(ModuleDeliveryAdmissionScenario.select(active).admissions).toEqual(
      [],
    );
    const cancellationRequest: CancelledLeaseRequest = {
      runtime: active,
      lease: leasedAlpha,
    };
    ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition(
      ModuleDeliveryAdmissionScenario.cancelledLease(cancellationRequest),
    );
    assertPriorGenerationUsable();
  });

  test('restarts with a clean immutable generation and monotonic surviving attempts', () => {
    const firstPlanRequest: GenerationPlanRequest = {
      sourceCommit: SOURCE,
      generation: 1,
      includeGamma: false,
    };
    const active = ModuleDeliveryAdmissionScenario.runtime(
      ModuleDeliveryAdmissionScenario.validate(
        ModuleDeliveryAdmissionScenario.generationPlan(firstPlanRequest),
      ),
    );
    const oldSelection = ModuleDeliveryAdmissionScenario.select(active);
    const alphaAdmission = oldSelection.admissions.find(
      ({ taskId }) => taskId === alpha.taskId,
    );
    if (!alphaAdmission) throw new Error('Alpha admission is missing.');
    const alphaLease = ModuleDeliveryAdmissionScenario.lease({
      runtime: active,
      taskId: alpha.taskId,
    });
    ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition(
      ModuleDeliveryAdmissionScenario.cancelledLease({
        runtime: active,
        lease: alphaLease,
      }),
    );
    const replacementPlanRequest: GenerationPlanRequest = {
      sourceCommit: REPLACEMENT_SOURCE,
      generation: 2,
      includeGamma: true,
    };
    const replacementPlan = ModuleDeliveryAdmissionScenario.generationPlan(
      replacementPlanRequest,
    );
    Object.assign(replacementPlan, { maxConcurrency: 3 });
    const raisedAttemptLimit = ModuleDeliveryAdmissionScenario.validate({
      ...replacementPlan,
      maxAttempts: 3,
    });
    expect(() =>
      ModuleGenerationAuthority.restartModuleDeliveryGeneration(
        ModuleDeliveryAdmissionScenario.restartRequest({
          runtime: active,
          acceptedPlan: raisedAttemptLimit,
        }),
      ),
    ).toThrow('cannot change maxAttempts');
    const replacement =
      ModuleDeliveryAdmissionScenario.validate(replacementPlan);
    const restarted = ModuleGenerationAuthority.restartModuleDeliveryGeneration(
      ModuleDeliveryAdmissionScenario.restartRequest({
        runtime: active,
        acceptedPlan: replacement,
      }),
    );
    const expectedState: ModuleDeliveryAdmissionState = {
      generation: 2,
      planDigest: replacement.planDigest,
      headCommit: REPLACEMENT_SOURCE,
      integratedWriterFrontiers: [],
      acceptedProviderEvidence: [],
    };
    expect(restarted).toEqual(expectedState);
    expect(Object.isFrozen(restarted)).toBe(true);
    expect(Object.isFrozen(restarted.integratedWriterFrontiers)).toBe(true);
    expect(Object.isFrozen(restarted.acceptedProviderEvidence)).toBe(true);
    const restartedRuntime: Runtime = {
      accepted: replacement,
      authority: active.authority,
      state: restarted,
    };
    const admissions =
      ModuleDeliveryAdmissionScenario.select(restartedRuntime).admissions;
    expect(
      admissions.map(({ taskId, attempt, startingFrontier }) => ({
        taskId,
        attempt,
        startingFrontier,
      })),
    ).toEqual([
      {
        taskId: alpha.taskId,
        attempt: 2,
        startingFrontier: REPLACEMENT_SOURCE,
      },
    ]);
    expect(() => ModuleDeliveryAdmissionScenario.select(active)).toThrow(
      'invalid or superseded',
    );
    const staleLeaseRequest: RecordModuleDeliveryAttemptLeasesRequest = {
      authority: active.authority,
      state: active.state,
      admissions: [alphaAdmission],
    };
    expect(() =>
      ModuleGenerationAuthority.recordModuleDeliveryAttemptLeases(
        staleLeaseRequest,
      ),
    ).toThrow('authority is invalid');
  });

  test('retires accepted evidence authority across immutable generations', () => {
    const provider: ModuleDeliveryReadOnlyNodeV2 = {
      kind: ModuleDeliveryTaskKind.ReadOnly,
      taskId: 'provider-evidence',
      team: TeamKey.DevelopmentCore,
      functionalOwner: TeamKey.Ai,
      acceptanceOwner: TeamKey.Ai,
      parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
      expert: 'core_expert',
      moduleRoot: ROOT,
      consumerOutcome: 'AI receives accepted provider evidence.',
      baseline: {
        kind: ModuleDeliveryBaselineKind.SourceCommit,
        sourceCommit: SOURCE,
      },
      agentDepthLimit: 2,
      dependencies: [],
      resources: {
        read: [`${ROOT}/**`],
        write: [],
        evidenceSurface: [`${ROOT}/**`],
      },
      parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
      acceptance: alpha.acceptance,
    };
    const firstPlan: ModuleDeliveryPlanV2 = {
      ...PLAN,
      nodes: [provider],
      edgeContracts: [],
    };
    const first = ModuleDeliveryAdmissionScenario.runtime(
      ModuleDeliveryAdmissionScenario.validate(firstPlan),
    );
    const firstLeaseRequest: LeaseRequest = {
      runtime: first,
      taskId: provider.taskId,
    };
    const firstLease = ModuleDeliveryAdmissionScenario.lease(firstLeaseRequest);
    const firstSubmissionRequest: EvidenceSubmissionRequest = {
      runtime: first,
      lease: firstLease,
      acceptedEvidence: [],
    };
    const acceptedFirst = ModuleDeliveryAdmissionScenario.acceptEvidence(
      firstSubmissionRequest,
    );
    const terminalFirst: Runtime = { ...first, state: acceptedFirst.state };
    const secondPlan = structuredClone(firstPlan);
    const secondPlanUpdate = {
      generation: 2,
      sourceCommit: REPLACEMENT_SOURCE,
    };
    Object.assign(secondPlan, secondPlanUpdate);
    const secondProvider = secondPlan.nodes.find(
      ({ taskId }) => taskId === provider.taskId,
    );
    if (
      !secondProvider ||
      secondProvider.baseline.kind !== ModuleDeliveryBaselineKind.SourceCommit
    )
      throw new Error('Second-generation provider is missing.');
    const secondBaselineUpdate = { sourceCommit: REPLACEMENT_SOURCE };
    Object.assign(secondProvider.baseline, secondBaselineUpdate);
    const acceptedSecondPlan =
      ModuleDeliveryAdmissionScenario.validate(secondPlan);
    const generationRestartRequest: GenerationRestartRequest = {
      runtime: terminalFirst,
      acceptedPlan: acceptedSecondPlan,
    };
    const restartedState =
      ModuleGenerationAuthority.restartModuleDeliveryGeneration(
        ModuleDeliveryAdmissionScenario.restartRequest(
          generationRestartRequest,
        ),
      );
    const evidenceInspection = {
      authority: first.authority,
      evidence: acceptedFirst.evidence,
    };
    expect(() =>
      ModuleGenerationAuthority.assertAcceptedModuleDeliveryEvidence(
        evidenceInspection,
      ),
    ).toThrow('evidence authority is invalid');
    expect(() =>
      ModuleGenerationAuthority.moduleDeliveryAcceptedEvidenceIdentity(
        acceptedFirst.evidence,
      ),
    ).toThrow('evidence is forged');
    const staleStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: first.authority,
      acceptedPlan: acceptedSecondPlan,
      headCommit: REPLACEMENT_SOURCE,
      integratedWriterFrontiers: [],
      acceptedEvidence: [acceptedFirst.evidence],
    };
    expect(() =>
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
        staleStateRequest,
      ),
    ).toThrow('evidence authority is invalid');
    const second: Runtime = {
      accepted: acceptedSecondPlan,
      authority: first.authority,
      state: restartedState,
    };
    const secondLeaseRequest: LeaseRequest = {
      runtime: second,
      taskId: provider.taskId,
    };
    const secondLease =
      ModuleDeliveryAdmissionScenario.lease(secondLeaseRequest);
    const secondSubmissionRequest: EvidenceSubmissionRequest = {
      runtime: second,
      lease: secondLease,
      acceptedEvidence: [],
    };
    const secondSubmission = ModuleDeliveryAdmissionScenario.evidenceSubmission(
      secondSubmissionRequest,
    );
    const staleAuthorization: ModuleDeliveryEvidenceSubmissionVerification = {
      authority: second.authority,
      acceptedPlan: second.accepted,
      repositoryRoot: fixture.sourceRoot,
      state: second.state,
      submission: secondSubmission,
      lease: secondLease,
      authorizedProviderEvidence: [acceptedFirst.evidence],
    };
    expect(() =>
      ModuleGenerationAuthority.verifyModuleDeliveryEvidenceSubmission(
        staleAuthorization,
      ),
    ).toThrow('evidence authority is invalid');
  });

  test('carries attempt exhaustion across generations and propagates blocked closure', () => {
    const firstPlanRequest: GenerationPlanRequest = {
      sourceCommit: SOURCE,
      generation: 1,
      includeGamma: false,
    };
    const firstPlan =
      ModuleDeliveryAdmissionScenario.generationPlan(firstPlanRequest);
    const concurrencyUpdate: PlanConcurrencyUpdate = { maxConcurrency: 1 };
    Object.assign(firstPlan, concurrencyUpdate);
    const active = ModuleDeliveryAdmissionScenario.runtime(
      ModuleDeliveryAdmissionScenario.validate(firstPlan),
    );
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const alphaLeaseRequest: LeaseRequest = {
        runtime: active,
        taskId: alpha.taskId,
      };
      const alphaLease =
        ModuleDeliveryAdmissionScenario.lease(alphaLeaseRequest);
      expect(alphaLease.attempt).toBe(attempt);
      const cancellationRequest: CancelledLeaseRequest = {
        runtime: active,
        lease: alphaLease,
      };
      ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition(
        ModuleDeliveryAdmissionScenario.cancelledLease(cancellationRequest),
      );
    }
    const replacementPlanRequest: GenerationPlanRequest = {
      sourceCommit: REPLACEMENT_SOURCE,
      generation: 2,
      includeGamma: true,
    };
    const replacement = ModuleDeliveryAdmissionScenario.validate(
      ModuleDeliveryAdmissionScenario.generationPlan(replacementPlanRequest),
    );
    const generationRestartRequest: GenerationRestartRequest = {
      runtime: active,
      acceptedPlan: replacement,
    };
    const state = ModuleGenerationAuthority.restartModuleDeliveryGeneration(
      ModuleDeliveryAdmissionScenario.restartRequest(generationRestartRequest),
    );
    const restarted: Runtime = {
      accepted: replacement,
      authority: active.authority,
      state,
    };
    const selection = ModuleDeliveryAdmissionScenario.select(restarted);
    expect(selection.status).toBe(
      ModuleDeliveryAdmissionSelectionStatus.Selected,
    );
    expect(selection.blockedTaskIds).toEqual([alpha.taskId, consumer.taskId]);
    expect(
      selection.admissions.map(({ taskId, attempt }) => ({
        taskId,
        attempt,
      })),
    ).toEqual([{ taskId: beta.taskId, attempt: 1 }]);
    expect(selection.pendingTaskIds).toContain(gamma.taskId);
  });
});

afterAll(() => {
  ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(fixture);
  ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(foreignFixture);
});
