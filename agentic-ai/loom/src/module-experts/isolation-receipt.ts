import { createHash } from 'node:crypto';
import { runIsolatedModuleExpertCodex } from '../agent-workflow/codex-runtime.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
} from '../agent-workflow/runtime.ts';

export enum ModuleExpertIsolationReceiptKind {
  Isolated = 'module-expert-isolation-receipt',
}

export type ModuleExpertIsolationReceipt = {
  readonly kind: ModuleExpertIsolationReceiptKind.Isolated;
};

export type IsolatedModuleExpertExecution = {
  readonly completion: AgentExecutionCompletion;
  readonly receipt: ModuleExpertIsolationReceipt;
};

export type ExecuteIsolatedModuleExpertAgentArgs<
  TTask extends string,
  TAgent extends string,
> = {
  readonly invocation: AgentExecutionInvocation<TTask, TAgent>;
  readonly selectedContextPaths: readonly string[];
};

export type ConsumeIsolatedModuleExpertExecutionArgs<
  TTask extends string,
  TAgent extends string,
> = {
  readonly execution: IsolatedModuleExpertExecution;
  readonly invocation: AgentExecutionInvocation<TTask, TAgent>;
  readonly selectedContextPaths: readonly string[];
};

type ModuleExpertIsolationReceiptRecord = {
  readonly completionDigest: string;
  readonly invocationDigest: string;
};

const MODULE_EXPERT_ISOLATION_RECEIPTS = new WeakMap<
  ModuleExpertIsolationReceipt,
  ModuleExpertIsolationReceiptRecord
>();

export async function executeIsolatedModuleExpertAgent<
  TTask extends string,
  TAgent extends string,
>(
  args: ExecuteIsolatedModuleExpertAgentArgs<TTask, TAgent>,
): Promise<IsolatedModuleExpertExecution> {
  const codexArgs = {
    invocation: args.invocation,
    selectedContextPaths: args.selectedContextPaths,
  };
  const completion = await runIsolatedModuleExpertCodex(codexArgs);
  const receiptValue = {
    kind: ModuleExpertIsolationReceiptKind.Isolated,
  } as const;
  const receipt: ModuleExpertIsolationReceipt = Object.freeze(receiptValue);
  const record: ModuleExpertIsolationReceiptRecord = {
    completionDigest: isolatedCompletionDigest(completion),
    invocationDigest: isolatedInvocationDigest(args),
  };
  MODULE_EXPERT_ISOLATION_RECEIPTS.set(receipt, record);
  const execution = { completion, receipt };
  return Object.freeze(execution);
}

export function consumeIsolatedModuleExpertExecution<
  TTask extends string,
  TAgent extends string,
>(args: ConsumeIsolatedModuleExpertExecutionArgs<TTask, TAgent>): void {
  const record = MODULE_EXPERT_ISOLATION_RECEIPTS.get(args.execution.receipt);
  if (
    !record ||
    record.completionDigest !==
      isolatedCompletionDigest(args.execution.completion) ||
    record.invocationDigest !== isolatedInvocationDigest(args)
  ) {
    throw new Error('Module expert isolation receipt is invalid.');
  }
  MODULE_EXPERT_ISOLATION_RECEIPTS.delete(args.execution.receipt);
}

function isolatedCompletionDigest(
  completion: AgentExecutionCompletion,
): string {
  return createHash('sha256').update(JSON.stringify(completion)).digest('hex');
}

type ModuleExpertIsolationInvocationEvidence<
  TTask extends string,
  TAgent extends string,
> = {
  readonly invocation: AgentExecutionInvocation<TTask, TAgent>;
  readonly selectedContextPaths: readonly string[];
};

function isolatedInvocationDigest<TTask extends string, TAgent extends string>(
  evidence: ModuleExpertIsolationInvocationEvidence<TTask, TAgent>,
): string {
  const invocation = evidence.invocation;
  const identity = {
    task: invocation.task,
    attempt: invocation.attempt,
    sourceCommit: invocation.sourceCommit,
    runId: invocation.runId,
    workingDirectory: invocation.workingDirectory,
    upstreamOutputs: invocation.upstreamOutputs,
    execution: invocation.execution,
    agentProfile: invocation.agentProfile,
    selectedContextPaths: evidence.selectedContextPaths,
  };
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
