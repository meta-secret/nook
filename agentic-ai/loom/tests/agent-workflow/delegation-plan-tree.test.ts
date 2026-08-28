import { describe, expect, test } from 'bun:test';
import {
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
} from '../../src/agent-workflow/domain.ts';
import {
  DELEGATION_PLAN_SCHEMA_VERSION,
  DelegationBarrierPolicy,
} from '../../src/agent-workflow/delegation-domain.ts';
import type {
  DelegationAttemptDeclaration,
  DelegationAttemptIdentity,
  DelegationPlan,
} from '../../src/agent-workflow/delegation-domain.ts';
import { renderDelegationPlanTree } from '../../src/agent-workflow/delegation-plan-tree.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const ROOT: DelegationAttemptIdentity = {
  task: 'coordinate-delivery',
  agent: 'delivery-coordinator',
  attempt: 1,
};
const AI: DelegationAttemptIdentity = {
  task: 'update-cortex',
  agent: 'ai',
  attempt: 1,
};
const WEB: DelegationAttemptIdentity = {
  task: 'create_security-key_component',
  agent: 'web-dev',
  attempt: 1,
};
const CORE: DelegationAttemptIdentity = {
  task: 'auth-module-implementation',
  agent: 'core-dev',
  attempt: 1,
};
const REVIEW: DelegationAttemptIdentity = {
  task: 'review-auth-contract',
  agent: 'security',
  attempt: 1,
};

describe('delegation plan tree', () => {
  test('renders a root-only plan cleanly', () => {
    const rootInput: DeclarationInput = { identity: ROOT, depth: 1 };
    const root = declaration(rootInput);
    expect(renderDelegationPlanTree(plan([root]))).toBe(
      ['gizmo', '└─ delivery-coordinator', '  └─ coordinate delivery', ''].join(
        '\n',
      ),
    );
  });

  test('preserves plan order and actual parent-child hierarchy', () => {
    const rootInput: DeclarationInput = {
      identity: ROOT,
      depth: 1,
      children: [AI, WEB, CORE],
    };
    const aiInput: DeclarationInput = {
      identity: AI,
      depth: 2,
      parent: ROOT,
    };
    const webInput: DeclarationInput = {
      identity: WEB,
      depth: 2,
      children: [REVIEW],
      parent: ROOT,
    };
    const coreInput: DeclarationInput = {
      identity: CORE,
      depth: 2,
      parent: ROOT,
    };
    const reviewInput: DeclarationInput = {
      identity: REVIEW,
      depth: 3,
      parent: WEB,
    };
    const root = declaration(rootInput);
    const ai = declaration(aiInput);
    const web = declaration(webInput);
    const core = declaration(coreInput);
    const review = declaration(reviewInput);

    expect(renderDelegationPlanTree(plan([root, ai, web, core, review]))).toBe(
      [
        'gizmo',
        '└─ delivery-coordinator',
        '  └─ coordinate delivery',
        '     ├─ ai',
        '     │ └─ update cortex',
        '     ├─ web-dev',
        '     │ └─ create security key component',
        '     │    └─ security',
        '     │      └─ review auth contract',
        '     └─ core-dev',
        '       └─ auth module implementation',
        '',
      ].join('\n'),
    );
  });
});

type DeclarationInput = {
  readonly identity: DelegationAttemptIdentity;
  readonly depth: number;
  readonly children?: readonly DelegationAttemptIdentity[];
  readonly parent?: DelegationAttemptIdentity;
};

function declaration(input: DeclarationInput): DelegationAttemptDeclaration {
  const children = input.children ?? [];
  return {
    identity: input.identity,
    depth: input.depth,
    parent: input.parent
      ? { kind: AgentAttemptParentKind.AgentAttempt, ...input.parent }
      : { kind: AgentAttemptParentKind.WorkflowRoot },
    terminalBarrier: {
      policy: DelegationBarrierPolicy.AllTerminal,
      attempts: children,
    },
  };
}

function plan(
  attempts: readonly DelegationAttemptDeclaration[],
): DelegationPlan {
  return {
    schemaVersion: DELEGATION_PLAN_SCHEMA_VERSION,
    workflow: DelegatedAgentWorkflowName.AgentWork,
    runId: 'visual-plan',
    sourceCommit: SOURCE_COMMIT,
    rootMaterializer: ROOT,
    attempts,
  };
}
