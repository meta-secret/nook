import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'bun:test';
import {
  StructuralAssessmentKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  StructuralExpertAuthorizationKind,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import type {
  CodeRefactoringTaskOutput,
  StructuralChildLanePreauthorization,
  StructuralExpertAuthorization,
  StructuralExpertPlanTaskOutput,
  SystemCoherenceTaskOutput,
  TaskTerminal,
} from '../../src/agent-workflow/domain.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';
import { decodeWorkflowTaskOutput } from '../../src/agent-workflow/structured-result-codec.ts';
import {
  StructuralExpertKind,
  SYSTEM_COHERENCE_BEHAVIOR_CONTRACT,
} from '../../src/structural-experts/catalog.ts';
import { invokeStructuralExpert } from '../../src/structural-experts/invoke.ts';
import type { InvokeStructuralExpertRequest } from '../../src/structural-experts/invoke.ts';
import {
  consumeStructuralParentAuthorization,
  verifyStructuralParentAuthorization,
} from '../../src/structural-experts/parent-authorization.ts';
import type {
  ConsumeStructuralParentAuthorizationRequest,
  VerifyStructuralParentAuthorizationRequest,
} from '../../src/structural-experts/parent-authorization.ts';
import type {
  StructuralChildProjection,
  StructuralEvidenceInvocationRequest,
  StructuralExpertInvocationRequest,
  StructuralSynthesisInvocationRequest,
} from '../../src/structural-experts/request-codec.ts';
import { createCompletedAttempt } from '../module-experts/invoke-parent-fixture.ts';
import type { CreateCompletedAttemptArgs } from '../module-experts/invoke-parent-fixture.ts';
import { registerStructuralRuntimeMock } from './structural-runtime-mock.ts';
import type { RegisterStructuralRuntimeMockRequest } from './structural-runtime-mock.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const REMOVE_RECURSIVELY: RmOptions = { recursive: true, force: true };

class SuccessfulCodeRuntime implements AgentTaskRuntime<string, string> {
  async executeAgent(): Promise<AgentExecutionCompletion> {
    return { threadId: 'code-thread', output: codeEvidence() };
  }
}

class FailedCortexRuntime implements AgentTaskRuntime<string, string> {
  async executeAgent(
    invocation: AgentExecutionInvocation<string, string>,
  ): Promise<AgentExecutionCompletion> {
    void invocation;
    throw new Error('Raw runtime detail must not escape.');
  }
}

class RecordingSynthesisRuntime implements AgentTaskRuntime<string, string> {
  instruction = '';

  async executeAgent(
    invocation: AgentExecutionInvocation<string, string>,
  ): Promise<AgentExecutionCompletion> {
    this.instruction = invocation.execution.instruction;
    return { threadId: 'synthesis-thread', output: synthesisOutput() };
  }
}

test('binds and consumes an exact mixed all-terminal synthesis barrier', async () => {
  const runId = `structural-barrier-${randomUUID()}`;
  const runDirectory = processingRunDirectory(runId);
  const codeInput: EvidenceRequestInput = {
    runId,
    task: 'inspect-code',
    expert: 'code_refactoring_expert',
    evidencePaths: ['nook-app/nook-platform/nook-core'],
  };
  const codeRequest = evidenceRequest(codeInput);
  const cortexInput: EvidenceRequestInput = {
    runId,
    task: 'inspect-cortex',
    expert: 'cortex_refactoring_expert',
    evidencePaths: ['.cortex/teams/ai/architecture/refactoring-experts.md'],
  };
  const cortexRequest = evidenceRequest(cortexInput);
  try {
    const rootInput: RootPlanInput = {
      runId,
      codeRequest,
      cortexRequest,
      synthesisChildLanes: [childLane(codeRequest), childLane(cortexRequest)],
    };
    await createRootPlan(rootInput);
    const codeInvocation: InvokeWithRuntimeInput = {
      request: codeRequest,
      runtime: new SuccessfulCodeRuntime(),
    };
    await invokeWithRuntime(codeInvocation);
    const cortexInvocation: InvokeWithRuntimeInput = {
      request: cortexRequest,
      runtime: new FailedCortexRuntime(),
    };
    await invokeWithRuntime(cortexInvocation);
    const projections = expectedProjections();
    const synthesisInput: SynthesisInvocationInput = {
      runId,
      childProjections: projections,
    };
    const synthesisRequest = synthesisInvocation(synthesisInput);
    const verificationRequest: VerifyStructuralParentAuthorizationRequest = {
      request: synthesisRequest,
      runDirectory,
    };
    const authorization =
      await verifyStructuralParentAuthorization(verificationRequest);
    const consumeRequest: ConsumeStructuralParentAuthorizationRequest = {
      ...verificationRequest,
      authorization,
    };
    const contexts = consumeStructuralParentAuthorization(consumeRequest);
    expect(contexts.map((context) => context.terminalKind)).toEqual([
      TaskTerminalKind.Completed,
      TaskTerminalKind.Failed,
    ]);
    expect(contexts[0]?.resultJson).toContain('code-refactoring-evidence');
    expect(contexts[1]?.resultJson).toContain(
      'Structural expert runtime failed.',
    );
    expect(contexts[1]?.viewMarkdown).toContain('Agent attempt failure view');
    const first = projections[0];
    const second = projections[1];
    if (!first || !second) throw new Error('Barrier projections are missing.');
    const reboundInput: SynthesisInvocationInput = {
      runId,
      childProjections: [{ ...first, resultSha256: 'e'.repeat(64) }, second],
    };
    const reboundRequest = synthesisInvocation(reboundInput);
    const reboundVerification: VerifyStructuralParentAuthorizationRequest = {
      request: reboundRequest,
      runDirectory,
    };
    await expect(
      verifyStructuralParentAuthorization(reboundVerification),
    ).rejects.toThrow('parent authorization failed');
    const synthesisRuntime = new RecordingSynthesisRuntime();
    const synthesisInvocationInput: InvokeWithRuntimeInput = {
      request: synthesisRequest,
      runtime: synthesisRuntime,
    };
    await invokeWithRuntime(synthesisInvocationInput);
    expect(synthesisRuntime.instruction).toContain(
      SYSTEM_COHERENCE_BEHAVIOR_CONTRACT,
    );
    expect(synthesisRuntime.instruction).toContain(
      'Context contains verified child result.json and view.md projections only.',
    );
  } finally {
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

test('rejects omitted, extra, reordered, or unrelated synthesis lanes', async () => {
  const runId = `structural-barrier-reject-${randomUUID()}`;
  const runDirectory = processingRunDirectory(runId);
  const codeInput: EvidenceRequestInput = {
    runId,
    task: 'inspect-code',
    expert: 'code_refactoring_expert',
    evidencePaths: ['nook-app/nook-platform/nook-core'],
  };
  const codeRequest = evidenceRequest(codeInput);
  const cortexInput: EvidenceRequestInput = {
    runId,
    task: 'inspect-cortex',
    expert: 'cortex_refactoring_expert',
    evidencePaths: ['.cortex/teams/ai/architecture/refactoring-experts.md'],
  };
  const cortexRequest = evidenceRequest(cortexInput);
  const projections = expectedProjections();
  const thirdInput: ChildProjectionInput = {
    task: 'inspect-design',
    expert: 'code_refactoring_expert',
    resultSha256: 'c'.repeat(64),
    viewSha256: 'c'.repeat(64),
  };
  const plannedProjections = [...projections, childProjection(thirdInput)];
  try {
    const rootInput: RootPlanInput = {
      runId,
      codeRequest,
      cortexRequest,
      synthesisChildLanes: plannedProjections.map(projectionLane),
    };
    await createRootPlan(rootInput);
    const first = projections[0];
    const second = projections[1];
    if (!first || !second) throw new Error('Barrier projections are missing.');
    const unrelated = { ...second, expert: 'core_expert' };
    const unrelatedInput: ChildProjectionInput = {
      task: 'unrelated',
      expert: 'core_expert',
      resultSha256: 'd'.repeat(64),
      viewSha256: 'd'.repeat(64),
    };
    const variants = [
      projections,
      [...plannedProjections].reverse(),
      [first, unrelated],
      [...plannedProjections, childProjection(unrelatedInput)],
    ];
    for (const childProjections of variants) {
      const variantInput: SynthesisInvocationInput = {
        runId,
        childProjections,
      };
      const request = synthesisInvocation(variantInput);
      const verificationRequest: VerifyStructuralParentAuthorizationRequest = {
        request,
        runDirectory,
      };
      await expect(
        verifyStructuralParentAuthorization(verificationRequest),
      ).rejects.toThrow('parent authorization failed');
    }
  } finally {
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

type EvidenceRequestInput = {
  readonly runId: string;
  readonly task: string;
  readonly expert: string;
  readonly evidencePaths: readonly string[];
};

function evidenceRequest(
  input: EvidenceRequestInput,
): StructuralEvidenceInvocationRequest {
  return {
    kind: StructuralExpertKind.RepositoryEvidence,
    runId: input.runId,
    expert: input.expert,
    sourceCommit: SOURCE_COMMIT,
    task: input.task,
    attempt: 1,
    depth: 2,
    parent: parentIdentity(),
    instruction: 'Inspect the exact bounded surface.',
    evidencePaths: input.evidencePaths,
  };
}

type SynthesisInvocationInput = {
  readonly runId: string;
  readonly childProjections: readonly StructuralChildProjection[];
};

function synthesisInvocation(
  input: SynthesisInvocationInput,
): StructuralSynthesisInvocationRequest {
  return {
    kind: StructuralExpertKind.VerifiedViewSynthesis,
    runId: input.runId,
    expert: 'system_coherence_synthesizer',
    sourceCommit: SOURCE_COMMIT,
    task: 'synthesize-refactoring',
    attempt: 1,
    depth: 2,
    parent: parentIdentity(),
    instruction: 'Reconcile the exact all-terminal barrier.',
    childProjections: input.childProjections,
  };
}

function parentIdentity() {
  return {
    kind: AgentAttemptParentKind.AgentAttempt,
    task: 'plan-refactoring',
    agent: 'delivery-owner',
    attempt: 1,
  } as const;
}

function expectedProjections(): readonly StructuralChildProjection[] {
  const decodedCodeEvidence = decodeWorkflowTaskOutput(
    JSON.stringify(codeEvidence()),
  );
  const codeTerminal: TaskTerminal<string> = {
    kind: TaskTerminalKind.Completed,
    task: 'inspect-code',
    attempt: 1,
    threadId: 'code-thread',
    output: decodedCodeEvidence,
  };
  const failedTerminal: TaskTerminal<string> = {
    kind: TaskTerminalKind.Failed,
    task: 'inspect-cortex',
    attempt: 1,
    summary: 'Structural expert runtime failed.',
  };
  const codeInput: ChildProjectionInput = {
    task: 'inspect-code',
    expert: 'code_refactoring_expert',
    resultSha256: hash(`${JSON.stringify(codeTerminal)}\n`),
    viewSha256: hash(`${codeEvidence().materializedViewMarkdown}\n`),
  };
  const cortexInput: ChildProjectionInput = {
    task: 'inspect-cortex',
    expert: 'cortex_refactoring_expert',
    resultSha256: hash(`${JSON.stringify(failedTerminal)}\n`),
    viewSha256: hash(failedView()),
  };
  return [childProjection(codeInput), childProjection(cortexInput)];
}

type ChildProjectionInput = {
  readonly task: string;
  readonly expert: string;
  readonly resultSha256: string;
  readonly viewSha256: string;
};

function childProjection(
  input: ChildProjectionInput,
): StructuralChildProjection {
  return {
    task: input.task,
    expert: input.expert,
    attempt: 1,
    resultPath: `agents/${input.task}/attempt-1/result.json`,
    resultSha256: input.resultSha256,
    viewPath: `agents/${input.task}/attempt-1/view.md`,
    viewSha256: input.viewSha256,
  };
}

type RootPlanInput = {
  readonly runId: string;
  readonly codeRequest: StructuralEvidenceInvocationRequest;
  readonly cortexRequest: StructuralEvidenceInvocationRequest;
  readonly synthesisChildLanes: readonly StructuralChildLanePreauthorization[];
};

async function createRootPlan(input: RootPlanInput): Promise<void> {
  const authorizations: StructuralExpertAuthorization[] = [
    evidenceAuthorization(input.codeRequest),
    evidenceAuthorization(input.cortexRequest),
    {
      task: 'synthesize-refactoring',
      expert: 'system_coherence_synthesizer',
      attempt: 1,
      depth: 2,
      parent: parentIdentity(),
      kind: StructuralExpertAuthorizationKind.VerifiedViewSynthesis,
      childLanes: input.synthesisChildLanes,
    },
  ];
  const output: StructuralExpertPlanTaskOutput = {
    resultKind: WorkflowResultKind.StructuralExpertPlan,
    summary: 'Exact all-terminal barrier frozen.',
    materializedViewMarkdown: '# Structural plan\n\nBarrier frozen.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    structuralExpertAuthorizations: authorizations,
  };
  const parentRequest: CreateCompletedAttemptArgs = {
    repoRoot: REPO_ROOT,
    runId: input.runId,
    sourceCommit: SOURCE_COMMIT,
    task: 'plan-refactoring',
    agent: 'delivery-owner',
    attempt: 1,
    depth: 1,
    parent: { kind: AgentAttemptParentKind.WorkflowRoot },
    output,
  };
  await createCompletedAttempt(parentRequest);
}

function childLane(
  request: StructuralEvidenceInvocationRequest,
): StructuralChildLanePreauthorization {
  return {
    task: request.task,
    expert: request.expert,
    attempt: request.attempt,
  };
}

function projectionLane(
  projection: StructuralChildProjection,
): StructuralChildLanePreauthorization {
  return {
    task: projection.task,
    expert: projection.expert,
    attempt: projection.attempt,
  };
}

function evidenceAuthorization(
  request: StructuralEvidenceInvocationRequest,
): StructuralExpertAuthorization {
  return {
    task: request.task,
    expert: request.expert,
    attempt: request.attempt,
    depth: 2,
    parent: request.parent,
    kind: StructuralExpertAuthorizationKind.RepositoryEvidence,
    evidencePaths: request.evidencePaths,
  };
}

type InvokeWithRuntimeInput = {
  readonly request: StructuralExpertInvocationRequest;
  readonly runtime: AgentTaskRuntime<string, string>;
};
async function invokeWithRuntime(input: InvokeWithRuntimeInput): Promise<void> {
  const registrationRequest: RegisterStructuralRuntimeMockRequest = {
    runId: input.request.runId,
    runtime: input.runtime,
  };
  const registration = registerStructuralRuntimeMock(registrationRequest);
  try {
    const invocationRequest: InvokeStructuralExpertRequest = {
      repoRoot: REPO_ROOT,
      request: input.request,
      signal: new AbortController().signal,
    };
    await invokeStructuralExpert(invocationRequest);
  } finally {
    registration.dispose();
  }
}

function codeEvidence(): CodeRefactoringTaskOutput {
  const entry = ['Evidence recorded.'];
  return {
    resultKind: WorkflowResultKind.CodeRefactoringEvidence,
    summary: 'Code inspected.',
    materializedViewMarkdown: '# Code evidence\n\nInspected.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    continuation: {
      scopeModules: entry,
      acceptedExternalContracts: entry,
      preservedBehaviorInvariants: entry,
      preservedSecurityInvariants: entry,
      architectureFindings: noFindings(),
      designFindings: noFindings(),
      codeQualityFindings: noFindings(),
      typeSafetyFindings: noFindings(),
      testFindings: noFindings(),
      dependencyDirectionFindings: noFindings(),
      proposedSlices: entry,
      focusedValidation: entry,
      risks: entry,
      unresolvedDecisions: entry,
      parentActions: entry,
    },
  };
}

function synthesisOutput(): SystemCoherenceTaskOutput {
  const entry = ['Verified evidence reconciled.'];
  return {
    resultKind: WorkflowResultKind.SystemCoherenceSynthesis,
    summary: 'System coherence synthesized.',
    materializedViewMarkdown: '# System coherence\n\nSynthesized.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    continuation: {
      consumedArtifacts: entry,
      coverageGaps: entry,
      crossSurfaceInvariants: entry,
      contradictions: entry,
      acceptedProposals: entry,
      rejectedProposals: entry,
      orderedSlices: entry,
      serializationPoints: entry,
      validationMatrix: entry,
      unresolvedDecisions: entry,
      deliveryOwnerActions: entry,
    },
  };
}

function failedView(): string {
  return '# Agent attempt failure view\n\nStatus: failed\n\nThis view was produced by Loom because the agent did not complete an authored semantic view.\n\nNormalized outcome: Structural expert runtime failed.\n';
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function processingRunDirectory(runId: string): string {
  return join(
    REPO_ROOT,
    'workflow',
    'processing',
    DelegatedAgentWorkflowName.AgentWork,
    runId,
  );
}
function noFindings() {
  return {
    kind: StructuralAssessmentKind.None,
    reason: 'The bounded assessment found no issue in this category.',
  } as const;
}
