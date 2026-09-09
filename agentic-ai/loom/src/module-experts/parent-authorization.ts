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
  type ParentAttemptIdentity,
  type ReadParentAttemptArgs,
  type VerifiedParentAttempt,
  VerifiedAttemptArtifacts,
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

/** Owns the module expert parent authorization registry and its capability transitions. */
export class ModuleExpertParentAuthorization {
  private constructor() {}
  private static readonly VERIFIED_PARENT_AUTHORIZATIONS = new WeakMap<
    VerifiedModuleExpertParentAuthorization,
    string
  >();

  static async verifyModuleExpertParentAuthorization(
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
    const immediate =
      await VerifiedAttemptArtifacts.readVerifiedParentAttempt(immediateRead);
    const depthThreeArgs: ReadDepthThreeAuthorityArgs = { args, immediate };
    const authority =
      args.request.depth === 2
        ? immediate
        : await ModuleExpertParentAuthorization.readDepthThreeAuthority(
            depthThreeArgs,
          );
    if (
      authority.firstEvent.depth !== 1 ||
      authority.firstEvent.parent.kind !==
        AgentAttemptParentKind.WorkflowRoot ||
      authority.firstEvent.adapter ===
        AgentAttemptAdapterKind.ModuleExpertInvocation ||
      args.expertNames.includes(authority.firstEvent.agent) ||
      authority.terminal.output.resultKind !==
        WorkflowResultKind.ModuleDevelopmentPlan
    ) {
      ModuleExpertParentAuthorization.authorizationFailed();
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
          JSON.stringify(authorization) ===
          JSON.stringify(expectedAuthorization),
      )
    ) {
      ModuleExpertParentAuthorization.authorizationFailed();
    }
    const authorizationValue = {
      kind: ModuleExpertParentAuthorizationKind.Verified,
    } as const;
    const authorization: VerifiedModuleExpertParentAuthorization =
      Object.freeze(authorizationValue);
    ModuleExpertParentAuthorization.VERIFIED_PARENT_AUTHORIZATIONS.set(
      authorization,
      ModuleExpertParentAuthorization.parentAuthorizationDigest(args),
    );
    return authorization;
  }

  static consumeModuleExpertParentAuthorization(
    args: ConsumeModuleExpertParentAuthorizationArgs,
  ): void {
    const expected =
      ModuleExpertParentAuthorization.parentAuthorizationDigest(args);
    if (
      ModuleExpertParentAuthorization.VERIFIED_PARENT_AUTHORIZATIONS.get(
        args.authorization,
      ) !== expected
    ) {
      ModuleExpertParentAuthorization.authorizationFailed();
    }
    ModuleExpertParentAuthorization.VERIFIED_PARENT_AUTHORIZATIONS.delete(
      args.authorization,
    );
  }

  private static async readDepthThreeAuthority(
    input: ReadDepthThreeAuthorityArgs,
  ): Promise<VerifiedParentAttempt> {
    if (
      input.immediate.firstEvent.parent.kind !==
        AgentAttemptParentKind.AgentAttempt ||
      !input.args.expertNames.includes(input.immediate.firstEvent.agent) ||
      input.immediate.terminal.output.resultKind !==
        WorkflowResultKind.ModuleExpertEvidence
    ) {
      ModuleExpertParentAuthorization.authorizationFailed();
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
    return VerifiedAttemptArtifacts.readVerifiedParentAttempt(authorityRead);
  }

  private static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private static parentAuthorizationDigest(
    args: VerifyModuleExpertParentAuthorizationArgs,
  ): string {
    const identity = {
      runDirectory: args.runDirectory,
      workflowVersion: args.workflowVersion,
      request: args.request,
      expertNames: args.expertNames,
    };
    return ModuleExpertParentAuthorization.sha256(JSON.stringify(identity));
  }

  private static authorizationFailed(): never {
    throw new Error('Module expert parent authorization failed.');
  }
}

type ReadDepthThreeAuthorityArgs = {
  readonly args: VerifyModuleExpertParentAuthorizationArgs;
  readonly immediate: VerifiedParentAttempt;
};
