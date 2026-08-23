import { createHash } from 'node:crypto';
import { runIsolatedReadOnlyExpertCodex } from '../agent-workflow/codex-runtime.ts';
import type { RunIsolatedReadOnlyExpertCodexRequest } from '../agent-workflow/codex-runtime.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
} from '../agent-workflow/runtime.ts';
import type { ReadOnlyExpertRuntimeIsolationRequest } from '../module-experts/runtime-contract.ts';

export enum StructuralExpertIsolationReceiptKind {
  Isolated = 'structural-expert-isolation-receipt',
}

export type StructuralExpertIsolationReceipt = {
  readonly kind: StructuralExpertIsolationReceiptKind.Isolated;
};

export type IsolatedStructuralExpertExecution = {
  readonly completion: AgentExecutionCompletion;
  readonly receipt: StructuralExpertIsolationReceipt;
};

export type ExecuteIsolatedStructuralExpertRequest<
  TTask extends string,
  TAgent extends string,
> = RunIsolatedReadOnlyExpertCodexRequest<TTask, TAgent>;

export type ConsumeIsolatedStructuralExpertExecutionRequest<
  TTask extends string,
  TAgent extends string,
> = {
  readonly execution: IsolatedStructuralExpertExecution;
  readonly invocation: AgentExecutionInvocation<TTask, TAgent>;
  readonly isolationRequest: ReadOnlyExpertRuntimeIsolationRequest;
};

type StructuralExpertIsolationReceiptRecord = {
  readonly completionDigest: string;
  readonly invocationDigest: string;
  readonly isolationDigest: string;
};

const RECEIPTS = new WeakMap<
  StructuralExpertIsolationReceipt,
  StructuralExpertIsolationReceiptRecord
>();

export async function executeIsolatedStructuralExpert<
  TTask extends string,
  TAgent extends string,
>(
  request: ExecuteIsolatedStructuralExpertRequest<TTask, TAgent>,
): Promise<IsolatedStructuralExpertExecution> {
  const completion = await runIsolatedReadOnlyExpertCodex(request);
  const receiptValue = {
    kind: StructuralExpertIsolationReceiptKind.Isolated,
  } as const;
  const receipt: StructuralExpertIsolationReceipt = Object.freeze(receiptValue);
  const record: StructuralExpertIsolationReceiptRecord = {
    completionDigest: completionDigest(completion),
    invocationDigest: invocationDigest(request.invocation),
    isolationDigest: isolationDigest(request.isolationRequest),
  };
  RECEIPTS.set(receipt, record);
  const execution: IsolatedStructuralExpertExecution = { completion, receipt };
  return Object.freeze(execution);
}

export function consumeIsolatedStructuralExpertExecution<
  TTask extends string,
  TAgent extends string,
>(
  request: ConsumeIsolatedStructuralExpertExecutionRequest<TTask, TAgent>,
): void {
  const record = RECEIPTS.get(request.execution.receipt);
  if (
    !record ||
    record.completionDigest !==
      completionDigest(request.execution.completion) ||
    record.invocationDigest !== invocationDigest(request.invocation) ||
    record.isolationDigest !== isolationDigest(request.isolationRequest)
  ) {
    throw new Error('Structural expert isolation receipt is invalid.');
  }
  RECEIPTS.delete(request.execution.receipt);
}

function completionDigest(completion: AgentExecutionCompletion): string {
  return sha256(JSON.stringify(completion));
}

function invocationDigest<TTask extends string, TAgent extends string>(
  invocation: AgentExecutionInvocation<TTask, TAgent>,
): string {
  const identity = {
    task: invocation.task,
    attempt: invocation.attempt,
    sourceCommit: invocation.sourceCommit,
    runId: invocation.runId,
    workingDirectory: invocation.workingDirectory,
    upstreamOutputs: invocation.upstreamOutputs,
    execution: invocation.execution,
    agentProfile: invocation.agentProfile,
  };
  return sha256(JSON.stringify(identity));
}

function isolationDigest(
  request: ReadOnlyExpertRuntimeIsolationRequest,
): string {
  const identity = {
    expertName: request.expertName,
    sourceCommit: request.sourceCommit,
    workingDirectory: request.workingDirectory,
    snapshot: request.snapshot,
  };
  return sha256(JSON.stringify(identity));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
