import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  MaterializedViewPresence,
  StructuralExpertAuthorizationKind,
  WorkflowResultKind,
  TaskTerminalKind,
} from '../agent-workflow/domain.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../agent-workflow/agent-attempt-version.ts';
import type { StructuralExpertAuthorization } from '../agent-workflow/domain.ts';
import { VerifiedAttemptArtifacts } from '../agent-workflow/attempt-verification.ts';
import type {
  ReadParentAttemptArgs,
  VerifiedBarrierAttempt,
} from '../agent-workflow/attempt-verification.ts';
import { StructuralExpertKind, StructuralExpertCatalog } from './catalog.ts';
import type {
  StructuralChildProjection,
  StructuralExpertInvocationRequest,
} from './request-codec.ts';
import { StructuralExpertRequestDecoder } from './request-codec.ts';

export const STRUCTURAL_EXPERT_WORKFLOW_VERSION =
  CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION;

export enum StructuralParentAuthorizationKind {
  Verified = 'verified-structural-parent-authorization',
}

export class VerifiedStructuralParentAuthorization {
  readonly kind = StructuralParentAuthorizationKind.Verified;
  private seal(): void {
    Object.freeze(this);
  }
  private constructor() {}
  static issue(
    key: typeof AUTHORITY_ISSUANCE,
  ): VerifiedStructuralParentAuthorization {
    if (key !== AUTHORITY_ISSUANCE)
      throw new Error('Invalid capability issuance.');
    const capability = new VerifiedStructuralParentAuthorization();
    capability.seal();
    return capability;
  }
}

export type VerifiedStructuralChildContext = {
  readonly task: string;
  readonly expert: string;
  readonly attempt: number;
  readonly terminalKind: TaskTerminalKind.Completed | TaskTerminalKind.Failed;
  readonly resultJson: string;
  readonly viewMarkdown: string;
};

export type VerifyStructuralParentAuthorizationRequest = {
  readonly runDirectory: string;
  readonly request: StructuralExpertInvocationRequest;
};

export type ConsumeStructuralParentAuthorizationRequest =
  VerifyStructuralParentAuthorizationRequest & {
    readonly authorization: VerifiedStructuralParentAuthorization;
  };

type StructuralAuthorizationRecord = {
  readonly digest: string;
  readonly childContexts: readonly VerifiedStructuralChildContext[];
};

/** Owns the structural expert parent authorization registry and its capability transitions. */
export class StructuralExpertParentAuthorization {
  private constructor() {}
  private static readonly VERIFIED_AUTHORIZATIONS = new WeakMap<
    VerifiedStructuralParentAuthorization,
    StructuralAuthorizationRecord
  >();

  static async verifyStructuralParentAuthorization(
    input: VerifyStructuralParentAuthorizationRequest,
  ): Promise<VerifiedStructuralParentAuthorization> {
    const parentRead: ReadParentAttemptArgs = {
      runDirectory: input.runDirectory,
      runId: input.request.runId,
      workflowVersion: STRUCTURAL_EXPERT_WORKFLOW_VERSION,
      sourceCommit: input.request.sourceCommit,
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
      StructuralExpertParentAuthorization.authorizationFailed();
    }
    const expected: StructuralExpertAuthorization =
      input.request.kind === StructuralExpertKind.RepositoryEvidence
        ? {
            task: input.request.task,
            expert: input.request.expert,
            attempt: input.request.attempt,
            depth: 2,
            parent: input.request.parent,
            kind: StructuralExpertAuthorizationKind.RepositoryEvidence,
            evidencePaths: input.request.evidencePaths,
          }
        : {
            task: input.request.task,
            expert: input.request.expert,
            attempt: input.request.attempt,
            depth: 2,
            parent: input.request.parent,
            kind: StructuralExpertAuthorizationKind.VerifiedViewSynthesis,
            childLanes: input.request.childProjections.map((projection) => ({
              task: projection.task,
              expert: projection.expert,
              attempt: projection.attempt,
            })),
          };
    if (
      !parent.terminal.output.structuralExpertAuthorizations.some(
        (authorization) =>
          JSON.stringify(authorization) === JSON.stringify(expected),
      )
    ) {
      StructuralExpertParentAuthorization.authorizationFailed();
    }
    const profile = StructuralExpertCatalog.structuralExpertProfile(
      input.request.expert,
    );
    if (
      !profile ||
      (profile.kind === StructuralExpertKind.RepositoryEvidence &&
        input.request.kind !== StructuralExpertKind.RepositoryEvidence) ||
      (profile.kind === StructuralExpertKind.VerifiedViewSynthesis &&
        input.request.kind !== StructuralExpertKind.VerifiedViewSynthesis)
    ) {
      StructuralExpertParentAuthorization.authorizationFailed();
    }
    let childContexts: readonly VerifiedStructuralChildContext[] = [];
    if (input.request.kind === StructuralExpertKind.VerifiedViewSynthesis) {
      const childVerificationRequest: VerifyChildProjectionsRequest = {
        projections: input.request.childProjections,
        request: input.request,
        runDirectory: input.runDirectory,
      };
      childContexts =
        await StructuralExpertParentAuthorization.verifyChildProjections(
          childVerificationRequest,
        );
    }
    const value =
      VerifiedStructuralParentAuthorization.issue(AUTHORITY_ISSUANCE);
    const authorization: VerifiedStructuralParentAuthorization = value;
    const authorizationRecord: StructuralAuthorizationRecord = {
      digest: StructuralExpertParentAuthorization.authorizationDigest(input),
      childContexts,
    };
    StructuralExpertParentAuthorization.VERIFIED_AUTHORIZATIONS.set(
      authorization,
      authorizationRecord,
    );
    return authorization;
  }

  static consumeStructuralParentAuthorization(
    input: ConsumeStructuralParentAuthorizationRequest,
  ): readonly VerifiedStructuralChildContext[] {
    const record =
      StructuralExpertParentAuthorization.VERIFIED_AUTHORIZATIONS.get(
        input.authorization,
      );
    if (
      !record ||
      record.digest !==
        StructuralExpertParentAuthorization.authorizationDigest(input)
    ) {
      StructuralExpertParentAuthorization.authorizationFailed();
    }
    StructuralExpertParentAuthorization.VERIFIED_AUTHORIZATIONS.delete(
      input.authorization,
    );
    return record.childContexts;
  }

  private static async verifyChildProjections(
    input: VerifyChildProjectionsRequest,
  ): Promise<readonly VerifiedStructuralChildContext[]> {
    return Promise.all(
      input.projections.map(async (projection) => {
        const readRequest: ReadParentAttemptArgs = {
          runDirectory: input.runDirectory,
          runId: input.request.runId,
          workflowVersion: STRUCTURAL_EXPERT_WORKFLOW_VERSION,
          sourceCommit: input.request.sourceCommit,
          identity: {
            task: projection.task,
            agent: projection.expert,
            attempt: projection.attempt,
            depth: 2,
          },
        };
        const child =
          await VerifiedAttemptArtifacts.readVerifiedBarrierAttempt(
            readRequest,
          );
        if (
          child.terminal.kind !== TaskTerminalKind.Completed &&
          child.terminal.kind !== TaskTerminalKind.Failed
        ) {
          StructuralExpertParentAuthorization.authorizationFailed();
        }
        const assertionRequest: AssertVerifiedChildRequest = {
          child,
          input,
          projection,
        };
        StructuralExpertParentAuthorization.assertVerifiedChild(
          assertionRequest,
        );
        return {
          task: projection.task,
          expert: projection.expert,
          attempt: projection.attempt,
          terminalKind: child.terminal.kind,
          resultJson: child.resultJson,
          viewMarkdown: child.viewMarkdown,
        };
      }),
    );
  }

  private static assertVerifiedChild(
    request: AssertVerifiedChildRequest,
  ): void {
    const { child, input, projection } = request;
    if (
      child.terminal.kind !== TaskTerminalKind.Completed &&
      child.terminal.kind !== TaskTerminalKind.Failed
    ) {
      StructuralExpertParentAuthorization.authorizationFailed();
    }
    const validResult =
      child.terminal.kind === TaskTerminalKind.Failed ||
      child.terminal.output.resultKind ===
        WorkflowResultKind.CodeRefactoringEvidence ||
      child.terminal.output.resultKind ===
        WorkflowResultKind.CortexRefactoringEvidence;
    if (
      child.firstEvent.adapter !==
        AgentAttemptAdapterKind.StructuralExpertInvocation ||
      child.firstEvent.parent.kind !== AgentAttemptParentKind.AgentAttempt ||
      JSON.stringify(child.firstEvent.parent) !==
        JSON.stringify(input.request.parent) ||
      !validResult ||
      child.result.path !== projection.resultPath ||
      child.result.sha256 !== projection.resultSha256 ||
      child.view.presence !== MaterializedViewPresence.Recorded ||
      child.view.projection.path !== projection.viewPath ||
      child.view.projection.sha256 !== projection.viewSha256
    ) {
      StructuralExpertParentAuthorization.authorizationFailed();
    }
  }

  private static authorizationDigest(
    input: VerifyStructuralParentAuthorizationRequest,
  ): string {
    const request =
      StructuralExpertRequestDecoder.validatedStructuralExpertInvocationRequest(
        input.request,
      );
    const identity = {
      runDirectory: join(input.runDirectory),
      workflow: DelegatedAgentWorkflowName.AgentWork,
      request,
    };
    return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  }

  private static authorizationFailed(): never {
    throw new Error('Structural expert parent authorization failed.');
  }
}

type VerifyChildProjectionsRequest = {
  readonly projections: readonly StructuralChildProjection[];
  readonly request: StructuralExpertInvocationRequest;
  readonly runDirectory: string;
};

type AssertVerifiedChildRequest = {
  readonly child: VerifiedBarrierAttempt;
  readonly input: VerifyChildProjectionsRequest;
  readonly projection: StructuralChildProjection;
};

const AUTHORITY_ISSUANCE = Symbol('expert-authority-issuance');
