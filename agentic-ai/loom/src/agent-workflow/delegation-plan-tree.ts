import { AgentAttemptParentKind } from './domain.ts';
import { delegationAttemptIdentitiesEqual } from './delegation-domain.ts';
import type {
  DelegationAttemptIdentity,
  DelegationPlan,
} from './delegation-domain.ts';

const TREE_ROOT = 'gizmo';

export function renderDelegationPlanTree(plan: DelegationPlan): string {
  const lines = [TREE_ROOT];
  const renderInput: RenderChildrenInput = {
    parent: plan.rootMaterializer,
    plan,
    prefix: '',
    lines,
  };
  renderChildren(renderInput);
  return `${lines.join('\n')}\n`;
}

type RenderChildrenInput = {
  readonly parent: DelegationAttemptIdentity;
  readonly plan: DelegationPlan;
  readonly prefix: string;
  readonly lines: string[];
};

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
    const isLast = child === lastChild;
    const connector = isLast ? '└─' : '├─';
    const continuation = isLast ? '  ' : '│ ';
    input.lines.push(`${input.prefix}${connector} ${child.identity.agent}`);
    input.lines.push(
      `${input.prefix}${continuation}└─ ${humanizeTask(child.identity.task)}`,
    );
    const childInput: RenderChildrenInput = {
      parent: child.identity,
      plan: input.plan,
      prefix: `${input.prefix}${continuation}   `,
      lines: input.lines,
    };
    renderChildren(childInput);
  }
}

function humanizeTask(task: string): string {
  return task.replaceAll(/[-_]+/g, ' ');
}
