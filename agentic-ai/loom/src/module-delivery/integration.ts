import { gitText, runModuleDeliveryGit } from './git-command.ts';
import {
  ModuleDeliveryBaselineKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
} from './domain.ts';
import {
  moduleCommitChangedPaths,
  verifyModuleCommitHandoff,
} from './handoff.ts';
import {
  assertSourceSnapshot,
  captureSourceSnapshot,
  createIntegrationSession,
  integrationProvenance,
  integrationSession,
  registerIntegrationState,
  retireIntegrationState,
} from './integration-provenance.ts';
import { applyModuleWaveTree } from './tree-integration.ts';
import { decodeAndValidateModuleDeliveryPlan } from './validation.ts';
import { EXACT_GIT_COMMIT } from './workspace-paths.ts';
import {
  assertPreparedModuleWorktreeIdentity,
  cleanupModuleWorktree,
  prepareModuleWorktree,
} from './workspace.ts';

import type { GitCommandRequest } from './git-command.ts';
import type {
  AcceptedModuleDeliveryPlan,
  ModuleDeliveryNode,
  WriteModuleDeliveryNode,
} from './domain.ts';
import type {
  ModuleCommitPathRequest,
  VerifyModuleCommitHandoffRequest,
} from './handoff.ts';
import type {
  ModuleIntegrationProvenance,
  ModuleIntegrationSession,
  SourceSnapshotExpectation,
} from './integration-provenance.ts';
import type {
  ApplyModuleWaveTreeRequest,
  TreeHandoff,
} from './tree-integration.ts';
import type {
  CleanupModuleWorktreeRequest,
  ModuleWorktreeHandle,
  PrepareModuleWorktreeRequest,
} from './workspace.ts';

const INTEGRATION_TASK_ID = 'module-delivery-integration';

export type PrepareModuleIntegrationRequest = {
  readonly repositoryRoot: string;
  readonly workspaceRoot: string;
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
};

export type ModuleDeliveryHandoffSubmission = {
  readonly taskId: string;
  readonly attempt: number;
  readonly planDigest: string;
  readonly baselineCommit: string;
  readonly commit: string;
  readonly workspace: ModuleWorktreeHandle;
};

export type ModuleIntegrationState = {
  readonly planDigest: string;
  readonly sourceCommit: string;
  readonly topologicalOrder: readonly string[];
  readonly waves: readonly (readonly string[])[];
  readonly completedWaveCount: number;
  readonly integratedTaskIds: readonly string[];
  readonly headCommit: string;
  readonly workspace: ModuleWorktreeHandle;
  readonly cleanupHandle: ModuleIntegrationCleanupHandle;
};

export type ModuleIntegrationCleanupHandle = {
  readonly sessionId: string;
};

export type IntegrateVerifiedModuleDeliveryWaveRequest = {
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
  readonly state: ModuleIntegrationState;
  readonly waveIndex: number;
  readonly handoffs: readonly ModuleDeliveryHandoffSubmission[];
};

export type CleanupModuleIntegrationRequest = {
  readonly cleanupHandle: ModuleIntegrationCleanupHandle;
};

export type CleanupModuleIntegrationResult = {
  readonly removed: boolean;
};

type ModuleGitInvocation = {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly allowFailure?: boolean;
};

type AcceptedPlanInspection = {
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
  readonly state?: ModuleIntegrationState;
};

type ExpectedHandoff = {
  readonly node: WriteModuleDeliveryNode;
  readonly baselineCommit: string;
  readonly submission: ModuleDeliveryHandoffSubmission;
};

type HandoffCollectionRequest = {
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
  readonly state: ModuleIntegrationState;
  readonly wave: readonly string[];
  readonly handoffs: readonly ModuleDeliveryHandoffSubmission[];
};

type StringArrayPair = {
  readonly first: readonly string[];
  readonly second: readonly string[];
};

type WaveArrayPair = {
  readonly first: readonly (readonly string[])[];
  readonly second: readonly (readonly string[])[];
};

type NodeLookup = {
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
  readonly taskId: string;
};

type ExpectedBaselineRequest = {
  readonly node: WriteModuleDeliveryNode;
  readonly state: ModuleIntegrationState;
};

type ExpectedHandoffVerification = {
  readonly expected: ExpectedHandoff;
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
};

type WaveApplication = {
  readonly state: ModuleIntegrationState;
  readonly expectedHandoffs: readonly ExpectedHandoff[];
};

type ValidatedWaveApplication = WaveApplication & {
  readonly provenance: ModuleIntegrationProvenance;
};

type FreshIntegrationInspection = {
  readonly state: ModuleIntegrationState;
  readonly provenance: ModuleIntegrationProvenance;
};

type IntegrationRefUpdate = {
  readonly provenance: ModuleIntegrationProvenance;
  readonly nextCommit: string;
};

type IntegrationRefIdentity = {
  readonly workspace: ModuleWorktreeHandle;
  readonly planDigest: string;
};

type IntegrationRefLookup = {
  readonly workspace: ModuleWorktreeHandle;
  readonly ref: string;
};

const ZERO_COMMIT = '0'.repeat(40);
const PROHIBITED_MATERIALIZATION_FILES = new Set([
  '.gitattributes',
  '.gitmodules',
  '.lfsconfig',
]);

function gitRequest(invocation: ModuleGitInvocation): GitCommandRequest {
  if ('allowFailure' in invocation) {
    return {
      cwd: invocation.cwd,
      args: invocation.args,
      allowFailure: invocation.allowFailure,
    };
  }
  return { cwd: invocation.cwd, args: invocation.args };
}

function gitInvocation(invocation: ModuleGitInvocation): string {
  return gitText(runModuleDeliveryGit(gitRequest(invocation)));
}

function arraysEqual(pair: StringArrayPair): boolean {
  return JSON.stringify(pair.first) === JSON.stringify(pair.second);
}

function wavesEqual(pair: WaveArrayPair): boolean {
  return JSON.stringify(pair.first) === JSON.stringify(pair.second);
}

function assertAcceptedPlan(inspection: AcceptedPlanInspection): void {
  const validation = decodeAndValidateModuleDeliveryPlan(
    JSON.stringify(inspection.acceptedPlan.plan),
  );
  if (validation.status !== ModuleDeliveryValidationStatus.Accepted) {
    throw new Error('Module integration requires an accepted plan.');
  }
  const acceptedOrderPair: StringArrayPair = {
    first: validation.topologicalOrder,
    second: inspection.acceptedPlan.topologicalOrder,
  };
  const acceptedWavePair: WaveArrayPair = {
    first: validation.waves,
    second: inspection.acceptedPlan.waves,
  };
  if (
    validation.planDigest !== inspection.acceptedPlan.planDigest ||
    !arraysEqual(acceptedOrderPair) ||
    !wavesEqual(acceptedWavePair)
  ) {
    throw new Error('Accepted module delivery plan metadata is inconsistent.');
  }
  const stateOrderPair: StringArrayPair = {
    first: inspection.state?.topologicalOrder ?? [],
    second: validation.topologicalOrder,
  };
  const stateWavePair: WaveArrayPair = {
    first: inspection.state?.waves ?? [],
    second: validation.waves,
  };
  if (
    inspection.state &&
    (inspection.state.planDigest !== validation.planDigest ||
      inspection.state.sourceCommit !== validation.plan.sourceCommit ||
      !arraysEqual(stateOrderPair) ||
      !wavesEqual(stateWavePair))
  ) {
    throw new Error(
      'Module integration state does not match the accepted plan.',
    );
  }
}

function currentWorkspaceHead(workspace: ModuleWorktreeHandle): string {
  const invocation: ModuleGitInvocation = {
    cwd: workspace.worktreePath,
    args: ['rev-parse', '--verify', 'HEAD^{commit}'],
  };
  return gitInvocation(invocation);
}

function integrationRef(identity: IntegrationRefIdentity): string {
  return `refs/nook/module-delivery/${identity.planDigest}/${identity.workspace.worktreeId}`;
}

function refCommit(lookup: IntegrationRefLookup): string {
  const invocation: ModuleGitInvocation = {
    cwd: lookup.workspace.sourceRepositoryRoot,
    args: ['rev-parse', '--verify', `${lookup.ref}^{commit}`],
  };
  return gitInvocation(invocation);
}

function updateIntegrationRef(update: IntegrationRefUpdate): void {
  const invocation: ModuleGitInvocation = {
    cwd: update.provenance.workspace.sourceRepositoryRoot,
    args: [
      'update-ref',
      '--create-reflog',
      update.provenance.session.integrationRef,
      update.nextCommit,
      update.provenance.headCommit,
    ],
  };
  runModuleDeliveryGit(gitRequest(invocation));
}

function rollbackIntegrationRef(update: IntegrationRefUpdate): void {
  const invocation: ModuleGitInvocation = {
    cwd: update.provenance.workspace.sourceRepositoryRoot,
    args: [
      'update-ref',
      update.provenance.session.integrationRef,
      update.provenance.headCommit,
      update.nextCommit,
    ],
  };
  runModuleDeliveryGit(gitRequest(invocation));
}

function assertPersistedSnapshots(
  inspection: FreshIntegrationInspection,
): void {
  const sourceExpectation: SourceSnapshotExpectation = {
    repositoryRoot: inspection.state.workspace.sourceRepositoryRoot,
    expected: inspection.provenance.sourceSnapshot,
  };
  assertSourceSnapshot(sourceExpectation);
  const workspaceExpectation: SourceSnapshotExpectation = {
    repositoryRoot: inspection.state.workspace.worktreePath,
    expected: inspection.provenance.workspaceSnapshot,
  };
  assertSourceSnapshot(workspaceExpectation);
}

function assertFreshIntegrationState(
  inspection: FreshIntegrationInspection,
): void {
  const state = inspection.state;
  const provenance = inspection.provenance;
  if (
    provenance.planDigest !== state.planDigest ||
    provenance.sourceCommit !== state.sourceCommit ||
    provenance.completedWaveCount !== state.completedWaveCount ||
    provenance.headCommit !== state.headCommit ||
    provenance.workspace !== state.workspace
  ) {
    throw new Error(
      'Module integration state violates its private provenance.',
    );
  }
  if (
    !Number.isSafeInteger(state.completedWaveCount) ||
    state.completedWaveCount < 0 ||
    state.completedWaveCount > state.waves.length
  ) {
    throw new Error('Module integration state has an invalid wave frontier.');
  }
  const expectedIntegratedTaskIds = state.waves
    .slice(0, state.completedWaveCount)
    .flat();
  const integratedPair: StringArrayPair = {
    first: state.integratedTaskIds,
    second: expectedIntegratedTaskIds,
  };
  if (!arraysEqual(integratedPair)) {
    throw new Error(
      'Module integration state has an inconsistent task frontier.',
    );
  }
  assertPreparedModuleWorktreeIdentity(state.workspace);
  if (
    state.workspace.planDigest !== state.planDigest ||
    state.workspace.baselineCommit !== state.sourceCommit ||
    state.workspace.taskId !== INTEGRATION_TASK_ID ||
    state.workspace.attempt !== 1
  ) {
    throw new Error('Module integration workspace metadata is inconsistent.');
  }
  if (currentWorkspaceHead(state.workspace) !== state.sourceCommit) {
    throw new Error(
      'Module integration worktree was changed without authority.',
    );
  }
  if (
    provenance.session.cleaned ||
    provenance.session.cleanupHandle !== state.cleanupHandle ||
    provenance.session.workspace !== state.workspace ||
    provenance.session.currentHead !== state.headCommit
  ) {
    throw new Error('Module integration session is stale or already cleaned.');
  }
  const refLookup: IntegrationRefLookup = {
    workspace: state.workspace,
    ref: provenance.session.integrationRef,
  };
  if (refCommit(refLookup) !== state.headCommit) {
    throw new Error('Module integration state is stale.');
  }
  const branchInvocation: ModuleGitInvocation = {
    cwd: state.workspace.worktreePath,
    args: ['symbolic-ref', '--quiet', 'HEAD'],
    allowFailure: true,
  };
  if (runModuleDeliveryGit(gitRequest(branchInvocation)).exitCode === 0) {
    throw new Error('Module integration workspace must keep detached HEAD.');
  }
}

function immutableState(state: ModuleIntegrationState): ModuleIntegrationState {
  const topologicalOrder = Object.freeze([...state.topologicalOrder]);
  const waves = Object.freeze(
    state.waves.map((wave) => Object.freeze([...wave])),
  );
  const integratedTaskIds = Object.freeze([...state.integratedTaskIds]);
  const workspaceCopy: ModuleWorktreeHandle = { ...state.workspace };
  const workspace = Object.isFrozen(state.workspace)
    ? state.workspace
    : Object.freeze(workspaceCopy);
  const stateCopy: ModuleIntegrationState = {
    ...state,
    topologicalOrder,
    waves,
    integratedTaskIds,
    workspace,
  };
  return Object.freeze(stateCopy);
}

function nodeByTaskId(lookup: NodeLookup): ModuleDeliveryNode {
  const node = lookup.acceptedPlan.plan.nodes.find(
    (candidate) => candidate.taskId === lookup.taskId,
  );
  if (!node) throw new Error(`Accepted plan is missing task ${lookup.taskId}.`);
  return node;
}

function expectedBaseline(request: ExpectedBaselineRequest): string {
  return request.node.baseline.kind === ModuleDeliveryBaselineKind.SourceCommit
    ? request.node.baseline.sourceCommit
    : request.state.headCommit;
}

function collectExpectedHandoffs(
  request: HandoffCollectionRequest,
): readonly ExpectedHandoff[] {
  const writeNodes = request.wave
    .map((taskId) => {
      const lookup: NodeLookup = {
        acceptedPlan: request.acceptedPlan,
        taskId,
      };
      return nodeByTaskId(lookup);
    })
    .filter(
      (node): node is WriteModuleDeliveryNode =>
        node.kind === ModuleDeliveryTaskKind.Write,
    );
  const expectedIds = writeNodes.map((node) => node.taskId).sort();
  const suppliedIds = request.handoffs.map((handoff) => handoff.taskId).sort();
  const identityPair: StringArrayPair = {
    first: expectedIds,
    second: suppliedIds,
  };
  if (!arraysEqual(identityPair)) {
    throw new Error(
      'Wave handoffs must exactly equal the accepted write tasks in the wave.',
    );
  }
  const submissions = new Map<string, ModuleDeliveryHandoffSubmission>();
  for (const submission of request.handoffs) {
    if (submissions.has(submission.taskId)) {
      throw new Error(`Wave contains duplicate handoff ${submission.taskId}.`);
    }
    submissions.set(submission.taskId, submission);
  }
  const orderedWriteNodes = request.state.topologicalOrder.flatMap((taskId) =>
    writeNodes.filter((node) => node.taskId === taskId),
  );
  return orderedWriteNodes.map((node) => {
    const submission = submissions.get(node.taskId);
    if (!submission) {
      throw new Error(`Wave is missing handoff ${node.taskId}.`);
    }
    const baselineRequest: ExpectedBaselineRequest = {
      node,
      state: request.state,
    };
    return {
      node,
      baselineCommit: expectedBaseline(baselineRequest),
      submission,
    };
  });
}

function verifyExpectedHandoff(
  verification: ExpectedHandoffVerification,
): void {
  const handoff = verification.expected.submission;
  if (
    handoff.taskId !== verification.expected.node.taskId ||
    handoff.attempt < 1 ||
    handoff.attempt > verification.acceptedPlan.plan.maxAttempts ||
    handoff.planDigest !== verification.acceptedPlan.planDigest ||
    handoff.baselineCommit !== verification.expected.baselineCommit ||
    handoff.workspace.taskId !== handoff.taskId ||
    handoff.workspace.attempt !== handoff.attempt ||
    handoff.workspace.planDigest !== handoff.planDigest ||
    handoff.workspace.baselineCommit !== handoff.baselineCommit ||
    !EXACT_GIT_COMMIT.test(handoff.commit)
  ) {
    throw new Error(
      `Handoff metadata is invalid for ${verification.expected.node.taskId}.`,
    );
  }
  const verificationRequest: VerifyModuleCommitHandoffRequest = {
    workspace: handoff.workspace,
    baselineCommit: verification.expected.baselineCommit,
    allowedWriteClaims: verification.expected.node.resources.write,
  };
  const pathRequest: ModuleCommitPathRequest = {
    workspace: handoff.workspace,
    baselineCommit: handoff.baselineCommit,
    commit: handoff.commit,
  };
  for (const path of moduleCommitChangedPaths(pathRequest)) {
    const basename = path.slice(path.lastIndexOf('/') + 1);
    if (PROHIBITED_MATERIALIZATION_FILES.has(basename)) {
      throw new Error(`Handoff cannot author materialization control ${path}.`);
    }
  }
  const verified = verifyModuleCommitHandoff(verificationRequest);
  if (
    verified.commit !== handoff.commit ||
    verified.taskId !== handoff.taskId ||
    verified.attempt !== handoff.attempt ||
    verified.planDigest !== handoff.planDigest ||
    verified.baselineCommit !== handoff.baselineCommit
  ) {
    throw new Error(
      `Raw handoff commit is invalid for ${verification.expected.node.taskId}.`,
    );
  }
}

function applyAndValidateWave(application: ValidatedWaveApplication): string {
  const sourceExpectation: SourceSnapshotExpectation = {
    repositoryRoot: application.state.workspace.sourceRepositoryRoot,
    expected: application.provenance.sourceSnapshot,
  };
  const workspaceExpectation: SourceSnapshotExpectation = {
    repositoryRoot: application.state.workspace.worktreePath,
    expected: application.provenance.workspaceSnapshot,
  };
  assertSourceSnapshot(sourceExpectation);
  assertSourceSnapshot(workspaceExpectation);
  if (application.expectedHandoffs.length === 0) {
    assertSourceSnapshot(sourceExpectation);
    assertSourceSnapshot(workspaceExpectation);
    return application.state.headCommit;
  }
  const handoffs: TreeHandoff[] = application.expectedHandoffs.map(
    (expected) => ({
      taskId: expected.node.taskId,
      baselineCommit: expected.baselineCommit,
      commit: expected.submission.commit,
    }),
  );
  const applyRequest: ApplyModuleWaveTreeRequest = {
    workspace: application.state.workspace,
    currentHead: application.state.headCommit,
    handoffs,
  };
  const headCommit = applyModuleWaveTree(applyRequest);
  const refUpdate: IntegrationRefUpdate = {
    provenance: application.provenance,
    nextCommit: headCommit,
  };
  updateIntegrationRef(refUpdate);
  try {
    assertSourceSnapshot(sourceExpectation);
    assertSourceSnapshot(workspaceExpectation);
    return headCommit;
  } catch {
    rollbackIntegrationRef(refUpdate);
    throw new Error('Module delivery wave failed and was fully rolled back.');
  }
}

export function prepareModuleIntegration(
  request: PrepareModuleIntegrationRequest,
): ModuleIntegrationState {
  const inspection: AcceptedPlanInspection = {
    acceptedPlan: request.acceptedPlan,
  };
  assertAcceptedPlan(inspection);
  const before = captureSourceSnapshot(request.repositoryRoot);
  const prepareRequest: PrepareModuleWorktreeRequest = {
    repositoryRoot: request.repositoryRoot,
    workspaceRoot: request.workspaceRoot,
    planDigest: request.acceptedPlan.planDigest,
    taskId: INTEGRATION_TASK_ID,
    attempt: 1,
    baselineCommit: request.acceptedPlan.plan.sourceCommit,
  };
  const workspace = prepareModuleWorktree(prepareRequest);
  const sourceExpectation: SourceSnapshotExpectation = {
    repositoryRoot: request.repositoryRoot,
    expected: before,
  };
  const refIdentity: IntegrationRefIdentity = {
    workspace,
    planDigest: request.acceptedPlan.planDigest,
  };
  const ref = integrationRef(refIdentity);
  const createRefInvocation: ModuleGitInvocation = {
    cwd: workspace.sourceRepositoryRoot,
    args: [
      'update-ref',
      '--create-reflog',
      ref,
      request.acceptedPlan.plan.sourceCommit,
      ZERO_COMMIT,
    ],
  };
  let refCreated = false;
  try {
    assertSourceSnapshot(sourceExpectation);
    runModuleDeliveryGit(gitRequest(createRefInvocation));
    refCreated = true;
    const cleanupHandleValue: ModuleIntegrationCleanupHandle = {
      sessionId: `${request.acceptedPlan.planDigest}:${workspace.worktreeId}`,
    };
    const cleanupHandle = Object.freeze(cleanupHandleValue);
    const state: ModuleIntegrationState = {
      planDigest: request.acceptedPlan.planDigest,
      sourceCommit: request.acceptedPlan.plan.sourceCommit,
      topologicalOrder: request.acceptedPlan.topologicalOrder,
      waves: request.acceptedPlan.waves,
      completedWaveCount: 0,
      integratedTaskIds: [],
      headCommit: request.acceptedPlan.plan.sourceCommit,
      workspace,
      cleanupHandle,
    };
    const immutable = immutableState(state);
    const workspaceSnapshot = captureSourceSnapshot(workspace.worktreePath);
    const sessionRegistration = {
      cleanupHandle,
      workspace: immutable.workspace,
      integrationRef: ref,
      currentHead: immutable.headCommit,
    } as const;
    const session = createIntegrationSession(sessionRegistration);
    const registration = {
      state: immutable,
      sourceSnapshot: before,
      workspaceSnapshot,
      session,
    } as const;
    registerIntegrationState(registration);
    return immutable;
  } catch {
    let refDeleted = true;
    if (refCreated) {
      const deleteInvocation: ModuleGitInvocation = {
        cwd: workspace.sourceRepositoryRoot,
        args: ['update-ref', '-d', ref, request.acceptedPlan.plan.sourceCommit],
        allowFailure: true,
      };
      refDeleted =
        runModuleDeliveryGit(gitRequest(deleteInvocation)).exitCode === 0;
    }
    const cleanupRequest: CleanupModuleWorktreeRequest = { workspace };
    cleanupModuleWorktree(cleanupRequest);
    if (!refDeleted) {
      throw new Error(
        'Module integration preparation left a changed private ref.',
      );
    }
    throw new Error(
      'Module integration preparation failed and was cleaned up.',
    );
  }
}

export function integrateVerifiedModuleDeliveryWave(
  request: IntegrateVerifiedModuleDeliveryWaveRequest,
): ModuleIntegrationState {
  const inspection: AcceptedPlanInspection = {
    acceptedPlan: request.acceptedPlan,
    state: request.state,
  };
  const provenance = integrationProvenance(request.state);
  assertAcceptedPlan(inspection);
  const freshInspection: FreshIntegrationInspection = {
    state: request.state,
    provenance,
  };
  assertFreshIntegrationState(freshInspection);
  assertPersistedSnapshots(freshInspection);
  if (
    !Number.isSafeInteger(request.waveIndex) ||
    request.waveIndex !== request.state.completedWaveCount
  ) {
    throw new Error('Requested module delivery wave is stale or out of order.');
  }
  const wave = request.acceptedPlan.waves[request.waveIndex];
  if (!wave) throw new Error('Requested module delivery wave does not exist.');
  const collectionRequest: HandoffCollectionRequest = {
    acceptedPlan: request.acceptedPlan,
    state: request.state,
    wave,
    handoffs: request.handoffs,
  };
  const expectedHandoffs = collectExpectedHandoffs(collectionRequest);
  for (const expected of expectedHandoffs) {
    const verification: ExpectedHandoffVerification = {
      expected,
      acceptedPlan: request.acceptedPlan,
    };
    verifyExpectedHandoff(verification);
  }
  const application: ValidatedWaveApplication = {
    state: request.state,
    expectedHandoffs,
    provenance,
  };
  const headCommit = applyAndValidateWave(application);
  const integratedTaskIds = [...request.state.integratedTaskIds, ...wave];
  const state: ModuleIntegrationState = {
    ...request.state,
    completedWaveCount: request.waveIndex + 1,
    integratedTaskIds,
    headCommit,
  };
  const immutable = immutableState(state);
  provenance.session.currentHead = headCommit;
  const registration = {
    state: immutable,
    sourceSnapshot: provenance.sourceSnapshot,
    workspaceSnapshot: provenance.workspaceSnapshot,
    session: provenance.session,
  } as const;
  registerIntegrationState(registration);
  retireIntegrationState(request.state);
  return immutable;
}

export function cleanupModuleIntegration(
  request: CleanupModuleIntegrationRequest,
): CleanupModuleIntegrationResult {
  const session = integrationSession(request.cleanupHandle);
  if (session.cleaned) return { removed: false };
  const deleteInvocation: ModuleGitInvocation = {
    cwd: session.workspace.sourceRepositoryRoot,
    args: ['update-ref', '-d', session.integrationRef, session.currentHead],
  };
  runModuleDeliveryGit(gitRequest(deleteInvocation));
  const cleanupRequest: CleanupModuleWorktreeRequest = {
    workspace: session.workspace,
  };
  try {
    cleanupModuleWorktree(cleanupRequest);
  } catch {
    const restoreInvocation: ModuleGitInvocation = {
      cwd: session.workspace.sourceRepositoryRoot,
      args: [
        'update-ref',
        '--create-reflog',
        session.integrationRef,
        session.currentHead,
        ZERO_COMMIT,
      ],
    };
    runModuleDeliveryGit(gitRequest(restoreInvocation));
    throw new Error('Module integration cleanup failed and restored its ref.');
  }
  session.cleaned = true;
  return { removed: true };
}
