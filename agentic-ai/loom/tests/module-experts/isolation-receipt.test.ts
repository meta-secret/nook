import assert from 'node:assert/strict';
import { ok, type Result } from 'neverthrow';
import { type AgentExecutionFailure } from '../../src/agent-workflow/runtime.ts';
import { expect, test } from 'bun:test';
import {
  AgentReasoningEffort,
  AgentWorkspacePolicy,
  WorkflowExecutorKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';
import { ModuleExpertIsolationReceipts } from '../../src/module-experts/isolation-receipt.ts';
import type {
  ConsumeIsolatedModuleExpertExecutionArgs,
  ExecuteIsolatedModuleExpertAgentArgs,
  IsolatedModuleExpertExecution,
  ModuleExpertIsolationReceipt,
} from '../../src/module-experts/isolation-receipt.ts';
import { ModuleExpertsInvokeParentFixtureScenario } from './invoke-parent-fixture.ts';
import { ModuleExpertsModuleExpertRuntimeMockScenario } from './module-expert-runtime-mock.ts';
import type { RegisterModuleExpertRuntimeMockArgs } from './module-expert-runtime-mock.ts';

/** Owns the module experts isolation receipt fixture registry and its capability transitions. */
export class ModuleExpertsIsolationReceiptFixture {
  private constructor() {}
  static readonly RUN_ID = 'isolation-receipt';

  static readonly SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

  static moduleExpertInvocation(): AgentExecutionInvocation<string, string> {
    const controller = new AbortController();
    return {
      task: 'inspect-core-contract',
      attempt: 1,
      sourceCommit: ModuleExpertsIsolationReceiptFixture.SOURCE_COMMIT,
      runId: ModuleExpertsIsolationReceiptFixture.RUN_ID,
      workingDirectory: '/tmp/module-expert-receipt',
      upstreamOutputs: [],
      signal: controller.signal,
      observe: async () => {},
      execution: {
        kind: WorkflowExecutorKind.Agent,
        agent: 'core_expert',
        instruction: 'Inspect the public contract.',
        resultKind: WorkflowResultKind.ModuleExpertEvidence,
      },
      agentProfile: {
        name: 'core_expert',
        instructionPrefix: 'Inspect only.',
        workspacePolicy: AgentWorkspacePolicy.ReadOnly,
        reasoningEffort: AgentReasoningEffort.High,
      },
    };
  }
}

class ReceiptRuntime implements AgentTaskRuntime<string, string> {
  async executeAgent(): Promise<
    Result<AgentExecutionCompletion, AgentExecutionFailure>
  > {
    return ok({
      threadId: 'receipt-thread',
      output:
        ModuleExpertsInvokeParentFixtureScenario.moduleExpertEvidenceOutput(),
    });
  }
}

test('binds an isolation receipt to one exact completion and invocation', async () => {
  const invocation =
    ModuleExpertsIsolationReceiptFixture.moduleExpertInvocation();
  const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
    runId: invocation.runId,
    runtime: new ReceiptRuntime(),
  };
  const runtimeMock =
    ModuleExpertsModuleExpertRuntimeMockScenario.registerModuleExpertRuntimeMock(
      runtimeMockArgs,
    );
  try {
    const executeArgs: ExecuteIsolatedModuleExpertAgentArgs<string, string> = {
      invocation,
      selectedContextPaths: [],
    };
    const executionResult =
      await ModuleExpertIsolationReceipts.executeIsolatedModuleExpertAgent(
        executeArgs,
      );
    assert(executionResult.isOk());
    const execution = executionResult.value;
    const mutatedCompletion: IsolatedModuleExpertExecution = {
      ...execution,
      completion: {
        ...execution.completion,
        threadId: 'rebound-thread',
      },
    };
    const mutatedCompletionArgs: ConsumeIsolatedModuleExpertExecutionArgs<
      string,
      string
    > = {
      execution: mutatedCompletion,
      invocation,
      selectedContextPaths: [],
    };
    expect(() =>
      ModuleExpertIsolationReceipts.consumeIsolatedModuleExpertExecution(
        mutatedCompletionArgs,
      ),
    ).toThrow('isolation receipt is invalid');

    const mutatedInvocation: AgentExecutionInvocation<string, string> = {
      ...invocation,
      task: 'rebound-task',
    };
    const mutatedInvocationArgs: ConsumeIsolatedModuleExpertExecutionArgs<
      string,
      string
    > = {
      execution,
      invocation: mutatedInvocation,
      selectedContextPaths: [],
    };
    expect(() =>
      ModuleExpertIsolationReceipts.consumeIsolatedModuleExpertExecution(
        mutatedInvocationArgs,
      ),
    ).toThrow('isolation receipt is invalid');

    const mutatedContextArgs: ConsumeIsolatedModuleExpertExecutionArgs<
      string,
      string
    > = {
      execution,
      invocation,
      selectedContextPaths: [
        '.cortex/teams/web-dev/product-specs/browser-extension.md',
      ],
    };
    expect(() =>
      ModuleExpertIsolationReceipts.consumeIsolatedModuleExpertExecution(
        mutatedContextArgs,
      ),
    ).toThrow('isolation receipt is invalid');

    const consumeArgs: ConsumeIsolatedModuleExpertExecutionArgs<
      string,
      string
    > = {
      execution,
      invocation,
      selectedContextPaths: [],
    };
    ModuleExpertIsolationReceipts.consumeIsolatedModuleExpertExecution(
      consumeArgs,
    );
    expect(() =>
      ModuleExpertIsolationReceipts.consumeIsolatedModuleExpertExecution(
        consumeArgs,
      ),
    ).toThrow('isolation receipt is invalid');
  } finally {
    runtimeMock.dispose();
  }
});

test('rejects a structurally forged isolation receipt', () => {
  const invocation =
    ModuleExpertsIsolationReceiptFixture.moduleExpertInvocation();
  const forgedReceipt = {
    kind: 'module-expert-isolation-receipt',
  } as ModuleExpertIsolationReceipt;
  const execution: IsolatedModuleExpertExecution = {
    completion: {
      threadId: 'forged-thread',
      output:
        ModuleExpertsInvokeParentFixtureScenario.moduleExpertEvidenceOutput(),
    },
    receipt: forgedReceipt,
  };
  const consumeArgs: ConsumeIsolatedModuleExpertExecutionArgs<string, string> =
    {
      execution,
      invocation,
      selectedContextPaths: [],
    };

  expect(() =>
    ModuleExpertIsolationReceipts.consumeIsolatedModuleExpertExecution(
      consumeArgs,
    ),
  ).toThrow('isolation receipt is invalid');
});
