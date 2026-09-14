import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, test } from 'bun:test';

import {
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
} from '../../src/agent-workflow/domain.ts';

import type {
  ModuleExpertAuthorization,
  ParentAgentAttempt,
} from '../../src/agent-workflow/domain.ts';

import type { ModuleExpertInvocationRequest } from '../../src/module-experts/invoke.ts';

import { ModuleExpertsInvokeParentFixtureScenario } from './invoke-parent-fixture.ts';

class ModuleExpertAuthorizationStorageScenario {
  private constructor(readonly request: ModuleExpertInvocationRequest) {}

  static create(runId: string): ModuleExpertAuthorizationStorageScenario {
    const request: ModuleExpertInvocationRequest = {
      runId,
      expert: 'core_expert',
      selectedContextPaths: [],
      sourceCommit: SOURCE_COMMIT,
      originMainSha: SOURCE_COMMIT,
      pinnedLocalDevSha: SOURCE_COMMIT,
      featureHeadSha: SOURCE_COMMIT,
      task: 'inspect-core-contract',
      attempt: 1,
      depth: 2,
      parent: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: 'feature-synthesis',
        agent: 'delivery-owner',
        attempt: 1,
      },
      instruction: 'Inspect the module contract without writing files.',
    };
    return new ModuleExpertAuthorizationStorageScenario(request);
  }

  static fromRequest(
    request: ModuleExpertInvocationRequest,
  ): ModuleExpertAuthorizationStorageScenario {
    return new ModuleExpertAuthorizationStorageScenario(request);
  }

  authorization(): ModuleExpertAuthorization {
    return {
      task: this.request.task,
      expert: this.request.expert,
      attempt: this.request.attempt,
      depth: this.request.depth,
      parent: this.directParent(),
    };
  }

  directParent(): ParentAgentAttempt {
    if (this.request.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
      throw new Error('Expected parent agent attempt in the test fixture.');
    }
    return this.request.parent;
  }

  runDirectory(): string {
    return join(
      REPO_ROOT,
      'workflow',
      'processing',
      DelegatedAgentWorkflowName.AgentWork,
      this.request.runId,
    );
  }
}

const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const REMOVE_RECURSIVELY: RmOptions = { recursive: true, force: true };

test('rejects authorization storage collisions before lineage materializes', async () => {
  const siblingScenario = ModuleExpertAuthorizationStorageScenario.create(
    `authorization-key-collision-${randomUUID()}`,
  );
  const siblingAuthorization = siblingScenario.authorization();
  const collidingSibling: ModuleExpertAuthorization = {
    ...siblingAuthorization,
    expert: 'web_expert',
    parent: {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: 'alternate-feature-synthesis',
      agent: 'alternate-delivery-owner',
      attempt: 2,
    },
  };
  const directScenario = ModuleExpertAuthorizationStorageScenario.create(
    `authorization-parent-key-${randomUUID()}`,
  );
  const parent = directScenario.directParent();
  const parentKeyRequest: ModuleExpertInvocationRequest = {
    ...directScenario.request,
    task: parent.task,
    attempt: parent.attempt,
  };
  const parentKeyScenario =
    ModuleExpertAuthorizationStorageScenario.fromRequest(parentKeyRequest);
  const cases: readonly AuthorizationStorageCollisionCase[] = [
    {
      scenario: siblingScenario,
      authorizations: [siblingAuthorization, collidingSibling],
      expectedMessage: 'journal storage keys must be unique',
    },
    {
      scenario: parentKeyScenario,
      authorizations: [parentKeyScenario.authorization()],
      expectedMessage: 'identity is invalid',
    },
  ];

  for (const testCase of cases) {
    const { request } = testCase.scenario;
    const runDirectory = testCase.scenario.runDirectory();
    const immediateParent = testCase.scenario.directParent();
    const completedArgs = {
      repoRoot: REPO_ROOT,
      runId: request.runId,
      sourceCommit: request.sourceCommit,
      task: immediateParent.task,
      agent: immediateParent.agent,
      attempt: immediateParent.attempt,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
      output:
        ModuleExpertsInvokeParentFixtureScenario.moduleDevelopmentPlanOutput(
          testCase.authorizations,
        ),
    } as const;
    try {
      await expect(
        ModuleExpertsInvokeParentFixtureScenario.createCompletedAttempt(
          completedArgs,
        ),
      ).rejects.toThrow(testCase.expectedMessage);
    } finally {
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  }
});

type AuthorizationStorageCollisionCase = {
  readonly scenario: ModuleExpertAuthorizationStorageScenario;
  readonly authorizations: readonly ModuleExpertAuthorization[];
  readonly expectedMessage: string;
};
