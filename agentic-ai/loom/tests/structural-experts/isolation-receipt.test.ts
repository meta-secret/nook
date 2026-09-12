import assert from 'node:assert/strict';
import { ok, type Result } from 'neverthrow';
import { type AgentExecutionFailure } from '../../src/agent-workflow/runtime.ts';
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
import { StructuralExpertIsolationReceipts } from '../../src/structural-experts/isolation-receipt.ts';
import type {
  ConsumeIsolatedStructuralExpertExecutionRequest,
  IsolatedStructuralExpertExecution,
  StructuralExpertIsolationReceipt,
} from '../../src/structural-experts/isolation-receipt.ts';
import { StructuralExpertsStructuralRuntimeMockScenario } from './structural-runtime-mock.ts';
import type { RegisterStructuralRuntimeMockRequest } from './structural-runtime-mock.ts';

/** Owns the structural experts isolation receipt fixture registry and its capability transitions. */
export class StructuralExpertsIsolationReceiptFixture {
  private constructor() {}
  static readonly SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

  static structuralInvocation(): AgentExecutionInvocation<string, string> {
    return {
      task: 'inspect-code',
      attempt: 1,
      sourceCommit: StructuralExpertsIsolationReceiptFixture.SOURCE_COMMIT,
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

  static structuralIsolationRequest(): ReadOnlyExpertRuntimeIsolationRequest {
    return {
      expertName: 'code_refactoring_expert',
      parentEnvironment: {},
      sourceCommit: StructuralExpertsIsolationReceiptFixture.SOURCE_COMMIT,
      workingDirectory: '/tmp/structural-isolation-receipt',
      snapshot: {
        scopePaths: ['agentic-ai/loom/src'],
        optionalScopePaths: [],
        excludedPaths: [],
        contextFiles: [],
      },
    };
  }

  static codeEvidence(): CodeRefactoringTaskOutput {
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
        architectureFindings:
          StructuralExpertsIsolationReceiptFixture.noFindings(),
        designFindings: StructuralExpertsIsolationReceiptFixture.noFindings(),
        codeQualityFindings:
          StructuralExpertsIsolationReceiptFixture.noFindings(),
        typeSafetyFindings:
          StructuralExpertsIsolationReceiptFixture.noFindings(),
        testFindings: StructuralExpertsIsolationReceiptFixture.noFindings(),
        dependencyDirectionFindings:
          StructuralExpertsIsolationReceiptFixture.noFindings(),
        proposedSlices: evidence,
        focusedValidation: evidence,
        risks: evidence,
        unresolvedDecisions: evidence,
        parentActions: evidence,
      },
    };
  }

  static noFindings() {
    return {
      kind: StructuralAssessmentKind.None,
      reason: 'The bounded assessment found no issue in this category.',
    } as const;
  }
}

class ReceiptRuntime implements AgentTaskRuntime<string, string> {
  async executeAgent(): Promise<
    Result<AgentExecutionCompletion, AgentExecutionFailure>
  > {
    return ok({
      threadId: 'receipt-thread',
      output: StructuralExpertsIsolationReceiptFixture.codeEvidence(),
    });
  }
}

test('binds one structural isolation receipt to exact execution inputs', async () => {
  const invocation =
    StructuralExpertsIsolationReceiptFixture.structuralInvocation();
  const isolationRequest =
    StructuralExpertsIsolationReceiptFixture.structuralIsolationRequest();
  const registrationRequest: RegisterStructuralRuntimeMockRequest = {
    runId: invocation.runId,
    runtime: new ReceiptRuntime(),
  };
  const registration =
    StructuralExpertsStructuralRuntimeMockScenario.registerStructuralRuntimeMock(
      registrationRequest,
    );
  try {
    const executionRequest = {
      invocation,
      isolationRequest,
    };
    const executionResult =
      await StructuralExpertIsolationReceipts.executeIsolatedStructuralExpert(
        executionRequest,
      );
    assert(executionResult.isOk());
    const execution = executionResult.value;
    const reboundCompletion: IsolatedStructuralExpertExecution = {
      ...execution,
      completion: { ...execution.completion, threadId: 'rebound-thread' },
    };
    const reboundCompletionRequest: ConsumeIsolatedStructuralExpertExecutionRequest<
      string,
      string
    > = { execution: reboundCompletion, invocation, isolationRequest };
    expect(() =>
      StructuralExpertIsolationReceipts.consumeIsolatedStructuralExpertExecution(
        reboundCompletionRequest,
      ),
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
      StructuralExpertIsolationReceipts.consumeIsolatedStructuralExpertExecution(
        reboundInvocationRequest,
      ),
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
      StructuralExpertIsolationReceipts.consumeIsolatedStructuralExpertExecution(
        reboundIsolationRequest,
      ),
    ).toThrow('isolation receipt is invalid');
    const consumeRequest: ConsumeIsolatedStructuralExpertExecutionRequest<
      string,
      string
    > = { execution, invocation, isolationRequest };
    StructuralExpertIsolationReceipts.consumeIsolatedStructuralExpertExecution(
      consumeRequest,
    );
    expect(() =>
      StructuralExpertIsolationReceipts.consumeIsolatedStructuralExpertExecution(
        consumeRequest,
      ),
    ).toThrow('isolation receipt is invalid');
  } finally {
    registration.dispose();
  }
});

test('rejects a structurally forged structural isolation receipt', () => {
  const invocation =
    StructuralExpertsIsolationReceiptFixture.structuralInvocation();
  const isolationRequest =
    StructuralExpertsIsolationReceiptFixture.structuralIsolationRequest();
  const receipt = {
    kind: 'structural-expert-isolation-receipt',
  } as StructuralExpertIsolationReceipt;
  const execution: IsolatedStructuralExpertExecution = {
    completion: {
      threadId: 'forged-thread',
      output: StructuralExpertsIsolationReceiptFixture.codeEvidence(),
    },
    receipt,
  };
  const consumeRequest: ConsumeIsolatedStructuralExpertExecutionRequest<
    string,
    string
  > = { execution, invocation, isolationRequest };
  expect(() =>
    StructuralExpertIsolationReceipts.consumeIsolatedStructuralExpertExecution(
      consumeRequest,
    ),
  ).toThrow('isolation receipt is invalid');
});
