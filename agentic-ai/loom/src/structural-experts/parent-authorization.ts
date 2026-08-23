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
import {
  readVerifiedBarrierAttempt,
  readVerifiedParentAttempt,
} from '../module-experts/parent-authorization.ts';
import type {
  ReadParentAttemptArgs,
  VerifiedBarrierAttempt,
  VerifiedParentAttempt,
} from '../module-experts/parent-authorization.ts';
import { StructuralExpertKind, structuralExpertProfile } from './catalog.ts';
import type {
  StructuralChildProjection,
  StructuralExpertInvocationRequest,
} from './request-codec.ts';
import { validatedStructuralExpertInvocationRequest } from './request-codec.ts';

export const STRUCTURAL_EXPERT_WORKFLOW_VERSION =
  CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION;

export enum StructuralParentAuthorizationKind {
  Verified = 'verified-structural-parent-authorization',
}

export type VerifiedStructuralParentAuthorization = {
  readonly kind: StructuralParentAuthorizationKind.Verified;
};

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

const VERIFIED_AUTHORIZATIONS = new WeakMap<
  VerifiedStructuralParentAuthorization,
  StructuralAuthorizationRecord
>();

export async function verifyStructuralParentAuthorization(
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
  const parent = await readVerifiedParentAttempt(parentRead);
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
    authorizationFailed();
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
    authorizationFailed();
  }
  const profile = structuralExpertProfile(input.request.expert);
  if (
    !profile ||
    (profile.kind === StructuralExpertKind.RepositoryEvidence &&
      input.request.kind !== StructuralExpertKind.RepositoryEvidence) ||
    (profile.kind === StructuralExpertKind.VerifiedViewSynthesis &&
      input.request.kind !== StructuralExpertKind.VerifiedViewSynthesis)
  ) {
    authorizationFailed();
  }
  let childContexts: readonly VerifiedStructuralChildContext[] = [];
  if (input.request.kind === StructuralExpertKind.VerifiedViewSynthesis) {
    const childVerificationRequest: VerifyChildProjectionsRequest = {
      projections: input.request.childProjections,
      request: input.request,
      runDirectory: input.runDirectory,
    };
    childContexts = await verifyChildProjections(childVerificationRequest);
  }
  const value = {
    kind: StructuralParentAuthorizationKind.Verified,
  } as const;
  const authorization: VerifiedStructuralParentAuthorization =
    Object.freeze(value);
  const authorizationRecord: StructuralAuthorizationRecord = {
    digest: authorizationDigest(input),
    childContexts,
  };
  VERIFIED_AUTHORIZATIONS.set(authorization, authorizationRecord);
  return authorization;
}

export function consumeStructuralParentAuthorization(
  input: ConsumeStructuralParentAuthorizationRequest,
): readonly VerifiedStructuralChildContext[] {
  const record = VERIFIED_AUTHORIZATIONS.get(input.authorization);
  if (!record || record.digest !== authorizationDigest(input)) {
    authorizationFailed();
  }
  VERIFIED_AUTHORIZATIONS.delete(input.authorization);
  return record.childContexts;
}

type VerifyChildProjectionsRequest = {
  readonly projections: readonly StructuralChildProjection[];
  readonly request: StructuralExpertInvocationRequest;
  readonly runDirectory: string;
};

async function verifyChildProjections(
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
      const child = await readVerifiedBarrierAttempt(readRequest);
      const assertionRequest: AssertVerifiedChildRequest = {
        child,
        input,
        projection,
      };
      assertVerifiedChild(assertionRequest);
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

type AssertVerifiedChildRequest = {
  readonly child: VerifiedBarrierAttempt;
  readonly input: VerifyChildProjectionsRequest;
  readonly projection: StructuralChildProjection;
};

function assertVerifiedChild(request: AssertVerifiedChildRequest): void {
  const { child, input, projection } = request;
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
    authorizationFailed();
  }
}

function authorizationDigest(
  input: VerifyStructuralParentAuthorizationRequest,
): string {
  const request = validatedStructuralExpertInvocationRequest(input.request);
  const identity = {
    runDirectory: join(input.runDirectory),
    workflow: DelegatedAgentWorkflowName.AgentWork,
    request,
  };
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function authorizationFailed(): never {
  throw new Error('Structural expert parent authorization failed.');
}
