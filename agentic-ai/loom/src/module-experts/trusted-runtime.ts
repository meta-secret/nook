import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  AgentAttemptParentKind,
  AgentReasoningEffort,
  AgentWorkspacePolicy,
  DelegatedAgentWorkflowName,
  WorkflowExecutorKind,
  WorkflowResultKind,
} from '../agent-workflow/domain.ts';
import type {
  AgentAttemptParent,
  AgentProfile,
  AgentTaskExecution,
} from '../agent-workflow/domain.ts';
import {
  consumeIsolatedModuleExpertExecution,
  executeIsolatedModuleExpertAgent,
} from './isolation-receipt.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  RuntimeActivityObserver,
} from '../agent-workflow/runtime.ts';
import { auditModuleExperts } from './audit.ts';
import {
  MODULE_EXPERT_AGENT_INSTRUCTIONS,
  MODULE_EXPERT_CATALOG,
} from './catalog.ts';
import type { ModuleExpertProfile } from './catalog.ts';
import { consumeModuleExpertParentAuthorization } from './parent-authorization.ts';
import type { VerifiedModuleExpertParentAuthorization } from './parent-authorization.ts';
import { validatedModuleExpertInvocationRequest } from './request-codec.ts';
import type { ModuleExpertInvocationRequest } from './request-codec.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../agent-workflow/agent-attempt-version.ts';

export const MODULE_EXPERT_WORKFLOW_VERSION =
  CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION;

export enum ModuleExpertRuntimeCapabilityKind {
  Session = 'module-expert-runtime-session',
  JournalAuthority = 'module-expert-journal-authority',
  JournalBinding = 'module-expert-journal-binding',
  CompletionAuthority = 'module-expert-completion-authority',
}

export type ModuleExpertRuntimeIdentity = {
  readonly runDirectory: string;
  readonly workingDirectory: string;
  readonly runId: string;
  readonly workflow: DelegatedAgentWorkflowName.AgentWork;
  readonly workflowVersion: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly agent: string;
  readonly attempt: number;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly instruction: string;
};

export type ModuleExpertRuntimeSession = {
  readonly kind: ModuleExpertRuntimeCapabilityKind.Session;
};

export type ModuleExpertJournalAuthority = {
  readonly kind: ModuleExpertRuntimeCapabilityKind.JournalAuthority;
};

export type ModuleExpertJournalBinding = {
  readonly kind: ModuleExpertRuntimeCapabilityKind.JournalBinding;
};

export type ModuleExpertCompletionAuthority = {
  readonly kind: ModuleExpertRuntimeCapabilityKind.CompletionAuthority;
};

export type TrustedModuleExpertExecution = {
  readonly completion: AgentExecutionCompletion;
  readonly authority: ModuleExpertCompletionAuthority;
};

export type CreateModuleExpertRuntimeSessionArgs = {
  readonly repoRoot: string;
  readonly request: ModuleExpertInvocationRequest;
  readonly parentAuthorization: VerifiedModuleExpertParentAuthorization;
};

export type CreatedModuleExpertRuntimeSession = {
  readonly session: ModuleExpertRuntimeSession;
  readonly journalAuthority: ModuleExpertJournalAuthority;
  readonly identity: ModuleExpertRuntimeIdentity;
};

export type ExecuteModuleExpertAgentArgs = {
  readonly session: ModuleExpertRuntimeSession;
  readonly signal: AbortSignal;
  readonly observe: RuntimeActivityObserver;
};

export type ConsumeModuleExpertJournalAuthorityArgs = {
  readonly authority: ModuleExpertJournalAuthority;
  readonly identity: ModuleExpertRuntimeIdentity;
};

export type ConsumeModuleExpertCompletionAuthorityArgs = {
  readonly binding: ModuleExpertJournalBinding;
  readonly execution: TrustedModuleExpertExecution;
  readonly terminalCompletion: AgentExecutionCompletion;
};

type ModuleExpertSessionRecord = {
  readonly identity: ModuleExpertRuntimeIdentity;
  readonly identityDigest: string;
  readonly agentProfile: AgentProfile<string>;
  readonly execution: AgentTaskExecution<string>;
};

type ModuleExpertJournalAuthorityRecord = {
  readonly session: ModuleExpertRuntimeSession;
  readonly identityDigest: string;
};

type ModuleExpertCompletionAuthorityRecord =
  ModuleExpertJournalAuthorityRecord & {
    readonly completionDigest: string;
  };

type ModuleExpertPromptContext = {
  readonly profile: ModuleExpertProfile;
  readonly instruction: string;
};

const MODULE_EXPERT_SESSIONS = new WeakMap<
  ModuleExpertRuntimeSession,
  ModuleExpertSessionRecord
>();
const MODULE_EXPERT_JOURNAL_AUTHORITIES = new WeakMap<
  ModuleExpertJournalAuthority,
  ModuleExpertJournalAuthorityRecord
>();
const MODULE_EXPERT_JOURNAL_BINDINGS = new WeakMap<
  ModuleExpertJournalBinding,
  ModuleExpertJournalAuthorityRecord
>();
const MODULE_EXPERT_COMPLETION_AUTHORITIES = new WeakMap<
  ModuleExpertCompletionAuthority,
  ModuleExpertCompletionAuthorityRecord
>();

export function createModuleExpertRuntimeSession(
  args: CreateModuleExpertRuntimeSessionArgs,
): CreatedModuleExpertRuntimeSession {
  const request = validatedModuleExpertInvocationRequest(args.request);
  if (request.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
    throw new Error('Module expert runtime parent identity is invalid.');
  }
  const repoRoot = resolve(args.repoRoot);
  const auditArgs = { repoRoot };
  const audit = auditModuleExperts(auditArgs);
  const profile = MODULE_EXPERT_CATALOG.find(
    (candidate) => candidate.name === request.expert,
  );
  if (!audit.auditOk || !profile) {
    throw new Error('Module expert runtime contract is invalid.');
  }
  const runDirectory = join(
    repoRoot,
    'workflow',
    'processing',
    DelegatedAgentWorkflowName.AgentWork,
    request.runId,
  );
  const parentRequest = {
    runId: request.runId,
    sourceCommit: request.sourceCommit,
    task: request.task,
    expert: profile.name,
    attempt: request.attempt,
    depth: request.depth,
    parent: request.parent,
  };
  const consumeArgs = {
    runDirectory,
    workflowVersion: MODULE_EXPERT_WORKFLOW_VERSION,
    request: parentRequest,
    expertNames: MODULE_EXPERT_CATALOG.map((expert) => expert.name),
    authorization: args.parentAuthorization,
  };
  consumeModuleExpertParentAuthorization(consumeArgs);
  const promptContext: ModuleExpertPromptContext = {
    profile,
    instruction: request.instruction,
  };
  const instruction = moduleExpertInstruction(promptContext);
  const parentCopy: AgentAttemptParent = { ...request.parent };
  const parent = Object.freeze(parentCopy);
  const identityValue: ModuleExpertRuntimeIdentity = {
    runDirectory,
    workingDirectory: repoRoot,
    runId: request.runId,
    workflow: DelegatedAgentWorkflowName.AgentWork,
    workflowVersion: MODULE_EXPERT_WORKFLOW_VERSION,
    sourceCommit: request.sourceCommit,
    task: request.task,
    agent: profile.name,
    attempt: request.attempt,
    depth: request.depth,
    parent,
    instruction,
  };
  const identity = Object.freeze(identityValue);
  const sessionValue = {
    kind: ModuleExpertRuntimeCapabilityKind.Session,
  } as const;
  const session: ModuleExpertRuntimeSession = Object.freeze(sessionValue);
  const authorityValue = {
    kind: ModuleExpertRuntimeCapabilityKind.JournalAuthority,
  } as const;
  const journalAuthority: ModuleExpertJournalAuthority =
    Object.freeze(authorityValue);
  const agentProfile: AgentProfile<string> = {
    name: profile.name,
    instructionPrefix: MODULE_EXPERT_AGENT_INSTRUCTIONS,
    workspacePolicy: AgentWorkspacePolicy.ReadOnly,
    reasoningEffort: AgentReasoningEffort.High,
  };
  const execution: AgentTaskExecution<string> = {
    kind: WorkflowExecutorKind.Agent,
    agent: profile.name,
    instruction,
    resultKind: WorkflowResultKind.ModuleExpertEvidence,
  };
  const identityDigest = moduleExpertIdentityDigest(identity);
  const record: ModuleExpertSessionRecord = {
    identity,
    identityDigest,
    agentProfile,
    execution,
  };
  MODULE_EXPERT_SESSIONS.set(session, record);
  const authorityRecord: ModuleExpertJournalAuthorityRecord = {
    session,
    identityDigest,
  };
  MODULE_EXPERT_JOURNAL_AUTHORITIES.set(journalAuthority, authorityRecord);
  const created = { session, journalAuthority, identity };
  return Object.freeze(created);
}

export async function executeModuleExpertAgent(
  args: ExecuteModuleExpertAgentArgs,
): Promise<TrustedModuleExpertExecution> {
  const record = MODULE_EXPERT_SESSIONS.get(args.session);
  if (!record) {
    throw new Error('Module expert runtime session identity is invalid.');
  }
  MODULE_EXPERT_SESSIONS.delete(args.session);
  const invocation: AgentExecutionInvocation<string, string> = {
    task: record.identity.task,
    attempt: record.identity.attempt,
    sourceCommit: record.identity.sourceCommit,
    runId: record.identity.runId,
    workingDirectory: record.identity.workingDirectory,
    upstreamOutputs: [],
    signal: args.signal,
    observe: args.observe,
    execution: record.execution,
    agentProfile: record.agentProfile,
  };
  const executionArgs = { invocation };
  const isolatedExecution =
    await executeIsolatedModuleExpertAgent(executionArgs);
  const consumeArgs = {
    execution: isolatedExecution,
    invocation,
  };
  consumeIsolatedModuleExpertExecution(consumeArgs);
  const completion = isolatedExecution.completion;
  const authorityValue = {
    kind: ModuleExpertRuntimeCapabilityKind.CompletionAuthority,
  } as const;
  const authority: ModuleExpertCompletionAuthority =
    Object.freeze(authorityValue);
  const authorityRecord: ModuleExpertCompletionAuthorityRecord = {
    session: args.session,
    identityDigest: record.identityDigest,
    completionDigest: moduleExpertCompletionDigest(completion),
  };
  MODULE_EXPERT_COMPLETION_AUTHORITIES.set(authority, authorityRecord);
  const execution = { completion, authority };
  return Object.freeze(execution);
}

export function consumeModuleExpertJournalAuthority(
  args: ConsumeModuleExpertJournalAuthorityArgs,
): ModuleExpertJournalBinding {
  const record = MODULE_EXPERT_JOURNAL_AUTHORITIES.get(args.authority);
  if (
    !record ||
    record.identityDigest !== moduleExpertIdentityDigest(args.identity)
  ) {
    throw new Error('Module expert journal authority is invalid.');
  }
  MODULE_EXPERT_JOURNAL_AUTHORITIES.delete(args.authority);
  const bindingValue = {
    kind: ModuleExpertRuntimeCapabilityKind.JournalBinding,
  } as const;
  const binding: ModuleExpertJournalBinding = Object.freeze(bindingValue);
  MODULE_EXPERT_JOURNAL_BINDINGS.set(binding, record);
  return binding;
}

export function consumeModuleExpertCompletionAuthority(
  args: ConsumeModuleExpertCompletionAuthorityArgs,
): void {
  const journalRecord = MODULE_EXPERT_JOURNAL_BINDINGS.get(args.binding);
  const completionRecord = MODULE_EXPERT_COMPLETION_AUTHORITIES.get(
    args.execution.authority,
  );
  if (
    !journalRecord ||
    !completionRecord ||
    journalRecord.session !== completionRecord.session ||
    journalRecord.identityDigest !== completionRecord.identityDigest ||
    completionRecord.completionDigest !==
      moduleExpertCompletionDigest(args.execution.completion) ||
    completionRecord.completionDigest !==
      moduleExpertCompletionDigest(args.terminalCompletion)
  ) {
    throw new Error('Module expert completion authority is invalid.');
  }
  MODULE_EXPERT_JOURNAL_BINDINGS.delete(args.binding);
  MODULE_EXPERT_COMPLETION_AUTHORITIES.delete(args.execution.authority);
}

function moduleExpertCompletionDigest(
  completion: AgentExecutionCompletion,
): string {
  return createHash('sha256').update(JSON.stringify(completion)).digest('hex');
}

function moduleExpertIdentityDigest(
  identity: ModuleExpertRuntimeIdentity,
): string {
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function moduleExpertInstruction(context: ModuleExpertPromptContext): string {
  const profile = context.profile;
  return [
    `Assigned module expert: ${profile.name}`,
    `Description: ${profile.description}`,
    `Module roots: ${JSON.stringify(profile.moduleRoots)}`,
    `Additional scope: ${JSON.stringify(profile.scopePaths)}`,
    `Generated scope: ${JSON.stringify(profile.generatedScopePaths.map((scope) => scope.path))}`,
    `Excluded paths: ${JSON.stringify(profile.excludedPaths)}`,
    `Public entry points: ${JSON.stringify(profile.publicEntryPoints)}`,
    `Authority paths: ${JSON.stringify(profile.authorityPaths)}`,
    `Skill paths: ${JSON.stringify(profile.skillPaths)}`,
    `Focused validation selectors: ${JSON.stringify(profile.validationSelectors)}`,
    'Structured continuation: populate externalApi, dependencies, consumers, behaviorInvariants, securityInvariants, compatibilityInvariants, owningTests, focusedValidation, risks, unresolvedDecisions, and parentActions with at least one concrete entry each. Use an explicit none-with-reason entry when a category has no items.',
    'Parent actions are evidence for the delivery owner. They do not authorize scheduling, writes, or further delegation.',
    `Requested analysis:\n${context.instruction}`,
  ].join('\n\n');
}
