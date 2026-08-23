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
import {
  consumeIsolatedModuleExpertExecution,
  executeIsolatedModuleExpertAgent,
} from '../../src/module-experts/isolation-receipt.ts';
import type {
  ConsumeIsolatedModuleExpertExecutionArgs,
  ExecuteIsolatedModuleExpertAgentArgs,
  IsolatedModuleExpertExecution,
  ModuleExpertIsolationReceipt,
} from '../../src/module-experts/isolation-receipt.ts';
import { moduleExpertEvidenceOutput } from './invoke-parent-fixture.ts';
import { registerModuleExpertRuntimeMock } from './module-expert-runtime-mock.ts';
import type { RegisterModuleExpertRuntimeMockArgs } from './module-expert-runtime-mock.ts';

const RUN_ID = 'isolation-receipt';
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

class ReceiptRuntime implements AgentTaskRuntime<string, string> {
  async executeAgent(): Promise<AgentExecutionCompletion> {
    return {
      threadId: 'receipt-thread',
      output: moduleExpertEvidenceOutput(),
    };
  }
}

test('binds an isolation receipt to one exact completion and invocation', async () => {
  const invocation = moduleExpertInvocation();
  const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
    runId: invocation.runId,
    runtime: new ReceiptRuntime(),
  };
  const runtimeMock = registerModuleExpertRuntimeMock(runtimeMockArgs);
  try {
    const executeArgs: ExecuteIsolatedModuleExpertAgentArgs<string, string> = {
      invocation,
    };
    const execution = await executeIsolatedModuleExpertAgent(executeArgs);
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
    };
    expect(() =>
      consumeIsolatedModuleExpertExecution(mutatedCompletionArgs),
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
    };
    expect(() =>
      consumeIsolatedModuleExpertExecution(mutatedInvocationArgs),
    ).toThrow('isolation receipt is invalid');

    const consumeArgs: ConsumeIsolatedModuleExpertExecutionArgs<
      string,
      string
    > = {
      execution,
      invocation,
    };
    consumeIsolatedModuleExpertExecution(consumeArgs);
    expect(() => consumeIsolatedModuleExpertExecution(consumeArgs)).toThrow(
      'isolation receipt is invalid',
    );
  } finally {
    runtimeMock.dispose();
  }
});

test('rejects a structurally forged isolation receipt', () => {
  const invocation = moduleExpertInvocation();
  const forgedReceipt = {
    kind: 'module-expert-isolation-receipt',
  } as ModuleExpertIsolationReceipt;
  const execution: IsolatedModuleExpertExecution = {
    completion: {
      threadId: 'forged-thread',
      output: moduleExpertEvidenceOutput(),
    },
    receipt: forgedReceipt,
  };
  const consumeArgs: ConsumeIsolatedModuleExpertExecutionArgs<string, string> =
    {
      execution,
      invocation,
    };

  expect(() => consumeIsolatedModuleExpertExecution(consumeArgs)).toThrow(
    'isolation receipt is invalid',
  );
});

function moduleExpertInvocation(): AgentExecutionInvocation<string, string> {
  const controller = new AbortController();
  return {
    task: 'inspect-core-contract',
    attempt: 1,
    sourceCommit: SOURCE_COMMIT,
    runId: RUN_ID,
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
