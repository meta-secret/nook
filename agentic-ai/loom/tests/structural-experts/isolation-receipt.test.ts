import { expect, test } from 'bun:test';
import {
  StructuralAssessmentKind,
  AgentReasoningEffort,
  AgentWorkspacePolicy,
  WorkflowExecutorKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import type { CodeRefactoringTaskOutput } from '../../src/agent-workflow/domain.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';
import type { ReadOnlyExpertRuntimeIsolationRequest } from '../../src/module-experts/runtime-contract.ts';
import {
  consumeIsolatedStructuralExpertExecution,
  executeIsolatedStructuralExpert,
} from '../../src/structural-experts/isolation-receipt.ts';
import type {
  ConsumeIsolatedStructuralExpertExecutionRequest,
  IsolatedStructuralExpertExecution,
  StructuralExpertIsolationReceipt,
} from '../../src/structural-experts/isolation-receipt.ts';
import { registerStructuralRuntimeMock } from './structural-runtime-mock.ts';
import type { RegisterStructuralRuntimeMockRequest } from './structural-runtime-mock.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

class ReceiptRuntime implements AgentTaskRuntime<string, string> {
  async executeAgent(): Promise<AgentExecutionCompletion> {
    return { threadId: 'receipt-thread', output: codeEvidence() };
  }
}

test('binds one structural isolation receipt to exact execution inputs', async () => {
  const invocation = structuralInvocation();
  const isolationRequest = structuralIsolationRequest();
  const registrationRequest: RegisterStructuralRuntimeMockRequest = {
    runId: invocation.runId,
    runtime: new ReceiptRuntime(),
  };
  const registration = registerStructuralRuntimeMock(registrationRequest);
  try {
    const executionRequest = {
      invocation,
      isolationRequest,
    };
    const execution = await executeIsolatedStructuralExpert(executionRequest);
    const reboundCompletion: IsolatedStructuralExpertExecution = {
      ...execution,
      completion: { ...execution.completion, threadId: 'rebound-thread' },
    };
    const reboundCompletionRequest: ConsumeIsolatedStructuralExpertExecutionRequest<
      string,
      string
    > = { execution: reboundCompletion, invocation, isolationRequest };
    expect(() =>
      consumeIsolatedStructuralExpertExecution(reboundCompletionRequest),
    ).toThrow('isolation receipt is invalid');
    const reboundInvocation: AgentExecutionInvocation<string, string> = {
      ...invocation,
      task: 'rebound-task',
    };
    const reboundInvocationRequest: ConsumeIsolatedStructuralExpertExecutionRequest<
      string,
      string
    > = { execution, invocation: reboundInvocation, isolationRequest };
    expect(() =>
      consumeIsolatedStructuralExpertExecution(reboundInvocationRequest),
    ).toThrow('isolation receipt is invalid');
    const reboundIsolation: ReadOnlyExpertRuntimeIsolationRequest = {
      ...isolationRequest,
      snapshot: { ...isolationRequest.snapshot, scopePaths: ['.cortex'] },
    };
    const reboundIsolationRequest: ConsumeIsolatedStructuralExpertExecutionRequest<
      string,
      string
    > = { execution, invocation, isolationRequest: reboundIsolation };
    expect(() =>
      consumeIsolatedStructuralExpertExecution(reboundIsolationRequest),
    ).toThrow('isolation receipt is invalid');
    const consumeRequest: ConsumeIsolatedStructuralExpertExecutionRequest<
      string,
      string
    > = { execution, invocation, isolationRequest };
    consumeIsolatedStructuralExpertExecution(consumeRequest);
    expect(() =>
      consumeIsolatedStructuralExpertExecution(consumeRequest),
    ).toThrow('isolation receipt is invalid');
  } finally {
    registration.dispose();
  }
});

test('rejects a structurally forged structural isolation receipt', () => {
  const invocation = structuralInvocation();
  const isolationRequest = structuralIsolationRequest();
  const receipt = {
    kind: 'structural-expert-isolation-receipt',
  } as StructuralExpertIsolationReceipt;
  const execution: IsolatedStructuralExpertExecution = {
    completion: { threadId: 'forged-thread', output: codeEvidence() },
    receipt,
  };
  const consumeRequest: ConsumeIsolatedStructuralExpertExecutionRequest<
    string,
    string
  > = { execution, invocation, isolationRequest };
  expect(() =>
    consumeIsolatedStructuralExpertExecution(consumeRequest),
  ).toThrow('isolation receipt is invalid');
});

function structuralInvocation(): AgentExecutionInvocation<string, string> {
  return {
    task: 'inspect-code',
    attempt: 1,
    sourceCommit: SOURCE_COMMIT,
    runId: 'structural-isolation-receipt',
    workingDirectory: '/tmp/structural-isolation-receipt',
    upstreamOutputs: [],
    signal: new AbortController().signal,
    observe: async () => {},
    execution: {
      kind: WorkflowExecutorKind.Agent,
      agent: 'code_refactoring_expert',
      instruction: 'Inspect bounded code.',
      resultKind: WorkflowResultKind.CodeRefactoringEvidence,
    },
    agentProfile: {
      name: 'code_refactoring_expert',
      instructionPrefix: 'Inspect only.',
      workspacePolicy: AgentWorkspacePolicy.ReadOnly,
      reasoningEffort: AgentReasoningEffort.High,
    },
  };
}

function structuralIsolationRequest(): ReadOnlyExpertRuntimeIsolationRequest {
  return {
    expertName: 'code_refactoring_expert',
    parentEnvironment: {},
    sourceCommit: SOURCE_COMMIT,
    workingDirectory: '/tmp/structural-isolation-receipt',
    snapshot: {
      scopePaths: ['agentic-ai/loom/src'],
      optionalScopePaths: [],
      excludedPaths: [],
      contextFiles: [],
    },
  };
}

function codeEvidence(): CodeRefactoringTaskOutput {
  const evidence = ['Evidence recorded.'];
  return {
    resultKind: WorkflowResultKind.CodeRefactoringEvidence,
    summary: 'Code inspected.',
    materializedViewMarkdown: '# Code evidence\n\nInspected.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    continuation: {
      scopeModules: evidence,
      acceptedExternalContracts: evidence,
      preservedBehaviorInvariants: evidence,
      preservedSecurityInvariants: evidence,
      architectureFindings: noFindings(),
      designFindings: noFindings(),
      codeQualityFindings: noFindings(),
      typeSafetyFindings: noFindings(),
      testFindings: noFindings(),
      dependencyDirectionFindings: noFindings(),
      proposedSlices: evidence,
      focusedValidation: evidence,
      risks: evidence,
      unresolvedDecisions: evidence,
      parentActions: evidence,
    },
  };
}
function noFindings() {
  return {
    kind: StructuralAssessmentKind.None,
    reason: 'The bounded assessment found no issue in this category.',
  } as const;
}
