import { AgentAttemptParentKind } from './domain.ts';
import { delegationAttemptIdentitiesEqual } from './delegation-domain.ts';
import type {
  DelegationAttemptDeclaration,
  DelegationAttemptIdentity,
  DelegationPlan,
} from './delegation-domain.ts';

const TREE_ROOT = 'gizmo';

export function renderDelegationPlanTree(plan: DelegationPlan): string {
  const lines = [TREE_ROOT];
  const root = plan.attempts.find((declaration) => {
    const identities = {
      first: declaration.identity,
      second: plan.rootMaterializer,
    };
    return delegationAttemptIdentitiesEqual(identities);
  });
  if (!root) throw new Error('Delegation root materializer is missing.');
  const renderInput: RenderAttemptInput = {
    declaration: root,
    plan,
    prefix: '',
    lines,
    isLast: true,
  };
  renderAttempt(renderInput);
  return `${lines.join('\n')}\n`;
}

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

function renderAttempt(input: RenderAttemptInput): void {
  const connector = input.isLast ? '└─' : '├─';
  const continuation = input.isLast ? '  ' : '│ ';
  input.lines.push(
    `${input.prefix}${connector} ${input.declaration.identity.agent}`,
  );
  input.lines.push(
    `${input.prefix}${continuation}└─ ${humanizeTask(input.declaration.identity.task)}`,
  );
  const childInput: RenderChildrenInput = {
    parent: input.declaration.identity,
    plan: input.plan,
    prefix: `${input.prefix}${continuation}   `,
    lines: input.lines,
  };
  renderChildren(childInput);
}

function renderChildren(input: RenderChildrenInput): void {
  const children = input.plan.attempts.filter((declaration) => {
    if (declaration.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
      return false;
    }
    const identities = {
      first: declaration.parent,
      second: input.parent,
    };
    return delegationAttemptIdentitiesEqual(identities);
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
    renderAttempt(childInput);
  }
}

function humanizeTask(task: string): string {
  return task.replaceAll(/[-_]+/g, ' ');
}
