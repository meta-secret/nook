import type { Result } from 'neverthrow';
import type {
  AgentExecutionCompletion,
  AgentExecutionFailure,
  AgentExecutionInvocation,
  RuntimeActivityObserver,
} from '../agent-workflow/runtime.ts';
import { resolve } from 'node:path';
import {
  AgentReasoningEffort,
  AgentWorkspacePolicy,
  WorkflowExecutorKind,
  WorkflowResultKind,
} from '../agent-workflow/domain.ts';
import type {
  AgentProfile,
  AgentTaskExecution,
} from '../agent-workflow/domain.ts';
import { ModuleExpertCodexSdkAgentRuntime } from '../agent-workflow/codex-runtime.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../agent-workflow/agent-attempt-version.ts';
import { ModuleExpertContract } from './audit.ts';
import {
  MODULE_EXPERT_AGENT_INSTRUCTIONS,
  MODULE_EXPERT_CATALOG,
  WEB_EXPERT_SKILL_PATHS,
} from './catalog.ts';
import type { ModuleExpertProfile } from './catalog.ts';
import { ModuleExpertRequestDecoder } from './request-codec.ts';
import type { ModuleExpertInvocationRequest } from './request-codec.ts';

export const MODULE_EXPERT_WORKFLOW_VERSION =
  CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION;

/** Plain task data passed through the trusted in-process handoff. */
export type ModuleExpertRuntimeSession = Readonly<{
  readonly invocation: AgentExecutionInvocation<string, string>;
  readonly selectedContextPaths: readonly string[];
}>;

export type CreateModuleExpertRuntimeSessionArgs = Readonly<{
  readonly repoRoot: string;
  readonly request: ModuleExpertInvocationRequest;
}>;

export type CreatedModuleExpertRuntimeSession = Readonly<{
  readonly session: ModuleExpertRuntimeSession;
}>;

export type ExecuteModuleExpertAgentArgs = Readonly<{
  readonly session: ModuleExpertRuntimeSession;
  readonly signal: AbortSignal;
  readonly observe: RuntimeActivityObserver;
}>;

/** Builds and runs one bounded module expert task. */
export class ModuleExpertRuntime {
  private constructor() {}

  static createModuleExpertRuntimeSession(
    args: CreateModuleExpertRuntimeSessionArgs,
  ): CreatedModuleExpertRuntimeSession {
    const request =
      ModuleExpertRequestDecoder.validatedModuleExpertInvocationRequest(
        args.request,
      );
    if (request.parent.kind !== 'agent-attempt') {
      throw new Error('Module expert runtime parent shape is invalid.');
    }
    const repoRoot = resolve(args.repoRoot);
    const audit = ModuleExpertContract.auditModuleExperts({ repoRoot });
    const profile = MODULE_EXPERT_CATALOG.find(
      (candidate) => candidate.name === request.expert,
    );
    if (!audit.auditOk || !profile) {
      throw new Error('Module expert runtime contract is invalid.');
    }
    const selectedContextPaths = Object.freeze([
      ...request.selectedContextPaths,
    ]);
    const instruction = ModuleExpertRuntime.moduleExpertInstruction({
      profile,
      instruction: request.instruction,
      selectedContextPaths,
    });
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
    return Object.freeze({
      session: Object.freeze({ invocation, selectedContextPaths }),
    });
  }

  static executeModuleExpertAgent(
    args: ExecuteModuleExpertAgentArgs,
  ): Promise<Result<AgentExecutionCompletion, AgentExecutionFailure>> {
    const invocation: AgentExecutionInvocation<string, string> = {
      ...args.session.invocation,
      signal: args.signal,
      observe: args.observe,
    };
    return ModuleExpertCodexSdkAgentRuntime.executeIsolated({
      invocation,
      selectedContextPaths: args.session.selectedContextPaths,
    });
  }

  private static moduleExpertInstruction(
    context: Readonly<{
      readonly profile: ModuleExpertProfile;
      readonly instruction: string;
      readonly selectedContextPaths: readonly string[];
    }>,
  ): string {
    const selectedSkillPaths = context.selectedContextPaths.filter((path) =>
      WEB_EXPERT_SKILL_PATHS.some((skillPath) => skillPath === path),
    );
    return [
      `Assigned module expert: ${context.profile.name}`,
      `Description: ${context.profile.description}`,
      `Module roots: ${JSON.stringify(context.profile.moduleRoots)}`,
      `Additional scope: ${JSON.stringify(context.profile.scopePaths)}`,
      `Selected task context: ${JSON.stringify(context.selectedContextPaths)}`,
      `Task-selected skill paths: ${JSON.stringify(selectedSkillPaths)}`,
      `Generated scope: ${JSON.stringify(context.profile.generatedScopePaths.map((scope) => scope.path))}`,
      `Excluded paths: ${JSON.stringify(context.profile.excludedPaths)}`,
      `Public entry points: ${JSON.stringify(context.profile.publicEntryPoints)}`,
      `Authority paths: ${JSON.stringify(context.profile.authorityPaths)}`,
      `Skill paths: ${JSON.stringify(context.profile.skillPaths)}`,
      `Focused validation selectors: ${JSON.stringify(context.profile.validationSelectors)}`,
      'Structured continuation: populate externalApi, dependencies, consumers, behaviorInvariants, securityInvariants, compatibilityInvariants, owningTests, focusedValidation, risks, unresolvedDecisions, and parentActions with at least one concrete entry each. Use an explicit none-with-reason entry when a category has no items.',
      'Parent actions are evidence for the delivery owner. They do not authorize scheduling, writes, or further delegation.',
      `Requested analysis:\n${context.instruction}`,
    ].join('\n\n');
  }
}
