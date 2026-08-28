import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, renameSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryJoinKind,
  MODULE_DELIVERY_INTEGRATION_INACTIVE_MESSAGE,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  cleanupModuleIntegration,
  cleanupModuleWorktree,
  decodeAndValidateModuleDeliveryPlan,
  integrateVerifiedModuleDeliveryWave,
  prepareModuleIntegration,
  prepareModuleWorktree,
} from '../../src/module-delivery/index.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
  writeFixtureFile,
  worktreeFileWriter,
  worktreeGit,
} from './worktree-test-support.ts';

import type {
  ValidatedModuleDeliveryPlan,
  CleanupModuleWorktreeRequest,
  CleanupModuleIntegrationRequest,
  IntegrateVerifiedModuleDeliveryWaveRequest,
  ModuleDeliveryBaseline,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryHandoffSubmission,
  ModuleDeliveryNode,
  LegacyModuleDeliveryPlan,
  ModuleIntegrationState,
  ModuleWorktreeHandle,
  PrepareModuleIntegrationRequest,
  PrepareModuleWorktreeRequest,
  ReadOnlyModuleDeliveryNode,
  WriteModuleDeliveryNode,
} from '../../src/module-delivery/index.ts';
import type { GitFixture } from './worktree-test-support.ts';

const CORE_ROOT = 'nook-app/nook-platform/nook-core';
const PARENT_RESOURCES: readonly string[] = [
  ...REQUIRED_PARENT_OWNED_RESOURCES,
];

type WriteNodeInput = {
  readonly taskId: string;
  readonly sourceCommit: string;
  readonly dependencies: readonly string[];
  readonly writeClaims: readonly string[];
  readonly readClaims: readonly string[];
};

type ReadOnlyNodeInput = {
  readonly taskId: string;
  readonly sourceCommit: string;
};

type PlanInput = {
  readonly sourceCommit: string;
  readonly nodes: readonly ModuleDeliveryNode[];
  readonly edges: readonly ModuleDeliveryEdgeContract[];
};

type SkippedLegacyIntegrationPlanFixture = Omit<
  LegacyModuleDeliveryPlan,
  'nodes'
> & {
  readonly nodes: readonly ModuleDeliveryNode[];
};

type EdgeInput = {
  readonly providerTaskId: string;
  readonly consumerTaskId: string;
};

type WriterPreparation = {
  readonly fixture: GitFixture;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly node: WriteModuleDeliveryNode;
  readonly baselineCommit: string;
  readonly attempt?: number;
};

type WriterCommit = {
  readonly workspace: ModuleWorktreeHandle;
  readonly relativePath: string;
  readonly contents: string;
};

type WaveIntegration = {
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly state: ModuleIntegrationState;
  readonly handoffs: readonly ModuleDeliveryHandoffSubmission[];
};

type IndependentWriterInput = {
  readonly taskId: string;
  readonly sourceCommit: string;
  readonly writeClaim: string;
};

enum FixtureLifecycleKind {
  Empty = 'empty',
  Active = 'active',
}

type FixtureLifecycle =
  | { readonly kind: FixtureLifecycleKind.Empty }
  | {
      readonly kind: FixtureLifecycleKind.Active;
      readonly fixture: GitFixture;
    };

let fixtureLifecycle: FixtureLifecycle = { kind: FixtureLifecycleKind.Empty };
const fixtures: GitFixture[] = [];
const workspaces: ModuleWorktreeHandle[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0).reverse()) {
    const request: CleanupModuleWorktreeRequest = { workspace };
    try {
      cleanupModuleWorktree(request);
    } catch {
      // A rejection case may intentionally leave an invalid worktree.
    }
  }
  for (const trackedFixture of fixtures.splice(0).reverse()) {
    disposeGitFixture(trackedFixture);
  }
  fixtureLifecycle = { kind: FixtureLifecycleKind.Empty };
});

function createTrackedFixture(): GitFixture {
  const trackedFixture = createGitFixture();
  fixtures.push(trackedFixture);
  fixtureLifecycle = {
    kind: FixtureLifecycleKind.Active,
    fixture: trackedFixture,
  };
  return trackedFixture;
}

function currentFixture(): GitFixture {
  if (fixtureLifecycle.kind === FixtureLifecycleKind.Empty) {
    throw new Error('Fixture lifecycle is empty.');
  }
  return fixtureLifecycle.fixture;
}

function baseline(input: WriteNodeInput): ModuleDeliveryBaseline {
  return input.dependencies.length === 0
    ? {
        kind: ModuleDeliveryBaselineKind.SourceCommit,
        sourceCommit: input.sourceCommit,
      }
    : {
        kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
        providerTaskIds: input.dependencies,
      };
}

function writeNode(input: WriteNodeInput): WriteModuleDeliveryNode {
  return {
    kind: ModuleDeliveryTaskKind.Write,
    taskId: input.taskId,
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    consumerOutcome: `${input.taskId} publishes a tested capability.`,
    baseline: baseline(input),
    agentDepthLimit: 2,
    dependencies: input.dependencies,
    resources: { read: input.readClaims, write: input.writeClaims },
    parentOwnedExclusions: PARENT_RESOURCES,
    acceptance: {
      commands: [`task ${input.taskId}:test`],
      evidence: [`${input.taskId} passed`],
    },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree,
      expectedCommitHandoff: true,
    },
  };
}

function readOnlyNode(input: ReadOnlyNodeInput): ReadOnlyModuleDeliveryNode {
  return {
    kind: ModuleDeliveryTaskKind.ReadOnly,
    taskId: input.taskId,
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    consumerOutcome: `${input.taskId} reports evidence.`,
    baseline: {
      kind: ModuleDeliveryBaselineKind.SourceCommit,
      sourceCommit: input.sourceCommit,
    },
    agentDepthLimit: 2,
    dependencies: [],
    resources: { read: [`${CORE_ROOT}/**`], write: [] },
    parentOwnedExclusions: PARENT_RESOURCES,
    acceptance: {
      commands: [`task ${input.taskId}:audit`],
      evidence: [`${input.taskId} completed`],
    },
  };
}

function edge(input: EdgeInput): ModuleDeliveryEdgeContract {
  return {
    providerTaskId: input.providerTaskId,
    consumerTaskId: input.consumerTaskId,
    capability: `${input.providerTaskId} capability`,
    publicTypes: [`${input.providerTaskId}Result`],
    errors: [`${input.providerTaskId}Error`],
    behaviorInvariants: ['The contract is deterministic.'],
    securityInvariants: ['The provider retains protected state.'],
    compatibilityExpectations: ['The consumer accepts the provider result.'],
    owningTests: [`${input.providerTaskId} contract test`],
  };
}

function acceptedPlan(input: PlanInput): ValidatedModuleDeliveryPlan {
  const plan: SkippedLegacyIntegrationPlanFixture = {
    version: 1,
    sourceCommit: input.sourceCommit,
    maxConcurrency: 3,
    maxAgentDepth: 3,
    maxAttempts: 2,
    parentOwnedResources: PARENT_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'delivery-owner',
      validationCommands: ['task integration:test'],
    },
    nodes: input.nodes,
    edgeContracts: input.edges,
  };
  const validation = decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan));
  if (validation.status !== ModuleDeliveryValidationStatus.Accepted) {
    throw new Error(JSON.stringify(validation.issues));
  }
  return validation;
}

function preparedIntegration(
  accepted: ValidatedModuleDeliveryPlan,
): ModuleIntegrationState {
  const fixture = currentFixture();
  const request: PrepareModuleIntegrationRequest = {
    repositoryRoot: fixture.sourceRoot,
    workspaceRoot: fixture.workspaceRoot,
    acceptedPlan: accepted,
  };
  const state = prepareModuleIntegration(request);
  workspaces.push(state.workspace);
  return state;
}

function preparedWriter(preparation: WriterPreparation): ModuleWorktreeHandle {
  const request: PrepareModuleWorktreeRequest = {
    repositoryRoot: preparation.fixture.sourceRoot,
    workspaceRoot: preparation.fixture.workspaceRoot,
    planDigest: preparation.acceptedPlan.planDigest,
    taskId: preparation.node.taskId,
    attempt: preparation.attempt ?? 1,
    baselineCommit: preparation.baselineCommit,
  };
  const workspace = prepareModuleWorktree(request);
  workspaces.push(workspace);
  return workspace;
}

function commitWriter(commit: WriterCommit): ModuleDeliveryHandoffSubmission {
  const write = worktreeFileWriter(commit.workspace);
  write([commit.relativePath, commit.contents]);
  const git = worktreeGit(commit.workspace);
  git(['add', '--all']);
  git(['commit', '--quiet', '-m', `write ${commit.relativePath}`]);
  return {
    taskId: commit.workspace.taskId,
    attempt: commit.workspace.attempt,
    planDigest: commit.workspace.planDigest,
    baselineCommit: commit.workspace.baselineCommit,
    commit: git(['rev-parse', 'HEAD']),
    workspace: commit.workspace,
  };
}

function integrateWave(integration: WaveIntegration): ModuleIntegrationState {
  const request: IntegrateVerifiedModuleDeliveryWaveRequest = {
    acceptedPlan: integration.acceptedPlan,
    state: integration.state,
    waveIndex: integration.state.completedWaveCount,
    handoffs: integration.handoffs,
  };
  return integrateVerifiedModuleDeliveryWave(request);
}

function independentWriter(
  input: IndependentWriterInput,
): WriteModuleDeliveryNode {
  const writeInput: WriteNodeInput = {
    taskId: input.taskId,
    sourceCommit: input.sourceCommit,
    dependencies: [],
    readClaims: [input.writeClaim],
    writeClaims: [input.writeClaim],
  };
  return writeNode(writeInput);
}

test('module delivery preparation is gated before request inspection', () => {
  const incompleteRequest = {};
  const request = Object.freeze(
    incompleteRequest,
  ) as PrepareModuleIntegrationRequest;
  expect(() => prepareModuleIntegration(request)).toThrow(
    MODULE_DELIVERY_INTEGRATION_INACTIVE_MESSAGE,
  );
});

describe.skip('module delivery wave integration pending admission', () => {
  test('integrates a complete wave in accepted topology order without touching source', () => {
    const fixture = createTrackedFixture();
    const alphaClaim = `${CORE_ROOT}/alpha/**`;
    const betaClaim = `${CORE_ROOT}/beta/**`;
    const alphaInput: IndependentWriterInput = {
      taskId: 'alpha-provider',
      sourceCommit: fixture.baselineCommit,
      writeClaim: alphaClaim,
    };
    const alpha = independentWriter(alphaInput);
    const betaInput: IndependentWriterInput = {
      taskId: 'beta-provider',
      sourceCommit: fixture.baselineCommit,
      writeClaim: betaClaim,
    };
    const beta = independentWriter(betaInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [beta, alpha],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    const sourceGit = fixtureGit(fixture);
    const sourceHead = sourceGit(['rev-parse', 'HEAD']);
    const state = preparedIntegration(accepted);
    const repeatedState = preparedIntegration(accepted);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.workspace)).toBe(true);

    const alphaPreparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: alpha,
      baselineCommit: fixture.baselineCommit,
    };
    const alphaWorkspace = preparedWriter(alphaPreparation);
    const betaPreparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: beta,
      baselineCommit: fixture.baselineCommit,
    };
    const betaWorkspace = preparedWriter(betaPreparation);
    const alphaCommit: WriterCommit = {
      workspace: alphaWorkspace,
      relativePath: `${CORE_ROOT}/alpha/value.ts`,
      contents: 'alpha\n',
    };
    const betaCommit: WriterCommit = {
      workspace: betaWorkspace,
      relativePath: `${CORE_ROOT}/beta/value.ts`,
      contents: 'beta\n',
    };
    const alphaHandoff = commitWriter(alphaCommit);
    const betaHandoff = commitWriter(betaCommit);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [betaHandoff, alphaHandoff],
    };
    const advanced = integrateWave(integration);
    const repeatedIntegration: WaveIntegration = {
      acceptedPlan: accepted,
      state: repeatedState,
      handoffs: [alphaHandoff, betaHandoff],
    };
    const repeated = integrateWave(repeatedIntegration);

    expect(advanced.completedWaveCount).toBe(1);
    expect(advanced.integratedTaskIds).toEqual([
      'alpha-provider',
      'beta-provider',
    ]);
    expect(advanced.headCommit).not.toBe(state.headCommit);
    expect(repeated.headCommit).toBe(advanced.headCommit);
    expect(
      sourceGit(['show', `${advanced.headCommit}:${alphaCommit.relativePath}`]),
    ).toBe('alpha');
    expect(
      sourceGit(['show', `${advanced.headCommit}:${betaCommit.relativePath}`]),
    ).toBe('beta');
    expect(sourceGit(['rev-parse', 'HEAD'])).toBe(sourceHead);
    expect(sourceGit(['status', '--porcelain=v1'])).toBe('');

    expect(() => integrateWave(integration)).toThrow('stale');
  });

  test('advances a read-only wave without creating a commit', () => {
    const fixture = createTrackedFixture();
    const readInput: ReadOnlyNodeInput = {
      taskId: 'core-audit',
      sourceCommit: fixture.baselineCommit,
    };
    const audit = readOnlyNode(readInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [audit],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    const state = preparedIntegration(accepted);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    const advanced = integrateWave(integration);
    expect(advanced.completedWaveCount).toBe(1);
    expect(advanced.headCommit).toBe(state.headCommit);
    expect(advanced.integratedTaskIds).toEqual(['core-audit']);
    expect(() => integrateWave(integration)).toThrow('stale');
  });

  test('binds a dependent writer to the exact integrated frontier', () => {
    const fixture = createTrackedFixture();
    const providerClaim = `${CORE_ROOT}/provider/**`;
    const consumerClaim = `${CORE_ROOT}/consumer/**`;
    const providerInput: IndependentWriterInput = {
      taskId: 'core-provider',
      sourceCommit: fixture.baselineCommit,
      writeClaim: providerClaim,
    };
    const provider = independentWriter(providerInput);
    const consumerInput: WriteNodeInput = {
      taskId: 'core-consumer',
      sourceCommit: fixture.baselineCommit,
      dependencies: ['core-provider'],
      readClaims: [providerClaim],
      writeClaims: [consumerClaim],
    };
    const consumer = writeNode(consumerInput);
    const edgeInput: EdgeInput = {
      providerTaskId: provider.taskId,
      consumerTaskId: consumer.taskId,
    };
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [consumer, provider],
      edges: [edge(edgeInput)],
    };
    const accepted = acceptedPlan(planInput);
    const state = preparedIntegration(accepted);
    const providerPreparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: provider,
      baselineCommit: state.headCommit,
    };
    const providerWorkspace = preparedWriter(providerPreparation);
    const providerCommit: WriterCommit = {
      workspace: providerWorkspace,
      relativePath: `${CORE_ROOT}/provider/value.ts`,
      contents: 'provider\n',
    };
    const providerHandoff = commitWriter(providerCommit);
    const firstIntegration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [providerHandoff],
    };
    const providerState = integrateWave(firstIntegration);

    const consumerPreparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: consumer,
      baselineCommit: providerState.headCommit,
    };
    const consumerWorkspace = preparedWriter(consumerPreparation);
    const consumerCommit: WriterCommit = {
      workspace: consumerWorkspace,
      relativePath: `${CORE_ROOT}/consumer/value.ts`,
      contents: 'consumer\n',
    };
    const consumerHandoff = commitWriter(consumerCommit);
    const secondIntegration: WaveIntegration = {
      acceptedPlan: accepted,
      state: providerState,
      handoffs: [consumerHandoff],
    };
    const completed = integrateWave(secondIntegration);
    expect(completed.completedWaveCount).toBe(2);
    expect(completed.integratedTaskIds).toEqual([
      'core-provider',
      'core-consumer',
    ]);
  });

  test('rejects incomplete and forged handoff sets before mutation', () => {
    const fixture = createTrackedFixture();
    const claim = `${CORE_ROOT}/feature/**`;
    const writerInput: IndependentWriterInput = {
      taskId: 'core-provider',
      sourceCommit: fixture.baselineCommit,
      writeClaim: claim,
    };
    const writer = independentWriter(writerInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [writer],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    const state = preparedIntegration(accepted);
    const missing: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    expect(() => integrateWave(missing)).toThrow('exactly equal');
    expect(worktreeGit(state.workspace)(['rev-parse', 'HEAD'])).toBe(
      state.headCommit,
    );

    const tamperedState: ModuleIntegrationState = {
      ...state,
      completedWaveCount: 1,
      integratedTaskIds: [],
    };
    const tamperedIntegration: WaveIntegration = {
      acceptedPlan: accepted,
      state: tamperedState,
      handoffs: [],
    };
    expect(() => integrateWave(tamperedIntegration)).toThrow(
      'private provenance',
    );

    const preparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: writer,
      baselineCommit: state.headCommit,
    };
    const writerWorkspace = preparedWriter(preparation);
    const commit: WriterCommit = {
      workspace: writerWorkspace,
      relativePath: `${CORE_ROOT}/feature/value.ts`,
      contents: 'value\n',
    };
    const valid = commitWriter(commit);
    const forged: ModuleDeliveryHandoffSubmission = {
      ...valid,
      commit: fixture.baselineCommit,
    };
    const forgedIntegration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [forged],
    };
    expect(() => integrateWave(forgedIntegration)).toThrow('Raw handoff');
    expect(worktreeGit(state.workspace)(['rev-parse', 'HEAD'])).toBe(
      state.headCommit,
    );
  });

  test('rejects worker filter controls without executing the configured canary', () => {
    const fixture = createTrackedFixture();
    const marker = join(fixture.root, 'filter-canary');
    const sourceGit = fixtureGit(fixture);
    sourceGit(['config', 'filter.fail.smudge', `touch ${marker}; cat`]);
    sourceGit(['config', 'filter.fail.required', 'true']);
    const attributesPath = `${CORE_ROOT}/.gitattributes`;
    const attributesInput: IndependentWriterInput = {
      taskId: 'attributes-writer',
      sourceCommit: fixture.baselineCommit,
      writeClaim: attributesPath,
    };
    const attributesWriter = independentWriter(attributesInput);
    const valuePath = `${CORE_ROOT}/value.ts`;
    const valueInput: IndependentWriterInput = {
      taskId: 'value-writer',
      sourceCommit: fixture.baselineCommit,
      writeClaim: valuePath,
    };
    const valueWriter = independentWriter(valueInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [valueWriter, attributesWriter],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    const state = preparedIntegration(accepted);
    const attributesPreparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: attributesWriter,
      baselineCommit: state.headCommit,
    };
    const valuePreparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: valueWriter,
      baselineCommit: state.headCommit,
    };
    const attributesWorkspace = preparedWriter(attributesPreparation);
    const valueWorkspace = preparedWriter(valuePreparation);
    const attributesCommit: WriterCommit = {
      workspace: attributesWorkspace,
      relativePath: attributesPath,
      contents: '*.ts filter=fail\n',
    };
    const valueCommit: WriterCommit = {
      workspace: valueWorkspace,
      relativePath: valuePath,
      contents: 'value\n',
    };
    const attributesHandoff = commitWriter(attributesCommit);
    const valueHandoff = commitWriter(valueCommit);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [valueHandoff, attributesHandoff],
    };
    expect(() => integrateWave(integration)).toThrow('materialization control');
    expect(worktreeGit(state.workspace)(['rev-parse', 'HEAD'])).toBe(
      state.headCommit,
    );
    expect(worktreeGit(state.workspace)(['status', '--porcelain=v1'])).toBe('');
    expect(existsSync(join(state.workspace.worktreePath, attributesPath))).toBe(
      false,
    );
    expect(existsSync(join(state.workspace.worktreePath, valuePath))).toBe(
      false,
    );
    expect(existsSync(marker)).toBe(false);
  });

  test('rejects source byte, ref, and config drift after preparation', () => {
    const fixture = createTrackedFixture();
    const readInput: ReadOnlyNodeInput = {
      taskId: 'core-audit',
      sourceCommit: fixture.baselineCommit,
    };
    const audit = readOnlyNode(readInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [audit],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    const state = preparedIntegration(accepted);
    const sourceWrite = {
      fixture,
      relativePath: 'module/seed.txt',
      contents: 'mutated source bytes\n',
    } as const;
    writeFixtureFile(sourceWrite);
    const sourceGit = fixtureGit(fixture);
    sourceGit(['branch', 'source-drift', 'HEAD']);
    sourceGit(['config', 'nook.test-drift', 'true']);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    expect(() => integrateWave(integration)).toThrow(
      'Source repository changed',
    );
  });

  test('rejects drift in a custom ref outside the private integration namespace', () => {
    const fixture = createTrackedFixture();
    const readInput: ReadOnlyNodeInput = {
      taskId: 'core-audit',
      sourceCommit: fixture.baselineCommit,
    };
    const audit = readOnlyNode(readInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [audit],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    const state = preparedIntegration(accepted);
    fixtureGit(fixture)([
      'update-ref',
      'refs/custom/module-delivery-drift',
      'HEAD',
    ]);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    expect(() => integrateWave(integration)).toThrow(
      'Source repository changed',
    );
  });

  test('rejects a custom symbolic ref retargeted between equal commits', () => {
    const fixture = createTrackedFixture();
    const sourceGit = fixtureGit(fixture);
    sourceGit(['branch', 'symbolic-a', 'HEAD']);
    sourceGit(['branch', 'symbolic-b', 'HEAD']);
    sourceGit([
      'symbolic-ref',
      'refs/custom/module-pointer',
      'refs/heads/symbolic-a',
    ]);
    const readInput: ReadOnlyNodeInput = {
      taskId: 'core-audit',
      sourceCommit: fixture.baselineCommit,
    };
    const audit = readOnlyNode(readInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [audit],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    const state = preparedIntegration(accepted);
    sourceGit([
      'symbolic-ref',
      'refs/custom/module-pointer',
      'refs/heads/symbolic-b',
    ]);
    expect(sourceGit(['rev-parse', 'refs/heads/symbolic-a'])).toBe(
      sourceGit(['rev-parse', 'refs/heads/symbolic-b']),
    );
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    expect(() => integrateWave(integration)).toThrow(
      'Source repository changed',
    );
  });

  test('rejects source mode drift at a metadata-only checkpoint', () => {
    const fixture = createTrackedFixture();
    const readInput: ReadOnlyNodeInput = {
      taskId: 'core-audit',
      sourceCommit: fixture.baselineCommit,
    };
    const audit = readOnlyNode(readInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [audit],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    const state = preparedIntegration(accepted);
    chmodSync(join(fixture.sourceRoot, 'module/seed.txt'), 0o755);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    expect(() => integrateWave(integration)).toThrow(
      'Source repository changed',
    );
  });

  test('rejects an intermediate symlink before preparing integration', () => {
    const fixture = createTrackedFixture();
    const modulePath = join(fixture.sourceRoot, 'module');
    const realModulePath = join(fixture.sourceRoot, 'module-real');
    renameSync(modulePath, realModulePath);
    symlinkSync('module-real', modulePath);
    const readInput: ReadOnlyNodeInput = {
      taskId: 'core-audit',
      sourceCommit: fixture.baselineCommit,
    };
    const audit = readOnlyNode(readInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [audit],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    expect(() => preparedIntegration(accepted)).toThrow('symlink ancestor');
  });

  test('rejects an unauthorized integration-worktree commit', () => {
    const fixture = createTrackedFixture();
    const readInput: ReadOnlyNodeInput = {
      taskId: 'core-audit',
      sourceCommit: fixture.baselineCommit,
    };
    const audit = readOnlyNode(readInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [audit],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    const state = preparedIntegration(accepted);
    const sourceGit = fixtureGit(fixture);
    expect(
      sourceGit(['for-each-ref', '--format=%(refname)', 'refs/nook']),
    ).toContain('refs/nook/module-delivery/');

    const write = worktreeFileWriter(state.workspace);
    write(['module/unauthorized.txt', 'unauthorized\n']);
    const integrationGit = worktreeGit(state.workspace);
    integrationGit(['add', '--all']);
    integrationGit(['commit', '--quiet', '-m', 'unauthorized']);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    expect(() => integrateWave(integration)).toThrow('without authority');
  });

  test('cleans the latest session through the original stable handle exactly once', () => {
    const fixture = createTrackedFixture();
    const readInput: ReadOnlyNodeInput = {
      taskId: 'core-audit',
      sourceCommit: fixture.baselineCommit,
    };
    const audit = readOnlyNode(readInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [audit],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    const original = preparedIntegration(accepted);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state: original,
      handoffs: [],
    };
    integrateWave(integration);
    const sourceGit = fixtureGit(fixture);
    expect(
      sourceGit(['for-each-ref', '--format=%(refname)', 'refs/nook']),
    ).toContain('refs/nook/module-delivery/');

    const cleanupRequest: CleanupModuleIntegrationRequest = {
      cleanupHandle: original.cleanupHandle,
    };
    const removedResult = { removed: true } as const;
    const alreadyRemovedResult = { removed: false } as const;
    expect(cleanupModuleIntegration(cleanupRequest)).toEqual(removedResult);
    expect(cleanupModuleIntegration(cleanupRequest)).toEqual(
      alreadyRemovedResult,
    );
    expect(
      sourceGit(['for-each-ref', '--format=%(refname)', 'refs/nook']),
    ).toBe('');
  });
});
