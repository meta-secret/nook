import {
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
} from './domain.ts';

import type { AgentAttemptParent } from './domain.ts';

export class DelegationPlanContract {
  private constructor(private readonly request: DelegationPlan) {}

  static validateDelegationPlan(plan: DelegationPlan): void {
    return new DelegationPlanContract(plan).execute();
  }

  private execute(): void {
    const plan = this.request;
    DelegationPlanContract.assertPlanIdentity(plan);
    if (
      plan.attempts.length < 1 ||
      plan.attempts.length > MAX_DELEGATION_ATTEMPTS
    ) {
      throw new Error(
        'Delegation plans must declare between 1 and 16 attempts.',
      );
    }

    const declarations = new Map<string, DelegationAttemptDeclaration>();
    for (const declaration of plan.attempts) {
      DelegationPlanContract.assertDeclaration(declaration);
      const storageKey = DelegationPlanContract.attemptStorageKey(
        declaration.identity,
      );
      if (declarations.has(storageKey)) {
        throw new Error(
          `Delegation attempt is declared more than once: ${storageKey}`,
        );
      }
      declarations.set(storageKey, declaration);
    }

    const context: DelegationPlanValidationContext = { plan, declarations };
    DelegationPlanContract.assertRootMaterializer(context);
    DelegationPlanContract.assertLineage(context);
    DelegationPlanContract.assertExactTerminalBarriers(context);
  }

  static delegationAttemptIdentityKey(
    identity: DelegationAttemptIdentity,
  ): string {
    return `${identity.task}:${identity.agent}:${identity.attempt}`;
  }

  static delegationAttemptIdentitiesEqual(
    identities: DelegationIdentityPair,
  ): boolean {
    return (
      identities.first.task === identities.second.task &&
      identities.first.agent === identities.second.agent &&
      identities.first.attempt === identities.second.attempt
    );
  }

  private static assertPlanIdentity(plan: DelegationPlan): void {
    if (
      plan.schemaVersion !== DELEGATION_PLAN_SCHEMA_VERSION ||
      plan.workflow !== DelegatedAgentWorkflowName.AgentWork
    ) {
      throw new Error('Delegation plan schema or workflow is unsupported.');
    }
    DelegationPlanContract.assertFilesystemIdentifier(plan.runId);
    if (!/^[0-9a-f]{40}$/.test(plan.sourceCommit)) {
      throw new Error(
        'Delegation plan source commit must be exactly 40 lowercase hex characters.',
      );
    }
    DelegationPlanContract.assertAttemptIdentity(plan.rootMaterializer);
  }

  private static assertDeclaration(
    declaration: DelegationAttemptDeclaration,
  ): void {
    DelegationPlanContract.assertAttemptIdentity(declaration.identity);
    if (
      !Number.isSafeInteger(declaration.depth) ||
      declaration.depth < 1 ||
      declaration.depth > MAX_DELEGATION_DEPTH
    ) {
      throw new Error(
        'Delegation attempt depth must be an integer from 1 through 3.',
      );
    }
    if (
      declaration.terminalBarrier.policy !== DelegationBarrierPolicy.AllTerminal
    ) {
      throw new Error('Delegation attempts require an all-terminal barrier.');
    }
    if (
      declaration.terminalBarrier.attempts.length >= MAX_DELEGATION_ATTEMPTS
    ) {
      throw new Error('Delegation terminal barrier is not bounded.');
    }
    if (declaration.parent.kind === AgentAttemptParentKind.AgentAttempt) {
      DelegationPlanContract.assertAttemptIdentity(declaration.parent);
    } else if (
      declaration.parent.kind !== AgentAttemptParentKind.WorkflowRoot
    ) {
      throw new Error('Delegation attempt parent kind is invalid.');
    }
  }

  private static assertAttemptIdentity(
    identity: DelegationAttemptIdentity,
  ): void {
    DelegationPlanContract.assertFilesystemIdentifier(identity.task);
    DelegationPlanContract.assertFilesystemIdentifier(identity.agent);
    if (!Number.isSafeInteger(identity.attempt) || identity.attempt < 1) {
      throw new Error('Delegation attempt number must be a positive integer.');
    }
  }

  private static assertFilesystemIdentifier(identifier: string): void {
    if (
      identifier.length > 128 ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(identifier)
    ) {
      throw new Error(`Unsafe delegation identifier: ${identifier}`);
    }
  }

  private static assertRootMaterializer(
    context: DelegationPlanValidationContext,
  ): void {
    const depthOne = context.plan.attempts.filter(
      (declaration) => declaration.depth === 1,
    );
    if (depthOne.length !== 1) {
      throw new Error(
        'Delegation plan must declare exactly one depth-1 root materializer.',
      );
    }
    const root = depthOne[0];
    if (!root) {
      throw new Error('Delegation root materializer is missing.');
    }
    const identityPair: DelegationIdentityPair = {
      first: root.identity,
      second: context.plan.rootMaterializer,
    };
    if (
      !DelegationPlanContract.delegationAttemptIdentitiesEqual(identityPair) ||
      root.parent.kind !== AgentAttemptParentKind.WorkflowRoot
    ) {
      throw new Error(
        'Delegation root materializer identity or parent is invalid.',
      );
    }
  }

  private static assertLineage(context: DelegationPlanValidationContext): void {
    for (const declaration of context.plan.attempts) {
      if (declaration.depth === 1) continue;
      if (declaration.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
        throw new Error(
          'Every non-root delegation attempt requires an agent-attempt parent.',
        );
      }
      const parent = context.declarations.get(
        DelegationPlanContract.attemptStorageKey(declaration.parent),
      );
      if (!parent) {
        throw new Error(
          `Delegation parent is not declared: ${DelegationPlanContract.delegationAttemptIdentityKey(declaration.parent)}`,
        );
      }
      const identityPair: DelegationIdentityPair = {
        first: parent.identity,
        second: declaration.parent,
      };
      if (
        !DelegationPlanContract.delegationAttemptIdentitiesEqual(identityPair)
      ) {
        throw new Error(
          'Delegation parent agent does not match the declared attempt.',
        );
      }
      if (declaration.depth !== parent.depth + 1) {
        throw new Error(
          'Delegation child depth must be exactly one greater than its parent depth.',
        );
      }
    }
  }

  private static assertExactTerminalBarriers(
    context: DelegationPlanValidationContext,
  ): void {
    for (const declaration of context.plan.attempts) {
      const childInput: DirectChildKeysInput = {
        parent: declaration,
        plan: context.plan,
      };
      const expected = DelegationPlanContract.directChildKeys(childInput);
      const actual = new Set<string>();
      for (const identity of declaration.terminalBarrier.attempts) {
        DelegationPlanContract.assertAttemptIdentity(identity);
        const key =
          DelegationPlanContract.delegationAttemptIdentityKey(identity);
        if (actual.has(key)) {
          throw new Error(
            `Delegation terminal barrier repeats an attempt: ${key}`,
          );
        }
        actual.add(key);
      }
      if (
        expected.size !== actual.size ||
        [...expected].some((key) => !actual.has(key))
      ) {
        throw new Error(
          `Delegation terminal barrier must name exactly the direct children of ${DelegationPlanContract.delegationAttemptIdentityKey(declaration.identity)}.`,
        );
      }
    }
  }

  private static directChildKeys(
    input: DirectChildKeysInput,
  ): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const candidate of input.plan.attempts) {
      if (candidate.parent.kind !== AgentAttemptParentKind.AgentAttempt)
        continue;
      const identityPair: DelegationIdentityPair = {
        first: candidate.parent,
        second: input.parent.identity,
      };
      if (
        DelegationPlanContract.delegationAttemptIdentitiesEqual(identityPair)
      ) {
        keys.add(
          DelegationPlanContract.delegationAttemptIdentityKey(
            candidate.identity,
          ),
        );
      }
    }
    return keys;
  }

  private static attemptStorageKey(
    identity: DelegationAttemptIdentity,
  ): string {
    return `${identity.task}:${identity.attempt}`;
  }
}

export const DELEGATION_PLAN_SCHEMA_VERSION = '1.0.0';

export const MAX_DELEGATION_ATTEMPTS = 16;

export const MAX_DELEGATION_DEPTH = 3;

export enum DelegationBarrierPolicy {
  AllTerminal = 'all-terminal',
}

export enum DelegationRunEventKind {
  PlanDeclared = 'plan-declared',
  AttemptAdmitted = 'attempt-admitted',
}

export type DelegationAttemptIdentity = {
  readonly task: string;
  readonly agent: string;
  readonly attempt: number;
};

export type DelegationTerminalBarrier = {
  readonly policy: DelegationBarrierPolicy.AllTerminal;
  readonly attempts: readonly DelegationAttemptIdentity[];
};

export type DelegationAttemptDeclaration = {
  readonly identity: DelegationAttemptIdentity;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly terminalBarrier: DelegationTerminalBarrier;
};

export type DelegationAdmissionRequest = {
  readonly runId: string;
  readonly sourceCommit: string;
  readonly identity: DelegationAttemptIdentity;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
};

export type DelegationPlan = {
  readonly schemaVersion: typeof DELEGATION_PLAN_SCHEMA_VERSION;
  readonly workflow: DelegatedAgentWorkflowName.AgentWork;
  readonly runId: string;
  readonly sourceCommit: string;
  readonly rootMaterializer: DelegationAttemptIdentity;
  readonly attempts: readonly DelegationAttemptDeclaration[];
};

export type DelegationRunEventMetadata = {
  readonly runId: string;
  readonly sourceCommit: string;
  readonly planSha256: string;
  readonly sequence: number;
  readonly occurredAt: string;
};

export type DelegationPlanDeclaredEvent = DelegationRunEventMetadata & {
  readonly kind: DelegationRunEventKind.PlanDeclared;
  readonly attemptCount: number;
  readonly rootMaterializer: DelegationAttemptIdentity;
};

export type DelegationAttemptAdmittedEvent = DelegationRunEventMetadata & {
  readonly kind: DelegationRunEventKind.AttemptAdmitted;
  readonly declaration: DelegationAttemptDeclaration;
};

export type DelegationRunEvent =
  | DelegationPlanDeclaredEvent
  | DelegationAttemptAdmittedEvent;

export type DelegationIdentityPair = {
  readonly first: DelegationAttemptIdentity;
  readonly second: DelegationAttemptIdentity;
};

type DelegationPlanValidationContext = {
  readonly plan: DelegationPlan;
  readonly declarations: ReadonlyMap<string, DelegationAttemptDeclaration>;
};

type DirectChildKeysInput = {
  readonly parent: DelegationAttemptDeclaration;
  readonly plan: DelegationPlan;
};
