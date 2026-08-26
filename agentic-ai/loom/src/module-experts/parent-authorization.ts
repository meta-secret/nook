import { createHash } from 'node:crypto';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  WorkflowResultKind,
} from '../agent-workflow/domain.ts';
import type {
  ModuleExpertAuthorization,
  ParentAgentAttempt,
} from '../agent-workflow/domain.ts';
import {
  readVerifiedParentAttempt,
  type ParentAttemptIdentity,
  type ReadParentAttemptArgs,
  type VerifiedParentAttempt,
} from '../agent-workflow/attempt-verification.ts';

export type ModuleExpertChildRequest = {
  readonly runId: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly expert: string;
  readonly attempt: number;
  readonly depth: number;
  readonly parent: ParentAgentAttempt;
};

export type VerifyModuleExpertParentAuthorizationArgs = {
  readonly runDirectory: string;
  readonly workflowVersion: string;
  readonly request: ModuleExpertChildRequest;
  readonly expertNames: readonly string[];
};

export enum ModuleExpertParentAuthorizationKind {
  Verified = 'verified-module-expert-parent-authorization',
}

export type VerifiedModuleExpertParentAuthorization = {
  readonly kind: ModuleExpertParentAuthorizationKind.Verified;
};

export type ConsumeModuleExpertParentAuthorizationArgs =
  VerifyModuleExpertParentAuthorizationArgs & {
    readonly authorization: VerifiedModuleExpertParentAuthorization;
  };

const VERIFIED_PARENT_AUTHORIZATIONS = new WeakMap<
  VerifiedModuleExpertParentAuthorization,
  string
>();

export async function verifyModuleExpertParentAuthorization(
  args: VerifyModuleExpertParentAuthorizationArgs,
): Promise<VerifiedModuleExpertParentAuthorization> {
  const immediateIdentity: ParentAttemptIdentity = {
    task: args.request.parent.task,
    agent: args.request.parent.agent,
    attempt: args.request.parent.attempt,
    depth: args.request.depth - 1,
  };
  const immediateRead: ReadParentAttemptArgs = {
    runDirectory: args.runDirectory,
    runId: args.request.runId,
    workflowVersion: args.workflowVersion,
    sourceCommit: args.request.sourceCommit,
    identity: immediateIdentity,
  };
  const immediate = await readVerifiedParentAttempt(immediateRead);
  const depthThreeArgs: ReadDepthThreeAuthorityArgs = { args, immediate };
  const authority =
    args.request.depth === 2
      ? immediate
      : await readDepthThreeAuthority(depthThreeArgs);
  if (
    authority.firstEvent.depth !== 1 ||
    authority.firstEvent.parent.kind !== AgentAttemptParentKind.WorkflowRoot ||
    authority.firstEvent.adapter ===
      AgentAttemptAdapterKind.ModuleExpertInvocation ||
    args.expertNames.includes(authority.firstEvent.agent) ||
    authority.terminal.output.resultKind !==
      WorkflowResultKind.ModuleDevelopmentPlan
  ) {
    authorizationFailed();
  }
  const expectedAuthorization: ModuleExpertAuthorization = {
    task: args.request.task,
    expert: args.request.expert,
    attempt: args.request.attempt,
    depth: args.request.depth,
    parent: args.request.parent,
  };
  if (
    !authority.terminal.output.moduleExpertAuthorizations.some(
      (authorization) =>
        JSON.stringify(authorization) === JSON.stringify(expectedAuthorization),
    )
  ) {
    authorizationFailed();
  }
  const authorizationValue = {
    kind: ModuleExpertParentAuthorizationKind.Verified,
  } as const;
  const authorization: VerifiedModuleExpertParentAuthorization =
    Object.freeze(authorizationValue);
  VERIFIED_PARENT_AUTHORIZATIONS.set(
    authorization,
    parentAuthorizationDigest(args),
  );
  return authorization;
}

export function consumeModuleExpertParentAuthorization(
  args: ConsumeModuleExpertParentAuthorizationArgs,
): void {
  const expected = parentAuthorizationDigest(args);
  if (VERIFIED_PARENT_AUTHORIZATIONS.get(args.authorization) !== expected) {
    authorizationFailed();
  }
  VERIFIED_PARENT_AUTHORIZATIONS.delete(args.authorization);
}

type ReadDepthThreeAuthorityArgs = {
  readonly args: VerifyModuleExpertParentAuthorizationArgs;
  readonly immediate: VerifiedParentAttempt;
};

async function readDepthThreeAuthority(
  input: ReadDepthThreeAuthorityArgs,
): Promise<VerifiedParentAttempt> {
  if (
    input.immediate.firstEvent.parent.kind !==
      AgentAttemptParentKind.AgentAttempt ||
    !input.args.expertNames.includes(input.immediate.firstEvent.agent) ||
    input.immediate.terminal.output.resultKind !==
      WorkflowResultKind.ModuleExpertEvidence
  ) {
    authorizationFailed();
  }
  const authorityIdentity: ParentAttemptIdentity = {
    task: input.immediate.firstEvent.parent.task,
    agent: input.immediate.firstEvent.parent.agent,
    attempt: input.immediate.firstEvent.parent.attempt,
    depth: 1,
  };
  const authorityRead: ReadParentAttemptArgs = {
    runDirectory: input.args.runDirectory,
    runId: input.args.request.runId,
    workflowVersion: input.args.workflowVersion,
    sourceCommit: input.args.request.sourceCommit,
    identity: authorityIdentity,
  };
  return readVerifiedParentAttempt(authorityRead);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parentAuthorizationDigest(
  args: VerifyModuleExpertParentAuthorizationArgs,
): string {
  const identity = {
    runDirectory: args.runDirectory,
    workflowVersion: args.workflowVersion,
    request: args.request,
    expertNames: args.expertNames,
  };
  return sha256(JSON.stringify(identity));
}

function authorizationFailed(): never {
  throw new Error('Module expert parent authorization failed.');
}
