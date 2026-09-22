import { join } from 'node:path';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  MaterializedViewPresence,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../agent-workflow/domain.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../agent-workflow/agent-attempt-version.ts';
import { VerifiedAttemptArtifacts } from '../agent-workflow/attempt-verification.ts';
import type {
  ReadParentAttemptArgs,
  VerifiedBarrierAttempt,
} from '../agent-workflow/attempt-verification.ts';
import { StructuralExpertKind } from './catalog.ts';
import type {
  StructuralChildProjection,
  StructuralExpertInvocationRequest,
} from './request-codec.ts';

export const STRUCTURAL_EXPERT_WORKFLOW_VERSION =
  CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION;

/** Child output read from the journal for a structural synthesis task. */
export type StructuralChildContext = Readonly<{
  readonly task: string;
  readonly expert: string;
  readonly attempt: number;
  readonly terminalKind: TaskTerminalKind.Completed | TaskTerminalKind.Failed;
  readonly resultJson: string;
  readonly viewMarkdown: string;
}>;

export type ReadStructuralExpertParentContextRequest = Readonly<{
  readonly runDirectory: string;
  readonly request: StructuralExpertInvocationRequest;
}>;

/** Projects ordinary parent and child journal output across the file boundary. */
export class StructuralExpertParentContext {
  private constructor() {}

  static async read(
    input: ReadStructuralExpertParentContextRequest,
  ): Promise<readonly StructuralChildContext[]> {
    const parentRead: ReadParentAttemptArgs = {
      runDirectory: input.runDirectory,
      runId: input.request.runId,
      workflowVersion: STRUCTURAL_EXPERT_WORKFLOW_VERSION,
      sourceCommit: input.request.sourceCommit,
      originMainSha: input.request.originMainSha,
      pinnedLocalDevSha: input.request.pinnedLocalDevSha,
      featureHeadSha: input.request.featureHeadSha,
      identity: {
        task: input.request.parent.task,
        agent: input.request.parent.agent,
        attempt: input.request.parent.attempt,
        depth: 1,
      },
    };
    const parent =
      await VerifiedAttemptArtifacts.readVerifiedParentAttempt(parentRead);
    if (
      parent.firstEvent.depth !== 1 ||
      parent.firstEvent.parent.kind !== AgentAttemptParentKind.WorkflowRoot ||
      parent.firstEvent.adapter ===
        AgentAttemptAdapterKind.ModuleExpertInvocation ||
      parent.firstEvent.adapter ===
        AgentAttemptAdapterKind.StructuralExpertInvocation ||
      parent.terminal.output.resultKind !==
        WorkflowResultKind.StructuralExpertPlan
    ) {
      StructuralExpertParentContext.failed();
    }
    if (input.request.kind === StructuralExpertKind.RepositoryEvidence) {
      return [];
    }
    return Promise.all(
      input.request.childProjections.map((projection) =>
        StructuralExpertParentContext.readChild({
          projection,
          request: input.request,
          runDirectory: input.runDirectory,
        }),
      ),
    );
  }

  private static async readChild(
    input: ReadStructuralChildContextRequest,
  ): Promise<StructuralChildContext> {
    const childRead: ReadParentAttemptArgs = {
      runDirectory: input.runDirectory,
      runId: input.request.runId,
      workflowVersion: STRUCTURAL_EXPERT_WORKFLOW_VERSION,
      sourceCommit: input.request.sourceCommit,
      originMainSha: input.request.originMainSha,
      pinnedLocalDevSha: input.request.pinnedLocalDevSha,
      featureHeadSha: input.request.featureHeadSha,
      identity: {
        task: input.projection.task,
        agent: input.projection.expert,
        attempt: input.projection.attempt,
        depth: 2,
      },
    };
    const child =
      await VerifiedAttemptArtifacts.readVerifiedBarrierAttempt(childRead);
    StructuralExpertParentContext.assertChild({
      child,
      input,
    });
    const terminal = child.terminal;
    if (
      terminal.kind !== TaskTerminalKind.Completed &&
      terminal.kind !== TaskTerminalKind.Failed
    ) {
      return StructuralExpertParentContext.failed();
    }
    return {
      task: input.projection.task,
      expert: input.projection.expert,
      attempt: input.projection.attempt,
      terminalKind: terminal.kind,
      resultJson: child.resultJson,
      viewMarkdown: child.viewMarkdown,
    };
  }

  private static assertChild(input: AssertStructuralChildContextRequest): void {
    const child = input.child;
    const terminal = child.terminal;
    if (
      terminal.kind !== TaskTerminalKind.Completed &&
      terminal.kind !== TaskTerminalKind.Failed
    ) {
      StructuralExpertParentContext.failed();
    }
    const validResult =
      terminal.kind === TaskTerminalKind.Failed ||
      (terminal.kind === TaskTerminalKind.Completed &&
        (terminal.output.resultKind ===
          WorkflowResultKind.CodeRefactoringEvidence ||
          terminal.output.resultKind ===
            WorkflowResultKind.CortexRefactoringEvidence));
    if (
      child.firstEvent.adapter !==
        AgentAttemptAdapterKind.StructuralExpertInvocation ||
      child.firstEvent.parent.kind !== AgentAttemptParentKind.AgentAttempt ||
      JSON.stringify(child.firstEvent.parent) !==
        JSON.stringify(input.input.request.parent) ||
      !validResult ||
      child.result.path !== input.input.projection.resultPath ||
      child.result.sha256 !== input.input.projection.resultSha256 ||
      child.view.presence !== MaterializedViewPresence.Recorded ||
      child.view.projection.path !== input.input.projection.viewPath ||
      child.view.projection.sha256 !== input.input.projection.viewSha256
    ) {
      StructuralExpertParentContext.failed();
    }
  }

  private static failed(): never {
    throw new Error('Structural expert parent context is invalid.');
  }
}

type ReadStructuralChildContextRequest = Readonly<{
  readonly projection: StructuralChildProjection;
  readonly request: StructuralExpertInvocationRequest;
  readonly runDirectory: string;
}>;

type AssertStructuralChildContextRequest = Readonly<{
  readonly child: VerifiedBarrierAttempt;
  readonly input: ReadStructuralChildContextRequest;
}>;
