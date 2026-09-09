import { join, resolve } from 'node:path';

import { AgentAttemptJournal } from '../../src/agent-workflow/agent-journal.ts';

import type { AgentAttemptJournalConfiguration } from '../../src/agent-workflow/agent-journal.ts';

import type { AgentAttemptJournalAdapter } from '../../src/agent-workflow/agent-journal.ts';

import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';

import type {
  AgentAttemptParent,
  ModuleExpertAuthorization,
  ModuleDevelopmentPlanTaskOutput,
  ModuleExpertTaskOutput,
  TaskTerminal,
  WorkflowTaskOutput,
} from '../../src/agent-workflow/domain.ts';

import type { ModuleExpertInvocationRequest } from '../../src/module-experts/invoke.ts';

import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../../src/agent-workflow/agent-attempt-version.ts';

export class ModuleExpertsInvokeParentFixtureScenario {
  private constructor(
    private readonly request: ModuleExpertInvocationRequest,
  ) {}

  static createAuthorizedDirectParent(
    request: ModuleExpertInvocationRequest,
  ): Promise<void> {
    return new ModuleExpertsInvokeParentFixtureScenario(request).execute();
  }

  private async execute(): Promise<void> {
    const request = this.request;
    if (request.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
      throw new Error('Expected direct parent attempt in the test fixture.');
    }
    const authorization: ModuleExpertAuthorization = {
      task: request.task,
      expert: request.expert,
      attempt: request.attempt,
      depth: request.depth,
      parent: request.parent,
    };
    const completedArgs: CreateCompletedAttemptArgs = {
      repoRoot: REPO_ROOT,
      runId: request.runId,
      sourceCommit: request.sourceCommit,
      task: request.parent.task,
      agent: request.parent.agent,
      attempt: request.parent.attempt,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
      output:
        ModuleExpertsInvokeParentFixtureScenario.moduleDevelopmentPlanOutput([
          authorization,
        ]),
    };
    await ModuleExpertsInvokeParentFixtureScenario.createCompletedAttempt(
      completedArgs,
    );
  }

  static async createCompletedAttempt(
    args: CreateCompletedAttemptArgs,
  ): Promise<void> {
    const adapterArgs: CreateJournalArgs = {
      ...args,
      adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
    };
    const journal =
      await ModuleExpertsInvokeParentFixtureScenario.createJournal(adapterArgs);
    const terminal: TaskTerminal<string> = {
      kind: TaskTerminalKind.Completed,
      task: args.task,
      attempt: args.attempt,
      threadId: `thread-${args.task}`,
      output: args.output,
    };
    await journal.finalize(terminal);
  }

  static async createFailedAttempt(
    args: CreateFailedAttemptArgs,
  ): Promise<void> {
    const adapterArgs: CreateJournalArgs = {
      ...args,
      adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
    };
    const journal =
      await ModuleExpertsInvokeParentFixtureScenario.createJournal(adapterArgs);
    const terminal: TaskTerminal<string> = {
      kind: TaskTerminalKind.Failed,
      task: args.task,
      attempt: args.attempt,
      summary: 'Parent planning failed.',
    };
    await journal.finalize(terminal);
  }

  static moduleDevelopmentPlanOutput(
    authorizations: ModuleDevelopmentPlanTaskOutput['moduleExpertAuthorizations'],
  ): ModuleDevelopmentPlanTaskOutput {
    return {
      resultKind: WorkflowResultKind.ModuleDevelopmentPlan,
      summary: 'Reviewed module expert plan.',
      materializedViewMarkdown: '# Module expert plan\n\nReviewed.',
      findings: [],
      notesForParent: [],
      artifacts: [],
      moduleExpertAuthorizations: authorizations,
    };
  }

  static moduleExpertEvidenceOutput(): ModuleExpertTaskOutput {
    return {
      summary: 'Inspected module boundary.',
      materializedViewMarkdown: '# Module boundary\n\nInspected.',
      findings: [],
      notesForParent: [],
      artifacts: [],
      resultKind: WorkflowResultKind.ModuleExpertEvidence,
      continuation: {
        externalApi: ['Public facade.'],
        dependencies: ['Direct provider.'],
        consumers: ['Immediate consumer.'],
        behaviorInvariants: ['Preserve behavior.'],
        securityInvariants: ['Preserve security.'],
        compatibilityInvariants: ['Preserve compatibility.'],
        owningTests: ['Provider tests.'],
        focusedValidation: ['Focused validation.'],
        risks: ['No additional risk.'],
        unresolvedDecisions: ['No unresolved decision.'],
        parentActions: ['Review this evidence without scheduling from it.'],
      },
    };
  }

  static async createJournal(
    args: CreateJournalArgs,
  ): Promise<AgentAttemptJournal<string>> {
    const runDirectory = join(
      args.repoRoot,
      'workflow',
      'processing',
      DelegatedAgentWorkflowName.AgentWork,
      args.runId,
    );
    const configuration: AgentAttemptJournalConfiguration = {
      adapter: args.adapter,
      runDirectory,
      runId: args.runId,
      workflow: DelegatedAgentWorkflowName.AgentWork,
      workflowVersion: MODULE_EXPERT_WORKFLOW_VERSION,
      sourceCommit: args.sourceCommit,
      task: args.task,
      agent: args.agent,
      attempt: args.attempt,
      depth: args.depth,
      parent: args.parent,
      now: () => new Date().toISOString(),
    };
    const journal = new AgentAttemptJournal<string>(configuration);
    await journal.initialize();
    return journal;
  }
}

const MODULE_EXPERT_WORKFLOW_VERSION = CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION;

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

export type CreateCompletedAttemptArgs = {
  readonly repoRoot: string;
  readonly runId: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly agent: string;
  readonly attempt: number;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly output: WorkflowTaskOutput;
};

export type CreateFailedAttemptArgs = Omit<
  CreateCompletedAttemptArgs,
  'output'
>;

type CreateJournalArgs = CreateFailedAttemptArgs & {
  readonly adapter: AgentAttemptJournalAdapter;
};
