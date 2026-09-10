import { err, ok, type Result } from 'neverthrow';
import { type AgentExecutionFailure } from '../agent-workflow/runtime.ts';
import { createHash } from 'node:crypto';
import { ReadOnlyExpertCodexRuntime } from '../agent-workflow/codex-runtime.ts';
import type { RunIsolatedReadOnlyExpertCodexRequest } from '../agent-workflow/codex-runtime.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
} from '../agent-workflow/runtime.ts';
import type { ReadOnlyExpertRuntimeIsolationRequest } from '../module-experts/runtime-contract.ts';

export enum StructuralExpertIsolationReceiptKind {
  Isolated = 'structural-expert-isolation-receipt',
}

export class StructuralExpertIsolationReceipt {
  readonly kind = StructuralExpertIsolationReceiptKind.Isolated;
  private seal(): void {
    Object.freeze(this);
  }
  private constructor() {}
  static issue(
    key: typeof AUTHORITY_ISSUANCE,
  ): StructuralExpertIsolationReceipt {
    if (key !== AUTHORITY_ISSUANCE)
      throw new Error('Invalid capability issuance.');
    const capability = new StructuralExpertIsolationReceipt();
    capability.seal();
    return capability;
  }
}

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

/** Owns the structural expert isolation receipts registry and its capability transitions. */
export class StructuralExpertIsolationReceipts {
  private constructor() {}
  private static readonly RECEIPTS = new WeakMap<
    StructuralExpertIsolationReceipt,
    StructuralExpertIsolationReceiptRecord
  >();

  static async executeIsolatedStructuralExpert<
    TTask extends string,
    TAgent extends string,
  >(
    request: ExecuteIsolatedStructuralExpertRequest<TTask, TAgent>,
  ): Promise<Result<IsolatedStructuralExpertExecution, AgentExecutionFailure>> {
    const completionResult =
      await ReadOnlyExpertCodexRuntime.executeIsolated(request);
    if (completionResult.isErr()) return err(completionResult.error);
    const completion = completionResult.value;
    const receiptValue =
      StructuralExpertIsolationReceipt.issue(AUTHORITY_ISSUANCE);
    const receipt: StructuralExpertIsolationReceipt = receiptValue;
    const record: StructuralExpertIsolationReceiptRecord = {
      completionDigest:
        StructuralExpertIsolationReceipts.completionDigest(completion),
      invocationDigest: StructuralExpertIsolationReceipts.invocationDigest(
        request.invocation,
      ),
      isolationDigest: StructuralExpertIsolationReceipts.isolationDigest(
        request.isolationRequest,
      ),
    };
    StructuralExpertIsolationReceipts.RECEIPTS.set(receipt, record);
    const execution: IsolatedStructuralExpertExecution = {
      completion,
      receipt,
    };
    return ok(Object.freeze(execution));
  }

  static consumeIsolatedStructuralExpertExecution<
    TTask extends string,
    TAgent extends string,
  >(
    request: ConsumeIsolatedStructuralExpertExecutionRequest<TTask, TAgent>,
  ): void {
    const record = StructuralExpertIsolationReceipts.RECEIPTS.get(
      request.execution.receipt,
    );
    if (
      !record ||
      record.completionDigest !==
        StructuralExpertIsolationReceipts.completionDigest(
          request.execution.completion,
        ) ||
      record.invocationDigest !==
        StructuralExpertIsolationReceipts.invocationDigest(
          request.invocation,
        ) ||
      record.isolationDigest !==
        StructuralExpertIsolationReceipts.isolationDigest(
          request.isolationRequest,
        )
    ) {
      throw new Error('Structural expert isolation receipt is invalid.');
    }
    StructuralExpertIsolationReceipts.RECEIPTS.delete(
      request.execution.receipt,
    );
  }

  private static completionDigest(
    completion: AgentExecutionCompletion,
  ): string {
    return StructuralExpertIsolationReceipts.sha256(JSON.stringify(completion));
  }

  private static invocationDigest<TTask extends string, TAgent extends string>(
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
    return StructuralExpertIsolationReceipts.sha256(JSON.stringify(identity));
  }

  private static isolationDigest(
    request: ReadOnlyExpertRuntimeIsolationRequest,
  ): string {
    const identity = {
      expertName: request.expertName,
      sourceCommit: request.sourceCommit,
      workingDirectory: request.workingDirectory,
      snapshot: request.snapshot,
    };
    return StructuralExpertIsolationReceipts.sha256(JSON.stringify(identity));
  }

  private static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

const AUTHORITY_ISSUANCE = Symbol('expert-authority-issuance');
