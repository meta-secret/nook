import { randomUUID } from 'node:crypto';

import { existsSync } from 'node:fs';

import { rm } from 'node:fs/promises';

import type { RmOptions } from 'node:fs';

import { join, resolve } from 'node:path';

import { expect, test } from 'bun:test';

import {
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
} from '../../src/agent-workflow/domain.ts';

import type {
  AgentExecutionCompletion,
  AgentTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';

import { MODULE_EXPERT_CATALOG } from '../../src/module-experts/catalog.ts';

import type { ModuleExpertInvocationRequest } from '../../src/module-experts/invoke.ts';

import { ModuleExpertParentAuthorization } from '../../src/module-experts/parent-authorization.ts';

import type {
  ModuleExpertChildRequest,
  VerifiedModuleExpertParentAuthorization,
  VerifyModuleExpertParentAuthorizationArgs,
} from '../../src/module-experts/parent-authorization.ts';

import {
  MODULE_EXPERT_WORKFLOW_VERSION,
  ModuleExpertRuntimeAuthority,
} from '../../src/module-experts/trusted-runtime.ts';

import type {
  ConsumeModuleExpertCompletionAuthorityArgs,
  ConsumeModuleExpertJournalAuthorityArgs,
  CreateModuleExpertRuntimeSessionArgs,
  ExecuteModuleExpertAgentArgs,
  ModuleExpertCompletionAuthority,
  ModuleExpertJournalAuthority,
  ModuleExpertRuntimeSession,
  TrustedModuleExpertExecution,
} from '../../src/module-experts/trusted-runtime.ts';

import { ModuleExpertsInvokeParentFixtureScenario } from './invoke-parent-fixture.ts';

import { ModuleExpertsModuleExpertRuntimeMockScenario } from './module-expert-runtime-mock.ts';

import type { RegisterModuleExpertRuntimeMockArgs } from './module-expert-runtime-mock.ts';

import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../../src/agent-workflow/agent-attempt-version.ts';

export class ModuleExpertsTrustedRuntimeScenario {
  private constructor(private readonly request: string) {}

  static async verifiedParentAuthorization(
    request: ModuleExpertInvocationRequest,
  ): Promise<VerifiedModuleExpertParentAuthorization> {
    if (request.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
      throw new Error('Expected direct parent identity.');
    }
    const childRequest: ModuleExpertChildRequest = {
      runId: request.runId,
      sourceCommit: request.sourceCommit,
      task: request.task,
      expert: request.expert,
      attempt: request.attempt,
      depth: request.depth,
      parent: request.parent,
    };
    const verifyArgs: VerifyModuleExpertParentAuthorizationArgs = {
      runDirectory: ModuleExpertsTrustedRuntimeScenario.processingRunDirectory(
        request.runId,
      ),
      workflowVersion: MODULE_EXPERT_WORKFLOW_VERSION,
      request: childRequest,
      expertNames: MODULE_EXPERT_CATALOG.map((profile) => profile.name),
    };
    return ModuleExpertParentAuthorization.verifyModuleExpertParentAuthorization(
      verifyArgs,
    );
  }

  static directRequest(runId: string): ModuleExpertInvocationRequest {
    return new ModuleExpertsTrustedRuntimeScenario(runId).execute();
  }

  private execute(): ModuleExpertInvocationRequest {
    const runId = this.request;
    return {
      runId,
      expert: 'core_expert',
      selectedContextPaths: [],
      sourceCommit: SOURCE_COMMIT,
      task: 'inspect-core-contract',
      attempt: 1,
      depth: 2,
      parent: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: 'feature-synthesis',
        agent: 'delivery-owner',
        attempt: 1,
      },
      instruction: 'Inspect the public core contract without writing files.',
    };
  }

  static processingRunDirectory(runId: string): string {
    return join(
      REPO_ROOT,
      'workflow',
      'processing',
      DelegatedAgentWorkflowName.AgentWork,
      runId,
    );
  }
}

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

const REMOVE_RECURSIVELY: RmOptions = { recursive: true, force: true };

test('uses the current adapter-bearing attempt journal schema', () => {
  expect(MODULE_EXPERT_WORKFLOW_VERSION).toBe(
    CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
  );
});

type ExtendedModuleExpertInvocationRequest = ModuleExpertInvocationRequest & {
  readonly allowWrites: boolean;
};

class TrustedRuntimeCompletion implements AgentTaskRuntime<string, string> {
  executionCount = 0;

  async executeAgent(): Promise<AgentExecutionCompletion> {
    this.executionCount += 1;
    return {
      threadId: 'trusted-runtime-thread',
      output:
        ModuleExpertsInvokeParentFixtureScenario.moduleExpertEvidenceOutput(),
    };
  }
}

test('rejects malformed direct session requests before parent or runtime authority', async () => {
  const valid = ModuleExpertsTrustedRuntimeScenario.directRequest(
    `direct-session-invalid-${randomUUID()}`,
  );
  const invalidSource: ModuleExpertInvocationRequest = {
    ...valid,
    sourceCommit: 'main',
  };
  const controlInstruction: ModuleExpertInvocationRequest = {
    ...valid,
    instruction: 'Inspect the contract.\u0000',
  };
  const unsafeRunId: ModuleExpertInvocationRequest = {
    ...valid,
    runId: '../escape',
  };
  const extended: ExtendedModuleExpertInvocationRequest = {
    ...valid,
    allowWrites: true,
  };
  const invalidRequests = [
    invalidSource,
    controlInstruction,
    unsafeRunId,
    extended,
  ];
  const forgedAuthorization = {
    kind: 'verified-module-expert-parent-authorization',
  } as VerifiedModuleExpertParentAuthorization;

  for (const request of invalidRequests) {
    const createArgs: CreateModuleExpertRuntimeSessionArgs = {
      repoRoot: REPO_ROOT,
      request,
      parentAuthorization: forgedAuthorization,
    };
    expect(() =>
      ModuleExpertRuntimeAuthority.createModuleExpertRuntimeSession(createArgs),
    ).toThrow('request is invalid');
  }
  expect(
    existsSync(
      ModuleExpertsTrustedRuntimeScenario.processingRunDirectory(valid.runId),
    ),
  ).toBe(false);
  const forgedSession = {
    kind: 'module-expert-runtime-session',
  } as ModuleExpertRuntimeSession;
  const controller = new AbortController();
  const executeArgs: ExecuteModuleExpertAgentArgs = {
    session: forgedSession,
    signal: controller.signal,
    observe: async () => {},
  };
  await expect(
    ModuleExpertRuntimeAuthority.executeModuleExpertAgent(executeArgs),
  ).rejects.toThrow('runtime session identity is invalid');
});

test('binds parent, session, journal, and completion authority exactly once', async () => {
  const request = ModuleExpertsTrustedRuntimeScenario.directRequest(
    `trusted-authority-${randomUUID()}`,
  );
  const runDirectory =
    ModuleExpertsTrustedRuntimeScenario.processingRunDirectory(request.runId);
  const runtime = new TrustedRuntimeCompletion();
  const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
    runId: request.runId,
    runtime,
  };
  const runtimeMock =
    ModuleExpertsModuleExpertRuntimeMockScenario.registerModuleExpertRuntimeMock(
      runtimeMockArgs,
    );
  try {
    await ModuleExpertsInvokeParentFixtureScenario.createAuthorizedDirectParent(
      request,
    );
    const forgedParentAuthorization = {
      kind: 'verified-module-expert-parent-authorization',
    } as VerifiedModuleExpertParentAuthorization;
    const forgedParentArgs: CreateModuleExpertRuntimeSessionArgs = {
      repoRoot: REPO_ROOT,
      request,
      parentAuthorization: forgedParentAuthorization,
    };
    expect(() =>
      ModuleExpertRuntimeAuthority.createModuleExpertRuntimeSession(
        forgedParentArgs,
      ),
    ).toThrow('parent authorization failed');
    const parentAuthorization =
      await ModuleExpertsTrustedRuntimeScenario.verifiedParentAuthorization(
        request,
      );
    const reboundRequest: ModuleExpertInvocationRequest = {
      ...request,
      task: 'rebound-child',
    };
    const reboundSessionArgs: CreateModuleExpertRuntimeSessionArgs = {
      repoRoot: REPO_ROOT,
      request: reboundRequest,
      parentAuthorization,
    };
    expect(() =>
      ModuleExpertRuntimeAuthority.createModuleExpertRuntimeSession(
        reboundSessionArgs,
      ),
    ).toThrow('parent authorization failed');

    const sessionArgs: CreateModuleExpertRuntimeSessionArgs = {
      repoRoot: REPO_ROOT,
      request,
      parentAuthorization,
    };
    const created =
      ModuleExpertRuntimeAuthority.createModuleExpertRuntimeSession(
        sessionArgs,
      );
    expect(() =>
      ModuleExpertRuntimeAuthority.createModuleExpertRuntimeSession(
        sessionArgs,
      ),
    ).toThrow('parent authorization failed');

    const reboundIdentity = {
      ...created.identity,
      task: 'rebound-child',
    };
    const forgedJournalAuthority = {
      kind: 'module-expert-journal-authority',
    } as ModuleExpertJournalAuthority;
    const forgedJournalArgs: ConsumeModuleExpertJournalAuthorityArgs = {
      authority: forgedJournalAuthority,
      identity: created.identity,
    };
    expect(() =>
      ModuleExpertRuntimeAuthority.consumeModuleExpertJournalAuthority(
        forgedJournalArgs,
      ),
    ).toThrow('journal authority is invalid');
    const reboundJournalArgs: ConsumeModuleExpertJournalAuthorityArgs = {
      authority: created.journalAuthority,
      identity: reboundIdentity,
    };
    expect(() =>
      ModuleExpertRuntimeAuthority.consumeModuleExpertJournalAuthority(
        reboundJournalArgs,
      ),
    ).toThrow('journal authority is invalid');
    const journalArgs: ConsumeModuleExpertJournalAuthorityArgs = {
      authority: created.journalAuthority,
      identity: created.identity,
    };
    const binding =
      ModuleExpertRuntimeAuthority.consumeModuleExpertJournalAuthority(
        journalArgs,
      );
    expect(() =>
      ModuleExpertRuntimeAuthority.consumeModuleExpertJournalAuthority(
        journalArgs,
      ),
    ).toThrow('journal authority is invalid');

    const forgedCompletionAuthority = {
      kind: 'module-expert-completion-authority',
    } as ModuleExpertCompletionAuthority;
    const forgedExecution: TrustedModuleExpertExecution = {
      completion: {
        threadId: 'forged-thread',
        output:
          ModuleExpertsInvokeParentFixtureScenario.moduleExpertEvidenceOutput(),
      },
      authority: forgedCompletionAuthority,
    };
    const forgedCompletionArgs: ConsumeModuleExpertCompletionAuthorityArgs = {
      binding,
      execution: forgedExecution,
      terminalCompletion: forgedExecution.completion,
    };
    expect(() =>
      ModuleExpertRuntimeAuthority.consumeModuleExpertCompletionAuthority(
        forgedCompletionArgs,
      ),
    ).toThrow('completion authority is invalid');

    const controller = new AbortController();
    const executeArgs: ExecuteModuleExpertAgentArgs = {
      session: created.session,
      signal: controller.signal,
      observe: async () => {},
    };
    const executionPromise =
      ModuleExpertRuntimeAuthority.executeModuleExpertAgent(executeArgs);
    await expect(
      ModuleExpertRuntimeAuthority.executeModuleExpertAgent(executeArgs),
    ).rejects.toThrow('runtime session identity is invalid');
    const execution = await executionPromise;
    expect(runtime.executionCount).toBe(1);

    const reboundCompletion: AgentExecutionCompletion = {
      ...execution.completion,
      threadId: 'rebound-thread',
    };
    const reboundCompletionArgs: ConsumeModuleExpertCompletionAuthorityArgs = {
      binding,
      execution,
      terminalCompletion: reboundCompletion,
    };
    expect(() =>
      ModuleExpertRuntimeAuthority.consumeModuleExpertCompletionAuthority(
        reboundCompletionArgs,
      ),
    ).toThrow('completion authority is invalid');
    const completionArgs: ConsumeModuleExpertCompletionAuthorityArgs = {
      binding,
      execution,
      terminalCompletion: execution.completion,
    };
    ModuleExpertRuntimeAuthority.consumeModuleExpertCompletionAuthority(
      completionArgs,
    );
    expect(() =>
      ModuleExpertRuntimeAuthority.consumeModuleExpertCompletionAuthority(
        completionArgs,
      ),
    ).toThrow('completion authority is invalid');
  } finally {
    runtimeMock.dispose();
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});
