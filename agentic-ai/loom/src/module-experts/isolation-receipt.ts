import { err, ok, type Result } from 'neverthrow';
import { type AgentExecutionFailure } from '../agent-workflow/runtime.ts';
import { createHash } from 'node:crypto';
import { ModuleExpertCodexSdkAgentRuntime } from '../agent-workflow/codex-runtime.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
} from '../agent-workflow/runtime.ts';

export enum ModuleExpertIsolationReceiptKind {
  Isolated = 'module-expert-isolation-receipt',
}

export class ModuleExpertIsolationReceipt {
  readonly kind = ModuleExpertIsolationReceiptKind.Isolated;
  private seal(): void {
    Object.freeze(this);
  }
  private constructor() {}
  static issue(key: typeof AUTHORITY_ISSUANCE): ModuleExpertIsolationReceipt {
    if (key !== AUTHORITY_ISSUANCE)
      throw new Error('Invalid capability issuance.');
    const capability = new ModuleExpertIsolationReceipt();
    capability.seal();
    return capability;
  }
}

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

/** Owns the module expert isolation receipts registry and its capability transitions. */
export class ModuleExpertIsolationReceipts {
  private constructor() {}
  private static readonly MODULE_EXPERT_ISOLATION_RECEIPTS = new WeakMap<
    ModuleExpertIsolationReceipt,
    ModuleExpertIsolationReceiptRecord
  >();

  static async executeIsolatedModuleExpertAgent<
    TTask extends string,
    TAgent extends string,
  >(
    args: ExecuteIsolatedModuleExpertAgentArgs<TTask, TAgent>,
  ): Promise<Result<IsolatedModuleExpertExecution, AgentExecutionFailure>> {
    const codexArgs = {
      invocation: args.invocation,
      selectedContextPaths: args.selectedContextPaths,
    };
    const completionResult =
      await ModuleExpertCodexSdkAgentRuntime.executeIsolated(codexArgs);
    if (completionResult.isErr()) return err(completionResult.error);
    const completion = completionResult.value;
    const receiptValue = ModuleExpertIsolationReceipt.issue(AUTHORITY_ISSUANCE);
    const receipt: ModuleExpertIsolationReceipt = receiptValue;
    const record: ModuleExpertIsolationReceiptRecord = {
      completionDigest:
        ModuleExpertIsolationReceipts.isolatedCompletionDigest(completion),
      invocationDigest:
        ModuleExpertIsolationReceipts.isolatedInvocationDigest(args),
    };
    ModuleExpertIsolationReceipts.MODULE_EXPERT_ISOLATION_RECEIPTS.set(
      receipt,
      record,
    );
    const execution = { completion, receipt };
    return ok(Object.freeze(execution));
  }

  static consumeIsolatedModuleExpertExecution<
    TTask extends string,
    TAgent extends string,
  >(args: ConsumeIsolatedModuleExpertExecutionArgs<TTask, TAgent>): void {
    const record =
      ModuleExpertIsolationReceipts.MODULE_EXPERT_ISOLATION_RECEIPTS.get(
        args.execution.receipt,
      );
    if (
      !record ||
      record.completionDigest !==
        ModuleExpertIsolationReceipts.isolatedCompletionDigest(
          args.execution.completion,
        ) ||
      record.invocationDigest !==
        ModuleExpertIsolationReceipts.isolatedInvocationDigest(args)
    ) {
      throw new Error('Module expert isolation receipt is invalid.');
    }
    ModuleExpertIsolationReceipts.MODULE_EXPERT_ISOLATION_RECEIPTS.delete(
      args.execution.receipt,
    );
  }

  private static isolatedCompletionDigest(
    completion: AgentExecutionCompletion,
  ): string {
    return createHash('sha256')
      .update(JSON.stringify(completion))
      .digest('hex');
  }

  private static isolatedInvocationDigest<
    TTask extends string,
    TAgent extends string,
  >(evidence: ModuleExpertIsolationInvocationEvidence<TTask, TAgent>): string {
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
}

type ModuleExpertIsolationInvocationEvidence<
  TTask extends string,
  TAgent extends string,
> = {
  readonly invocation: AgentExecutionInvocation<TTask, TAgent>;
  readonly selectedContextPaths: readonly string[];
};

const AUTHORITY_ISSUANCE = Symbol('expert-authority-issuance');
