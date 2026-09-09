import { AgentAttemptParentKind } from './domain.ts';

import { DelegationPlanContract } from './delegation-domain.ts';

import type {
  DelegationAttemptDeclaration,
  DelegationAttemptIdentity,
  DelegationPlan,
} from './delegation-domain.ts';

export class DelegationPlanTree {
  private constructor(private readonly request: DelegationPlan) {}
  static render(plan: DelegationPlan): string {
    return new DelegationPlanTree(plan).execute();
  }
  private execute(): string {
    const plan = this.request;
    const lines = [TREE_ROOT];
    const root = plan.attempts.find((declaration) => {
      const identities = {
        first: declaration.identity,
        second: plan.rootMaterializer,
      };
      return DelegationPlanContract.delegationAttemptIdentitiesEqual(
        identities,
      );
    });
    if (!root) throw new Error('Delegation root materializer is missing.');
    const renderInput: RenderAttemptInput = {
      declaration: root,
      plan,
      prefix: '',
      lines,
      isLast: true,
    };
    this.renderAttempt(renderInput);
    return `${lines.join('\n')}\n`;
  }

  private renderAttempt(input: RenderAttemptInput): void {
    const connector = input.isLast ? '└─' : '├─';
    const continuation = input.isLast ? '  ' : '│ ';
    input.lines.push(
      `${input.prefix}${connector} ${input.declaration.identity.agent}`,
    );
    input.lines.push(
      `${input.prefix}${continuation}└─ ${this.humanizeTask(input.declaration.identity.task)}`,
    );
    const childInput: RenderChildrenInput = {
      parent: input.declaration.identity,
      plan: input.plan,
      prefix: `${input.prefix}${continuation}   `,
      lines: input.lines,
    };
    this.renderChildren(childInput);
  }

  private renderChildren(input: RenderChildrenInput): void {
    const children = input.plan.attempts.filter((declaration) => {
      if (declaration.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
        return false;
      }
      const identities = {
        first: declaration.parent,
        second: input.parent,
      };
      return DelegationPlanContract.delegationAttemptIdentitiesEqual(
        identities,
      );
    });

    const lastChild = children.at(-1);
    for (const child of children) {
      const childInput: RenderAttemptInput = {
        declaration: child,
        plan: input.plan,
        prefix: input.prefix,
        lines: input.lines,
        isLast: child === lastChild,
      };
      this.renderAttempt(childInput);
    }
  }

  private humanizeTask(task: string): string {
    return task.replaceAll(/[-_]+/g, ' ');
  }
}

const TREE_ROOT = 'gizmo';

type RenderAttemptInput = {
  readonly declaration: DelegationAttemptDeclaration;
  readonly plan: DelegationPlan;
  readonly prefix: string;
  readonly lines: string[];
  readonly isLast: boolean;
};

type RenderChildrenInput = {
  readonly parent: DelegationAttemptIdentity;
  readonly plan: DelegationPlan;
  readonly prefix: string;
  readonly lines: string[];
};
