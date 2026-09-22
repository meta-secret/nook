import type {
  AgentExecutionCompletion,
  AgentExecutionFailure,
  AgentExecutionInvocation,
  RuntimeActivityObserver,
} from '../agent-workflow/runtime.ts';
import type { Result } from 'neverthrow';
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
import {
  ReadOnlyExpertCodexRuntime,
  type RunIsolatedReadOnlyExpertCodexRequest,
} from '../agent-workflow/codex-runtime.ts';
import type { ReadOnlyExpertContextFile } from '../module-experts/runtime-contract.ts';
import { StructuralExpertContract } from './audit.ts';
import { StructuralExpertKind, StructuralExpertCatalog } from './catalog.ts';
import type { StructuralExpertProfile } from './catalog.ts';
import { STRUCTURAL_EXPERT_WORKFLOW_VERSION } from './parent-context.ts';
import type { StructuralChildContext } from './parent-context.ts';
import { StructuralExpertRequestDecoder } from './request-codec.ts';
import type { StructuralExpertInvocationRequest } from './request-codec.ts';

/** Plain task data passed through the trusted in-process handoff. */
export type StructuralRuntimeSession = Readonly<{
  readonly invocation: AgentExecutionInvocation<string, string>;
  readonly isolationRequest: RunIsolatedReadOnlyExpertCodexRequest<
    string,
    string
  >['isolationRequest'];
}>;

export type CreateStructuralRuntimeSessionRequest = Readonly<{
  readonly repoRoot: string;
  readonly request: StructuralExpertInvocationRequest;
  readonly childContexts: readonly StructuralChildContext[];
}>;

export type CreatedStructuralRuntimeSession = Readonly<{
  readonly session: StructuralRuntimeSession;
}>;

export type ExecuteStructuralExpertRequest = Readonly<{
  readonly session: StructuralRuntimeSession;
  readonly signal: AbortSignal;
  readonly observe: RuntimeActivityObserver;
}>;

/** Builds and runs one bounded structural expert task. */
export class StructuralExpertRuntime {
  private constructor() {}

  static createStructuralRuntimeSession(
    input: CreateStructuralRuntimeSessionRequest,
  ): CreatedStructuralRuntimeSession {
    const request =
      StructuralExpertRequestDecoder.validatedStructuralExpertInvocationRequest(
        input.request,
      );
    const repoRoot = resolve(input.repoRoot);
    const audit = StructuralExpertContract.auditStructuralExperts({ repoRoot });
    const profile = StructuralExpertCatalog.structuralExpertProfile(
      request.expert,
    );
    if (!audit.auditOk || !profile) {
      throw new Error('Structural expert runtime contract is invalid.');
    }
    const instruction = StructuralExpertRuntime.structuralInstruction({
      instruction: request.instruction,
      profile,
    });
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
      originMainSha: request.originMainSha,
      pinnedLocalDevSha: request.pinnedLocalDevSha,
      featureHeadSha: request.featureHeadSha,
      runId: request.runId,
      workingDirectory: repoRoot,
      upstreamOutputs: [],
      signal: AbortSignal.abort(),
      observe: async () => {},
      execution,
      agentProfile,
    };
    const isolationRequest = StructuralExpertRuntime.isolationRequest({
      childContexts: input.childContexts,
      profile,
      repoRoot,
      request,
    });
    return Object.freeze({
      session: Object.freeze({ invocation, isolationRequest }),
    });
  }

  static executeStructuralExpert(
    input: ExecuteStructuralExpertRequest,
  ): Promise<Result<AgentExecutionCompletion, AgentExecutionFailure>> {
    const invocation: AgentExecutionInvocation<string, string> = {
      ...input.session.invocation,
      signal: input.signal,
      observe: input.observe,
    };
    return ReadOnlyExpertCodexRuntime.executeIsolated({
      invocation,
      isolationRequest: input.session.isolationRequest,
    });
  }

  private static isolationRequest(
    input: Readonly<{
      readonly childContexts: readonly StructuralChildContext[];
      readonly profile: StructuralExpertProfile;
      readonly repoRoot: string;
      readonly request: StructuralExpertInvocationRequest;
    }>,
  ): RunIsolatedReadOnlyExpertCodexRequest<string, string>['isolationRequest'] {
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
      originMainSha: input.request.originMainSha,
      pinnedLocalDevSha: input.request.pinnedLocalDevSha,
      featureHeadSha: input.request.featureHeadSha,
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
        ? 'Context contains child result.json and view.md projections supplied by the parent. Treat missing coverage as a gap; never infer absent evidence.'
        : `Exact evidence files: ${JSON.stringify(input.profile.allowedEvidenceFiles)}\nStrict descendant roots: ${JSON.stringify(input.profile.allowedEvidenceDescendantRoots)}`,
      `Focused validation: ${JSON.stringify(input.profile.validationSelectors)}`,
      `Requested analysis:\n${input.instruction}`,
    ].join('\n\n');
  }
}

const STRUCTURAL_EXPERT_INSTRUCTIONS = `Act only as the assigned read-only Nook structural expert.
Use only the bounded context exposed by Loom at the exact source commit.
Return the required typed evidence and an agent-authored Markdown view.
Do not edit files, apply patches, delegate, schedule successors, or mutate Git, GitHub, Workbench, CI, deployment, or workflow processing.
Recommendations are evidence for the delivery owner and never grant authority.`;

type StructuralInstructionInput = Readonly<{
  readonly instruction: string;
  readonly profile: StructuralExpertProfile;
}>;
