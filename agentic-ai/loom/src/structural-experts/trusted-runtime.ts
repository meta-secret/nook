import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  AgentReasoningEffort,
  AgentWorkspacePolicy,
  DelegatedAgentWorkflowName,
  WorkflowExecutorKind,
} from '../agent-workflow/domain.ts';
import type {
  AgentAttemptParent,
  AgentProfile,
  AgentTaskExecution,
} from '../agent-workflow/domain.ts';
import { WorkflowResultSchema } from '../agent-workflow/structured-result-codec.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  RuntimeActivityObserver,
} from '../agent-workflow/runtime.ts';
import type {
  ReadOnlyExpertContextFile,
  ReadOnlyExpertRuntimeIsolationRequest,
} from '../module-experts/runtime-contract.ts';
import { StructuralExpertContract } from './audit.ts';
import { StructuralExpertKind, StructuralExpertCatalog } from './catalog.ts';
import type { StructuralExpertProfile } from './catalog.ts';
import {
  STRUCTURAL_EXPERT_WORKFLOW_VERSION,
  StructuralExpertParentAuthorization,
} from './parent-authorization.ts';
import type {
  VerifiedStructuralChildContext,
  VerifiedStructuralParentAuthorization,
} from './parent-authorization.ts';
import { StructuralExpertRequestDecoder } from './request-codec.ts';
import type { StructuralExpertInvocationRequest } from './request-codec.ts';
import { StructuralExpertIsolationReceipts } from './isolation-receipt.ts';

const STRUCTURAL_EXPERT_INSTRUCTIONS = `Act only as the assigned read-only Nook structural expert.
Use only the bounded context exposed by Loom at the exact source commit.
Return the required typed evidence and an agent-authored Markdown view.
Do not edit files, apply patches, delegate, schedule successors, or mutate Git, GitHub, Workbench, CI, deployment, or workflow processing.
Recommendations are evidence for the delivery owner and never grant authority.`;

export enum StructuralRuntimeCapabilityKind {
  Session = 'structural-expert-runtime-session',
  JournalAuthority = 'structural-expert-journal-authority',
  JournalBinding = 'structural-expert-journal-binding',
  CompletionAuthority = 'structural-expert-completion-authority',
}

export type StructuralRuntimeIdentity = {
  readonly runDirectory: string;
  readonly workingDirectory: string;
  readonly runId: string;
  readonly workflow: DelegatedAgentWorkflowName.AgentWork;
  readonly workflowVersion: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly agent: string;
  readonly attempt: number;
  readonly depth: 2;
  readonly parent: AgentAttemptParent;
  readonly instruction: string;
};

export class StructuralRuntimeSession {
  readonly kind = StructuralRuntimeCapabilityKind.Session;
  private seal(): void {
    Object.freeze(this);
  }
  private constructor() {}
  static issue(key: typeof AUTHORITY_ISSUANCE): StructuralRuntimeSession {
    if (key !== AUTHORITY_ISSUANCE)
      throw new Error('Invalid capability issuance.');
    const capability = new StructuralRuntimeSession();
    capability.seal();
    return capability;
  }
}

export class StructuralJournalAuthority {
  readonly kind = StructuralRuntimeCapabilityKind.JournalAuthority;
  private seal(): void {
    Object.freeze(this);
  }
  private constructor() {}
  static issue(key: typeof AUTHORITY_ISSUANCE): StructuralJournalAuthority {
    if (key !== AUTHORITY_ISSUANCE)
      throw new Error('Invalid capability issuance.');
    const capability = new StructuralJournalAuthority();
    capability.seal();
    return capability;
  }
}

export class StructuralJournalBinding {
  readonly kind = StructuralRuntimeCapabilityKind.JournalBinding;
  private seal(): void {
    Object.freeze(this);
  }
  private constructor() {}
  static issue(key: typeof AUTHORITY_ISSUANCE): StructuralJournalBinding {
    if (key !== AUTHORITY_ISSUANCE)
      throw new Error('Invalid capability issuance.');
    const capability = new StructuralJournalBinding();
    capability.seal();
    return capability;
  }
}

export class StructuralCompletionAuthority {
  readonly kind = StructuralRuntimeCapabilityKind.CompletionAuthority;
  private seal(): void {
    Object.freeze(this);
  }
  private constructor() {}
  static issue(key: typeof AUTHORITY_ISSUANCE): StructuralCompletionAuthority {
    if (key !== AUTHORITY_ISSUANCE)
      throw new Error('Invalid capability issuance.');
    const capability = new StructuralCompletionAuthority();
    capability.seal();
    return capability;
  }
}

export type TrustedStructuralExecution = {
  readonly completion: AgentExecutionCompletion;
  readonly authority: StructuralCompletionAuthority;
};

export type CreateStructuralRuntimeSessionRequest = {
  readonly repoRoot: string;
  readonly request: StructuralExpertInvocationRequest;
  readonly parentAuthorization: VerifiedStructuralParentAuthorization;
};

export type CreatedStructuralRuntimeSession = {
  readonly session: StructuralRuntimeSession;
  readonly journalAuthority: StructuralJournalAuthority;
  readonly identity: StructuralRuntimeIdentity;
};

export type ExecuteStructuralExpertRequest = {
  readonly session: StructuralRuntimeSession;
  readonly signal: AbortSignal;
  readonly observe: RuntimeActivityObserver;
};

export type ConsumeStructuralJournalAuthorityRequest = {
  readonly authority: StructuralJournalAuthority;
  readonly identity: StructuralRuntimeIdentity;
};

export type ConsumeStructuralCompletionAuthorityRequest = {
  readonly binding: StructuralJournalBinding;
  readonly execution: TrustedStructuralExecution;
  readonly terminalCompletion: AgentExecutionCompletion;
};

type StructuralSessionRecord = {
  readonly identity: StructuralRuntimeIdentity;
  readonly identityDigest: string;
  readonly invocation: AgentExecutionInvocation<string, string>;
  readonly isolationRequest: ReadOnlyExpertRuntimeIsolationRequest;
};

type StructuralAuthorityRecord = {
  readonly session: StructuralRuntimeSession;
  readonly identityDigest: string;
};

type StructuralCompletionRecord = StructuralAuthorityRecord & {
  readonly completionDigest: string;
};

/** Owns the structural expert runtime authority registry and its capability transitions. */
export class StructuralExpertRuntimeAuthority {
  private constructor() {}
  private static readonly SESSIONS = new WeakMap<
    StructuralRuntimeSession,
    StructuralSessionRecord
  >();

  private static readonly JOURNAL_AUTHORITIES = new WeakMap<
    StructuralJournalAuthority,
    StructuralAuthorityRecord
  >();

  private static readonly JOURNAL_BINDINGS = new WeakMap<
    StructuralJournalBinding,
    StructuralAuthorityRecord
  >();

  private static readonly COMPLETION_AUTHORITIES = new WeakMap<
    StructuralCompletionAuthority,
    StructuralCompletionRecord
  >();

  static createStructuralRuntimeSession(
    input: CreateStructuralRuntimeSessionRequest,
  ): CreatedStructuralRuntimeSession {
    const request =
      StructuralExpertRequestDecoder.validatedStructuralExpertInvocationRequest(
        input.request,
      );
    const repoRoot = resolve(input.repoRoot);
    const auditRequest = { repoRoot };
    const audit = StructuralExpertContract.auditStructuralExperts(auditRequest);
    const profile = StructuralExpertCatalog.structuralExpertProfile(
      request.expert,
    );
    if (!audit.auditOk || !profile) {
      throw new Error('Structural expert runtime contract is invalid.');
    }
    const runDirectory = join(
      repoRoot,
      'workflow',
      'processing',
      DelegatedAgentWorkflowName.AgentWork,
      request.runId,
    );
    const authorizationRequest = {
      authorization: input.parentAuthorization,
      request,
      runDirectory,
    };
    const childContexts =
      StructuralExpertParentAuthorization.consumeStructuralParentAuthorization(
        authorizationRequest,
      );
    const instructionInput: StructuralInstructionInput = {
      instruction: request.instruction,
      profile,
    };
    const instruction =
      StructuralExpertRuntimeAuthority.structuralInstruction(instructionInput);
    const parentValue: AgentAttemptParent = { ...request.parent };
    const parent = Object.freeze(parentValue);
    const identityValue: StructuralRuntimeIdentity = {
      runDirectory,
      workingDirectory: repoRoot,
      runId: request.runId,
      workflow: DelegatedAgentWorkflowName.AgentWork,
      workflowVersion: STRUCTURAL_EXPERT_WORKFLOW_VERSION,
      sourceCommit: request.sourceCommit,
      task: request.task,
      agent: request.expert,
      attempt: request.attempt,
      depth: 2 as const,
      parent,
      instruction,
    };
    const identity = Object.freeze(identityValue);
    const agentProfile: AgentProfile<string> = {
      name: profile.name,
      instructionPrefix: STRUCTURAL_EXPERT_INSTRUCTIONS,
      workspacePolicy: AgentWorkspacePolicy.ReadOnly,
      reasoningEffort: AgentReasoningEffort.High,
    };
    const execution: AgentTaskExecution<string> = {
      kind: WorkflowExecutorKind.Agent,
      agent: profile.name,
      instruction,
      resultKind: profile.resultKind,
    };
    const invocation: AgentExecutionInvocation<string, string> = {
      task: request.task,
      attempt: request.attempt,
      sourceCommit: request.sourceCommit,
      runId: request.runId,
      workingDirectory: repoRoot,
      upstreamOutputs: [],
      signal: AbortSignal.abort(),
      observe: async () => {},
      execution,
      agentProfile,
    };
    const isolationInput: StructuralIsolationRequestInput = {
      childContexts,
      profile,
      repoRoot,
      request,
    };
    const isolationRequest =
      StructuralExpertRuntimeAuthority.structuralIsolationRequest(
        isolationInput,
      );
    const sessionValue = StructuralRuntimeSession.issue(AUTHORITY_ISSUANCE);
    const session = sessionValue;
    const journalAuthorityValue =
      StructuralJournalAuthority.issue(AUTHORITY_ISSUANCE);
    const journalAuthority = journalAuthorityValue;
    const identityDigest = StructuralExpertRuntimeAuthority.digest(identity);
    const sessionRecord: StructuralSessionRecord = {
      identity,
      identityDigest,
      invocation,
      isolationRequest,
    };
    StructuralExpertRuntimeAuthority.SESSIONS.set(session, sessionRecord);
    const authorityRecord: StructuralAuthorityRecord = {
      session,
      identityDigest,
    };
    StructuralExpertRuntimeAuthority.JOURNAL_AUTHORITIES.set(
      journalAuthority,
      authorityRecord,
    );
    return { session, journalAuthority, identity };
  }

  static async executeStructuralExpert(
    input: ExecuteStructuralExpertRequest,
  ): Promise<TrustedStructuralExecution> {
    const record = StructuralExpertRuntimeAuthority.SESSIONS.get(input.session);
    if (!record)
      throw new Error('Structural expert runtime session is invalid.');
    StructuralExpertRuntimeAuthority.SESSIONS.delete(input.session);
    const invocation: AgentExecutionInvocation<string, string> = {
      ...record.invocation,
      signal: input.signal,
      observe: input.observe,
    };
    const executionRequest = {
      invocation,
      isolationRequest: record.isolationRequest,
    };
    const isolatedExecution =
      await StructuralExpertIsolationReceipts.executeIsolatedStructuralExpert(
        executionRequest,
      );
    const consumeRequest = {
      execution: isolatedExecution,
      invocation,
      isolationRequest: record.isolationRequest,
    };
    StructuralExpertIsolationReceipts.consumeIsolatedStructuralExpertExecution(
      consumeRequest,
    );
    const completion = isolatedExecution.completion;
    const authorityValue =
      StructuralCompletionAuthority.issue(AUTHORITY_ISSUANCE);
    const authority = authorityValue;
    const completionRecord: StructuralCompletionRecord = {
      session: input.session,
      identityDigest: record.identityDigest,
      completionDigest: StructuralExpertRuntimeAuthority.digest(completion),
    };
    StructuralExpertRuntimeAuthority.COMPLETION_AUTHORITIES.set(
      authority,
      completionRecord,
    );
    const trustedExecution: TrustedStructuralExecution = {
      completion,
      authority,
    };
    return Object.freeze(trustedExecution);
  }

  static consumeStructuralJournalAuthority(
    input: ConsumeStructuralJournalAuthorityRequest,
  ): StructuralJournalBinding {
    const record = StructuralExpertRuntimeAuthority.JOURNAL_AUTHORITIES.get(
      input.authority,
    );
    if (
      !record ||
      record.identityDigest !==
        StructuralExpertRuntimeAuthority.digest(input.identity)
    ) {
      throw new Error('Structural expert journal authority is invalid.');
    }
    StructuralExpertRuntimeAuthority.JOURNAL_AUTHORITIES.delete(
      input.authority,
    );
    const bindingValue = StructuralJournalBinding.issue(AUTHORITY_ISSUANCE);
    const binding = bindingValue;
    StructuralExpertRuntimeAuthority.JOURNAL_BINDINGS.set(binding, record);
    return binding;
  }

  static consumeStructuralCompletionAuthority(
    input: ConsumeStructuralCompletionAuthorityRequest,
  ): void {
    const journal = StructuralExpertRuntimeAuthority.JOURNAL_BINDINGS.get(
      input.binding,
    );
    const completion =
      StructuralExpertRuntimeAuthority.COMPLETION_AUTHORITIES.get(
        input.execution.authority,
      );
    if (
      !journal ||
      !completion ||
      journal.session !== completion.session ||
      journal.identityDigest !== completion.identityDigest ||
      completion.completionDigest !==
        StructuralExpertRuntimeAuthority.digest(input.execution.completion) ||
      completion.completionDigest !==
        StructuralExpertRuntimeAuthority.digest(input.terminalCompletion)
    ) {
      throw new Error('Structural expert completion authority is invalid.');
    }
    StructuralExpertRuntimeAuthority.JOURNAL_BINDINGS.delete(input.binding);
    StructuralExpertRuntimeAuthority.COMPLETION_AUTHORITIES.delete(
      input.execution.authority,
    );
  }

  private static structuralIsolationRequest(
    input: StructuralIsolationRequestInput,
  ): ReadOnlyExpertRuntimeIsolationRequest {
    const repositoryEvidence =
      input.request.kind === StructuralExpertKind.RepositoryEvidence;
    const contextFiles: ReadOnlyExpertContextFile[] =
      input.childContexts.flatMap((child) => [
        {
          path: `children/${child.task}/attempt-${child.attempt}/result.json`,
          content: `${child.resultJson}\n`,
        },
        {
          path: `children/${child.task}/attempt-${child.attempt}/view.md`,
          content: child.viewMarkdown,
        },
      ]);
    return {
      expertName: input.profile.name,
      parentEnvironment: process.env,
      snapshot: {
        excludedPaths: repositoryEvidence ? input.profile.excludedPaths : [],
        optionalScopePaths: [],
        scopePaths: repositoryEvidence
          ? [
              input.profile.skillPath,
              ...input.profile.requiredContextPaths,
              ...input.request.evidencePaths,
            ]
          : [],
        contextFiles,
      },
      sourceCommit: input.request.sourceCommit,
      workingDirectory: input.repoRoot,
    };
  }

  private static structuralInstruction(
    input: StructuralInstructionInput,
  ): string {
    return [
      `Assigned structural expert: ${input.profile.name}`,
      `Role: ${input.profile.description}`,
      `Result kind: ${input.profile.resultKind}`,
      input.profile.kind === StructuralExpertKind.VerifiedViewSynthesis
        ? `Reviewed runtime behavior contract:\n${input.profile.runtimeBehaviorContract}`
        : 'The canonical Cortex role context and reviewed skill are included in the bounded repository snapshot.',
      input.profile.kind === StructuralExpertKind.VerifiedViewSynthesis
        ? 'Context contains verified child result.json and view.md projections only. Treat missing coverage as a gap; never infer absent evidence.'
        : `Exact evidence files: ${JSON.stringify(input.profile.allowedEvidenceFiles)}\nStrict descendant roots: ${JSON.stringify(input.profile.allowedEvidenceDescendantRoots)}`,
      `Focused validation: ${JSON.stringify(input.profile.validationSelectors)}`,
      `Requested analysis:\n${input.instruction}`,
    ].join('\n\n');
  }

  private static digest(
    value: StructuralRuntimeIdentity | AgentExecutionCompletion,
  ): string {
    if ('threadId' in value) {
      const canonical = {
        threadId: value.threadId,
        output: WorkflowResultSchema.decodeWorkflowTaskOutputNode(value.output),
      };
      return createHash('sha256')
        .update(JSON.stringify(canonical))
        .digest('hex');
    }
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}

type StructuralIsolationRequestInput = {
  readonly childContexts: readonly VerifiedStructuralChildContext[];
  readonly profile: StructuralExpertProfile;
  readonly repoRoot: string;
  readonly request: StructuralExpertInvocationRequest;
};

type StructuralInstructionInput = {
  readonly instruction: string;
  readonly profile: StructuralExpertProfile;
};

const AUTHORITY_ISSUANCE = Symbol('expert-authority-issuance');
