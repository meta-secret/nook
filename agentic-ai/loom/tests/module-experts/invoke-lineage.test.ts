import { createHash, randomUUID } from 'node:crypto';

import { existsSync } from 'node:fs';

import { readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';

import type { RmOptions } from 'node:fs';

import { join, resolve } from 'node:path';

import { expect, test } from 'bun:test';

import { AgentAttemptEventKind } from '../../src/agent-workflow/agent-events.ts';

import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  MaterializedViewPresence,
  TaskTerminalKind,
} from '../../src/agent-workflow/domain.ts';

import type { AgentAttemptEvent } from '../../src/agent-workflow/agent-events.ts';

import type {
  CompletedTaskTerminal,
  ModuleExpertAuthorization,
  ModuleDevelopmentPlanTaskOutput,
  ParentAgentAttempt,
} from '../../src/agent-workflow/domain.ts';

import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';

import { ModuleExpertInvocation } from '../../src/module-experts/invoke.ts';

import type {
  InvokeModuleExpertArgs,
  ModuleExpertInvocationRequest,
} from '../../src/module-experts/invoke.ts';

import { MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH } from '../../src/agent-workflow/structured-result-codec.ts';

import { ModuleExpertsInvokeParentFixtureScenario } from './invoke-parent-fixture.ts';

import { ModuleExpertsModuleExpertRuntimeMockScenario } from './module-expert-runtime-mock.ts';

import type {
  ModuleExpertRuntimeMockRegistration,
  RegisterModuleExpertRuntimeMockArgs,
} from './module-expert-runtime-mock.ts';

export class ModuleExpertsInvokeLineageScenario {
  private constructor(private readonly request: InvalidDepthThreeParentCase) {}

  static createDepthThreeFixtureLineage(
    args: InvalidDepthThreeParentCase,
  ): Promise<void> {
    return new ModuleExpertsInvokeLineageScenario(args).execute();
  }

  private async execute(): Promise<void> {
    const args = this.request;
    const immediate = ModuleExpertsInvokeLineageScenario.directParent(
      args.request,
    );
    const root: ParentAgentAttempt = {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: 'feature-synthesis',
      agent: 'delivery-owner',
      attempt: 1,
    };
    const rootPlanArgs = {
      repoRoot: REPO_ROOT,
      runId: args.request.runId,
      sourceCommit: args.request.sourceCommit,
      task: root.task,
      agent: root.agent,
      attempt: root.attempt,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
      output:
        ModuleExpertsInvokeParentFixtureScenario.moduleDevelopmentPlanOutput([
          ModuleExpertsInvokeLineageScenario.authorization(args.request),
        ]),
    } as const;
    await ModuleExpertsInvokeParentFixtureScenario.createCompletedAttempt(
      rootPlanArgs,
    );
    const immediateArgs = {
      repoRoot: REPO_ROOT,
      runId: args.request.runId,
      sourceCommit: args.request.sourceCommit,
      task: immediate.task,
      agent: immediate.agent,
      attempt: immediate.attempt,
      depth: 2,
      parent: root,
      output: args.immediateOutput,
    } as const;
    await ModuleExpertsInvokeParentFixtureScenario.createCompletedAttempt(
      immediateArgs,
    );
  }

  static async setupAbsentParent(_args: ParentSetupArgs): Promise<void> {}

  static async setupFailedParent(args: ParentSetupArgs): Promise<void> {
    const parent = ModuleExpertsInvokeLineageScenario.directParent(
      args.request,
    );
    const failedArgs = {
      repoRoot: REPO_ROOT,
      runId: args.request.runId,
      sourceCommit: args.request.sourceCommit,
      task: parent.task,
      agent: parent.agent,
      attempt: parent.attempt,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
    } as const;
    await ModuleExpertsInvokeParentFixtureScenario.createFailedAttempt(
      failedArgs,
    );
  }

  static async setupDriftedParent(args: ParentSetupArgs): Promise<void> {
    const planArgs: CreateDirectPlanArgs = {
      request: args.request,
      sourceCommit: DRIFTED_SOURCE_COMMIT,
      authorization: ModuleExpertsInvokeLineageScenario.authorization(
        args.request,
      ),
    };
    await ModuleExpertsInvokeLineageScenario.createDirectPlan(planArgs);
  }

  static async setupUnauthorizedParent(args: ParentSetupArgs): Promise<void> {
    const unauthorized = {
      ...ModuleExpertsInvokeLineageScenario.authorization(args.request),
      expert: 'different_expert',
    };
    const planArgs: CreateDirectPlanArgs = {
      request: args.request,
      sourceCommit: args.request.sourceCommit,
      authorization: unauthorized,
    };
    await ModuleExpertsInvokeLineageScenario.createDirectPlan(planArgs);
  }

  static async setupCorruptedParent(args: ParentSetupArgs): Promise<void> {
    const planArgs: CreateDirectPlanArgs = {
      request: args.request,
      sourceCommit: args.request.sourceCommit,
      authorization: ModuleExpertsInvokeLineageScenario.authorization(
        args.request,
      ),
    };
    await ModuleExpertsInvokeLineageScenario.createDirectPlan(planArgs);
    const parent = ModuleExpertsInvokeLineageScenario.directParent(
      args.request,
    );
    const resultPath = join(
      ModuleExpertsInvokeLineageScenario.processingRunDirectory(
        args.request.runId,
      ),
      'agents',
      parent.task,
      `attempt-${parent.attempt}`,
      'result.json',
    );
    const serialized = await readFile(resultPath, 'utf8');
    await writeFile(resultPath, `${serialized}corrupted`, 'utf8');
  }

  static async setupSymlinkedProjection(args: ParentSetupArgs): Promise<void> {
    const planArgs: CreateDirectPlanArgs = {
      request: args.request,
      sourceCommit: args.request.sourceCommit,
      authorization: ModuleExpertsInvokeLineageScenario.authorization(
        args.request,
      ),
    };
    await ModuleExpertsInvokeLineageScenario.createDirectPlan(planArgs);
    const parent = ModuleExpertsInvokeLineageScenario.directParent(
      args.request,
    );
    const attemptDirectory = join(
      ModuleExpertsInvokeLineageScenario.processingRunDirectory(
        args.request.runId,
      ),
      'agents',
      parent.task,
      `attempt-${parent.attempt}`,
    );
    const projectionPath = join(attemptDirectory, 'result.json');
    const projectionTarget = join(attemptDirectory, 'result-target.json');
    await rename(projectionPath, projectionTarget);
    await symlink('result-target.json', projectionPath, 'file');
  }

  static async setupSymlinkedAttemptDirectory(
    args: ParentSetupArgs,
  ): Promise<void> {
    const planArgs: CreateDirectPlanArgs = {
      request: args.request,
      sourceCommit: args.request.sourceCommit,
      authorization: ModuleExpertsInvokeLineageScenario.authorization(
        args.request,
      ),
    };
    await ModuleExpertsInvokeLineageScenario.createDirectPlan(planArgs);
    const parent = ModuleExpertsInvokeLineageScenario.directParent(
      args.request,
    );
    const parentDirectory = join(
      ModuleExpertsInvokeLineageScenario.processingRunDirectory(
        args.request.runId,
      ),
      'agents',
      parent.task,
    );
    const attemptName = `attempt-${parent.attempt}`;
    const attemptDirectory = join(parentDirectory, attemptName);
    const attemptTargetName = `${attemptName}-target`;
    await rename(attemptDirectory, join(parentDirectory, attemptTargetName));
    await symlink(attemptTargetName, attemptDirectory, 'dir');
  }

  static async createDirectPlan(args: CreateDirectPlanArgs): Promise<void> {
    const parent = ModuleExpertsInvokeLineageScenario.directParent(
      args.request,
    );
    const completedArgs = {
      repoRoot: REPO_ROOT,
      runId: args.request.runId,
      sourceCommit: args.sourceCommit,
      task: parent.task,
      agent: parent.agent,
      attempt: parent.attempt,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
      output:
        ModuleExpertsInvokeParentFixtureScenario.moduleDevelopmentPlanOutput([
          args.authorization,
        ]),
    } as const;
    await ModuleExpertsInvokeParentFixtureScenario.createCompletedAttempt(
      completedArgs,
    );
  }

  static async createDirectPlanWithView(
    args: CreateDirectPlanWithViewArgs,
  ): Promise<void> {
    const parent = ModuleExpertsInvokeLineageScenario.directParent(
      args.request,
    );
    const output: ModuleDevelopmentPlanTaskOutput = {
      ...ModuleExpertsInvokeParentFixtureScenario.moduleDevelopmentPlanOutput([
        ModuleExpertsInvokeLineageScenario.authorization(args.request),
      ]),
      materializedViewMarkdown: args.view,
    };
    const completedArgs = {
      repoRoot: REPO_ROOT,
      runId: args.request.runId,
      sourceCommit: args.request.sourceCommit,
      task: parent.task,
      agent: parent.agent,
      attempt: parent.attempt,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
      output,
    } as const;
    await ModuleExpertsInvokeParentFixtureScenario.createCompletedAttempt(
      completedArgs,
    );
  }

  static async rewriteParentView(args: RewriteParentViewArgs): Promise<void> {
    const parent = ModuleExpertsInvokeLineageScenario.directParent(
      args.request,
    );
    const attemptDirectory = join(
      ModuleExpertsInvokeLineageScenario.processingRunDirectory(
        args.request.runId,
      ),
      'agents',
      parent.task,
      `attempt-${parent.attempt}`,
    );
    const eventsPath = join(attemptDirectory, 'events.jsonl');
    const resultPath = join(attemptDirectory, 'result.json');
    const viewPath = join(attemptDirectory, 'view.md');
    const originalTerminal = JSON.parse(
      await readFile(resultPath, 'utf8'),
    ) as CompletedTaskTerminal<string>;
    const output: ModuleDevelopmentPlanTaskOutput = {
      ...ModuleExpertsInvokeParentFixtureScenario.moduleDevelopmentPlanOutput([
        ModuleExpertsInvokeLineageScenario.authorization(args.request),
      ]),
      materializedViewMarkdown: args.view,
    };
    const terminal: CompletedTaskTerminal<string> = {
      ...originalTerminal,
      output,
    };
    const resultSerialized = `${JSON.stringify(terminal)}\n`;
    const viewSerialized = `${args.view.trim()}\n`;
    const resultHash =
      ModuleExpertsInvokeLineageScenario.sha256(resultSerialized);
    const viewHash = ModuleExpertsInvokeLineageScenario.sha256(viewSerialized);
    const events = (await readFile(eventsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as AgentAttemptEvent);
    const rewrittenEvents = events.map((event): AgentAttemptEvent => {
      if (event.kind === AgentAttemptEventKind.ResultProjected) {
        return { ...event, result: { ...event.result, sha256: resultHash } };
      }
      if (event.kind === AgentAttemptEventKind.ViewProjected) {
        if (event.view.presence !== MaterializedViewPresence.Recorded) {
          throw new Error('Expected a recorded parent view projection.');
        }
        return {
          ...event,
          view: {
            ...event.view,
            projection: { ...event.view.projection, sha256: viewHash },
          },
        };
      }
      if (event.kind === AgentAttemptEventKind.AttemptTerminalRecorded) {
        if (event.view.presence !== MaterializedViewPresence.Recorded) {
          throw new Error('Expected a recorded parent terminal view.');
        }
        return {
          ...event,
          result: { ...event.result, sha256: resultHash },
          view: {
            ...event.view,
            projection: { ...event.view.projection, sha256: viewHash },
          },
        };
      }
      return event;
    });
    await Promise.all([
      writeFile(
        eventsPath,
        `${rewrittenEvents.map((event) => JSON.stringify(event)).join('\n')}\n`,
        'utf8',
      ),
      writeFile(resultPath, resultSerialized, 'utf8'),
      writeFile(viewPath, viewSerialized, 'utf8'),
    ]);
  }

  static async createDepthThreeLineage(
    args: CreateDepthThreeLineageArgs,
  ): Promise<void> {
    const immediate = ModuleExpertsInvokeLineageScenario.directParent(
      args.request,
    );
    const root: ParentAgentAttempt = {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: 'feature-synthesis',
      agent: 'delivery-owner',
      attempt: 1,
    };
    const intermediateRequest: ModuleExpertInvocationRequest = {
      runId: args.request.runId,
      expert: immediate.agent,
      selectedContextPaths: [],
      sourceCommit: args.request.sourceCommit,
      task: immediate.task,
      attempt: immediate.attempt,
      depth: 2,
      parent: root,
      instruction: 'Inspect the provider contract without writing files.',
    };
    const rootPlanArgs = {
      repoRoot: REPO_ROOT,
      runId: args.request.runId,
      sourceCommit: args.request.sourceCommit,
      task: root.task,
      agent: root.agent,
      attempt: root.attempt,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
      output:
        ModuleExpertsInvokeParentFixtureScenario.moduleDevelopmentPlanOutput([
          ModuleExpertsInvokeLineageScenario.authorization(intermediateRequest),
          args.authorization,
        ]),
    } as const;
    await ModuleExpertsInvokeParentFixtureScenario.createCompletedAttempt(
      rootPlanArgs,
    );
    const runtime = new CountingRuntime(intermediateRequest.runId);
    const invocationInput: InvocationArgs = {
      request: intermediateRequest,
    };
    try {
      const intermediateResult =
        await ModuleExpertInvocation.invokeModuleExpert(
          ModuleExpertsInvokeLineageScenario.invocationArgs(invocationInput),
        );
      if (intermediateResult.terminal.kind !== TaskTerminalKind.Completed) {
        throw new Error(
          'Expected completed intermediate module expert fixture.',
        );
      }
    } finally {
      runtime.dispose();
    }
  }

  static invocationArgs(args: InvocationArgs): InvokeModuleExpertArgs {
    const controller = new AbortController();
    return {
      repoRoot: REPO_ROOT,
      request: args.request,
      signal: controller.signal,
    };
  }

  static authorization(
    request: ModuleExpertInvocationRequest,
  ): ModuleExpertAuthorization {
    return {
      task: request.task,
      expert: request.expert,
      attempt: request.attempt,
      depth: request.depth,
      parent: ModuleExpertsInvokeLineageScenario.directParent(request),
    };
  }

  static directParent(
    request: ModuleExpertInvocationRequest,
  ): ParentAgentAttempt {
    if (request.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
      throw new Error('Expected parent agent attempt in the test fixture.');
    }
    return request.parent;
  }

  static directRequest(runId: string): ModuleExpertInvocationRequest {
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
      instruction: 'Inspect the module contract without writing files.',
    };
  }

  static depthThreeRequest(runId: string): ModuleExpertInvocationRequest {
    const request = ModuleExpertsInvokeLineageScenario.directRequest(runId);
    return {
      ...request,
      depth: 3,
      parent: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: 'inspect-provider-contract',
        agent: 'core_expert',
        attempt: 1,
      },
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

  static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

const DRIFTED_SOURCE_COMMIT = '1123456789abcdef0123456789abcdef01234567';

const REMOVE_RECURSIVELY: RmOptions = { recursive: true, force: true };

class CountingRuntime implements AgentTaskRuntime<string, string> {
  executionCount = 0;
  readonly registration: ModuleExpertRuntimeMockRegistration;

  constructor(runId: string) {
    const registrationArgs: RegisterModuleExpertRuntimeMockArgs = {
      runId,
      runtime: this,
    };
    this.registration =
      ModuleExpertsModuleExpertRuntimeMockScenario.registerModuleExpertRuntimeMock(
        registrationArgs,
      );
  }

  async executeAgent(
    invocation: AgentExecutionInvocation<string, string>,
  ): Promise<AgentExecutionCompletion> {
    this.executionCount += 1;
    return {
      threadId: `thread-${invocation.task}`,
      output:
        ModuleExpertsInvokeParentFixtureScenario.moduleExpertEvidenceOutput(),
    };
  }

  dispose(): void {
    this.registration.dispose();
  }
}

test('rejects invalid, corrupted, or symlinked parents before runtime', async () => {
  const setupCases: readonly ParentSetupCase[] = [
    {
      name: 'absent',
      setup: ModuleExpertsInvokeLineageScenario.setupAbsentParent,
    },
    {
      name: 'failed',
      setup: ModuleExpertsInvokeLineageScenario.setupFailedParent,
    },
    {
      name: 'source-drifted',
      setup: ModuleExpertsInvokeLineageScenario.setupDriftedParent,
    },
    {
      name: 'unauthorized',
      setup: ModuleExpertsInvokeLineageScenario.setupUnauthorizedParent,
    },
    {
      name: 'corrupted',
      setup: ModuleExpertsInvokeLineageScenario.setupCorruptedParent,
    },
    {
      name: 'symlinked-projection',
      setup: ModuleExpertsInvokeLineageScenario.setupSymlinkedProjection,
    },
    {
      name: 'symlinked-directory',
      setup: ModuleExpertsInvokeLineageScenario.setupSymlinkedAttemptDirectory,
    },
  ];

  for (const setupCase of setupCases) {
    const request = ModuleExpertsInvokeLineageScenario.directRequest(
      `parent-${setupCase.name}-${randomUUID()}`,
    );
    const runDirectory =
      ModuleExpertsInvokeLineageScenario.processingRunDirectory(request.runId);
    const runtime = new CountingRuntime(request.runId);
    try {
      const setupArgs: ParentSetupArgs = { request };
      await setupCase.setup(setupArgs);
      const invocationInput: InvocationArgs = { request };
      const invokeArgs =
        ModuleExpertsInvokeLineageScenario.invocationArgs(invocationInput);
      await expect(
        ModuleExpertInvocation.invokeModuleExpert(invokeArgs),
      ).rejects.toThrow('parent authorization failed');
      expect(runtime.executionCount).toBe(0);
      const childAttemptDirectory = join(
        runDirectory,
        'agents',
        request.task,
        `attempt-${request.attempt}`,
      );
      expect(existsSync(childAttemptDirectory)).toBe(false);
    } finally {
      runtime.dispose();
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  }
});

test('authorizes a multibyte parent view within the character limit', async () => {
  const request = ModuleExpertsInvokeLineageScenario.directRequest(
    `multibyte-parent-view-${randomUUID()}`,
  );
  const runDirectory =
    ModuleExpertsInvokeLineageScenario.processingRunDirectory(request.runId);
  const runtime = new CountingRuntime(request.runId);
  const multibyteView = '界'.repeat(40_000);
  try {
    const planArgs: CreateDirectPlanWithViewArgs = {
      request,
      view: multibyteView,
    };
    await ModuleExpertsInvokeLineageScenario.createDirectPlanWithView(planArgs);
    const invocationInput: InvocationArgs = { request };
    const result = await ModuleExpertInvocation.invokeModuleExpert(
      ModuleExpertsInvokeLineageScenario.invocationArgs(invocationInput),
    );

    expect(multibyteView.length).toBe(40_000);
    expect(Buffer.byteLength(multibyteView, 'utf8')).toBeGreaterThan(65_536);
    expect(result.terminal.kind).toBe(TaskTerminalKind.Completed);
    expect(runtime.executionCount).toBe(1);
  } finally {
    runtime.dispose();
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

test('rejects a parent view above the character limit with valid projection hashes', async () => {
  const request = ModuleExpertsInvokeLineageScenario.directRequest(
    `oversized-parent-view-${randomUUID()}`,
  );
  const runDirectory =
    ModuleExpertsInvokeLineageScenario.processingRunDirectory(request.runId);
  const runtime = new CountingRuntime(request.runId);
  try {
    const planArgs: CreateDirectPlanWithViewArgs = {
      request,
      view: 'v'.repeat(MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH),
    };
    await ModuleExpertsInvokeLineageScenario.createDirectPlanWithView(planArgs);
    const rewriteArgs: RewriteParentViewArgs = {
      request,
      view: 'v'.repeat(MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH + 1),
    };
    await ModuleExpertsInvokeLineageScenario.rewriteParentView(rewriteArgs);

    const invocationInput: InvocationArgs = { request };
    await expect(
      ModuleExpertInvocation.invokeModuleExpert(
        ModuleExpertsInvokeLineageScenario.invocationArgs(invocationInput),
      ),
    ).rejects.toThrow('parent authorization failed');
    expect(runtime.executionCount).toBe(0);
  } finally {
    runtime.dispose();
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

test('rejects authorization storage collisions before lineage materializes', async () => {
  const siblingRequest = ModuleExpertsInvokeLineageScenario.directRequest(
    `authorization-key-collision-${randomUUID()}`,
  );
  const siblingAuthorization =
    ModuleExpertsInvokeLineageScenario.authorization(siblingRequest);
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
  const direct = ModuleExpertsInvokeLineageScenario.directRequest(
    `authorization-parent-key-${randomUUID()}`,
  );
  const parent = ModuleExpertsInvokeLineageScenario.directParent(direct);
  const parentKeyRequest: ModuleExpertInvocationRequest = {
    ...direct,
    task: parent.task,
    attempt: parent.attempt,
  };
  const cases: readonly AuthorizationStorageCollisionCase[] = [
    {
      request: siblingRequest,
      authorizations: [siblingAuthorization, collidingSibling],
      expectedMessage: 'journal storage keys must be unique',
    },
    {
      request: parentKeyRequest,
      authorizations: [
        ModuleExpertsInvokeLineageScenario.authorization(parentKeyRequest),
      ],
      expectedMessage: 'identity is invalid',
    },
  ];

  for (const testCase of cases) {
    const runDirectory =
      ModuleExpertsInvokeLineageScenario.processingRunDirectory(
        testCase.request.runId,
      );
    const immediateParent = ModuleExpertsInvokeLineageScenario.directParent(
      testCase.request,
    );
    const completedArgs = {
      repoRoot: REPO_ROOT,
      runId: testCase.request.runId,
      sourceCommit: testCase.request.sourceCommit,
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

test('runs a depth-three expert only when the root plan predeclares the exact child', async () => {
  const request = ModuleExpertsInvokeLineageScenario.depthThreeRequest(
    `depth-three-${randomUUID()}`,
  );
  const runDirectory =
    ModuleExpertsInvokeLineageScenario.processingRunDirectory(request.runId);
  const runtime = new CountingRuntime(request.runId);
  try {
    const lineageArgs: CreateDepthThreeLineageArgs = {
      request,
      authorization: ModuleExpertsInvokeLineageScenario.authorization(request),
    };
    await ModuleExpertsInvokeLineageScenario.createDepthThreeLineage(
      lineageArgs,
    );
    const invocationInput: InvocationArgs = { request };
    const invokeArgs =
      ModuleExpertsInvokeLineageScenario.invocationArgs(invocationInput);
    const result = await ModuleExpertInvocation.invokeModuleExpert(invokeArgs);

    expect(result.terminal.kind).toBe(TaskTerminalKind.Completed);
    expect(runtime.executionCount).toBe(1);
  } finally {
    runtime.dispose();
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

test('does not treat depth-two expert evidence as authority for a grandchild', async () => {
  const request = ModuleExpertsInvokeLineageScenario.depthThreeRequest(
    `depth-three-unplanned-${randomUUID()}`,
  );
  const runDirectory =
    ModuleExpertsInvokeLineageScenario.processingRunDirectory(request.runId);
  const runtime = new CountingRuntime(request.runId);
  const unrelated = {
    ...ModuleExpertsInvokeLineageScenario.authorization(request),
    task: 'different-child',
  };
  try {
    const lineageArgs: CreateDepthThreeLineageArgs = {
      request,
      authorization: unrelated,
    };
    await ModuleExpertsInvokeLineageScenario.createDepthThreeLineage(
      lineageArgs,
    );
    const invocationInput: InvocationArgs = { request };
    const invokeArgs =
      ModuleExpertsInvokeLineageScenario.invocationArgs(invocationInput);
    await expect(
      ModuleExpertInvocation.invokeModuleExpert(invokeArgs),
    ).rejects.toThrow('parent authorization failed');
    expect(runtime.executionCount).toBe(0);
  } finally {
    runtime.dispose();
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

test('generic journal construction cannot forge module expert parent provenance', async () => {
  const request = ModuleExpertsInvokeLineageScenario.depthThreeRequest(
    `generic-forgery-${randomUUID()}`,
  );
  const runDirectory =
    ModuleExpertsInvokeLineageScenario.processingRunDirectory(request.runId);
  const immediate = ModuleExpertsInvokeLineageScenario.directParent(request);
  const forgedArgs = {
    repoRoot: REPO_ROOT,
    runId: request.runId,
    sourceCommit: request.sourceCommit,
    task: immediate.task,
    agent: immediate.agent,
    attempt: immediate.attempt,
    depth: 2,
    parent: {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: 'feature-synthesis',
      agent: 'delivery-owner',
      attempt: 1,
    },
    output:
      ModuleExpertsInvokeParentFixtureScenario.moduleExpertEvidenceOutput(),
  } as const;
  try {
    await expect(
      ModuleExpertsInvokeParentFixtureScenario.createCompletedAttempt(
        forgedArgs,
      ),
    ).rejects.toThrow('isolated invocation adapter');
  } finally {
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

test('rejects depth-three lineage without a registered expert evidence parent', async () => {
  const registeredRequest =
    ModuleExpertsInvokeLineageScenario.depthThreeRequest(
      `depth-three-non-expert-result-${randomUUID()}`,
    );
  const unregisteredRequest = {
    ...ModuleExpertsInvokeLineageScenario.depthThreeRequest(
      `depth-three-unregistered-${randomUUID()}`,
    ),
    parent: {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: 'inspect-provider-contract',
      agent: 'delivery-helper',
      attempt: 1,
    },
  } as const;
  const cases: readonly InvalidDepthThreeParentCase[] = [
    {
      request: unregisteredRequest,
      immediateOutput:
        ModuleExpertsInvokeParentFixtureScenario.moduleDevelopmentPlanOutput([
          ModuleExpertsInvokeLineageScenario.authorization(unregisteredRequest),
        ]),
    },
    {
      request: registeredRequest,
      immediateOutput:
        ModuleExpertsInvokeParentFixtureScenario.moduleDevelopmentPlanOutput([
          ModuleExpertsInvokeLineageScenario.authorization(registeredRequest),
        ]),
    },
  ];

  for (const testCase of cases) {
    const runDirectory =
      ModuleExpertsInvokeLineageScenario.processingRunDirectory(
        testCase.request.runId,
      );
    const runtime = new CountingRuntime(testCase.request.runId);
    try {
      await ModuleExpertsInvokeLineageScenario.createDepthThreeFixtureLineage(
        testCase,
      );
      const invocationInput: InvocationArgs = {
        request: testCase.request,
      };
      await expect(
        ModuleExpertInvocation.invokeModuleExpert(
          ModuleExpertsInvokeLineageScenario.invocationArgs(invocationInput),
        ),
      ).rejects.toThrow('parent authorization failed');
      expect(runtime.executionCount).toBe(0);
    } finally {
      runtime.dispose();
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  }
});

test('rejects depth-three evidence whose event provenance was downgraded', async () => {
  const request = ModuleExpertsInvokeLineageScenario.depthThreeRequest(
    `downgraded-origin-${randomUUID()}`,
  );
  const runDirectory =
    ModuleExpertsInvokeLineageScenario.processingRunDirectory(request.runId);
  const runtime = new CountingRuntime(request.runId);
  try {
    const lineageArgs: CreateDepthThreeLineageArgs = {
      request,
      authorization: ModuleExpertsInvokeLineageScenario.authorization(request),
    };
    await ModuleExpertsInvokeLineageScenario.createDepthThreeLineage(
      lineageArgs,
    );
    const immediate = ModuleExpertsInvokeLineageScenario.directParent(request);
    const eventsPath = join(
      runDirectory,
      'agents',
      immediate.task,
      `attempt-${immediate.attempt}`,
      'events.jsonl',
    );
    const events = (await readFile(eventsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as AgentAttemptEvent);
    const downgradedEvents = events.map((event) => ({
      ...event,
      adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
    }));
    await writeFile(
      eventsPath,
      `${downgradedEvents.map((event) => JSON.stringify(event)).join('\n')}\n`,
      'utf8',
    );

    const invocationInput: InvocationArgs = { request };
    await expect(
      ModuleExpertInvocation.invokeModuleExpert(
        ModuleExpertsInvokeLineageScenario.invocationArgs(invocationInput),
      ),
    ).rejects.toThrow('parent authorization failed');
    expect(runtime.executionCount).toBe(0);
  } finally {
    runtime.dispose();
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

type InvalidDepthThreeParentCase = {
  readonly request: ModuleExpertInvocationRequest;
  readonly immediateOutput: ReturnType<
    | typeof ModuleExpertsInvokeParentFixtureScenario.moduleDevelopmentPlanOutput
    | typeof ModuleExpertsInvokeParentFixtureScenario.moduleExpertEvidenceOutput
  >;
};

type AuthorizationStorageCollisionCase = {
  readonly request: ModuleExpertInvocationRequest;
  readonly authorizations: readonly ModuleExpertAuthorization[];
  readonly expectedMessage: string;
};

type ParentSetupArgs = {
  readonly request: ModuleExpertInvocationRequest;
};

type ParentSetup = (args: ParentSetupArgs) => Promise<void>;

type ParentSetupCase = {
  readonly name: string;
  readonly setup: ParentSetup;
};

type CreateDirectPlanArgs = {
  readonly request: ModuleExpertInvocationRequest;
  readonly sourceCommit: string;
  readonly authorization: ModuleExpertAuthorization;
};

type CreateDirectPlanWithViewArgs = {
  readonly request: ModuleExpertInvocationRequest;
  readonly view: string;
};

type RewriteParentViewArgs = CreateDirectPlanWithViewArgs;

type CreateDepthThreeLineageArgs = {
  readonly request: ModuleExpertInvocationRequest;
  readonly authorization: ModuleExpertAuthorization;
};

type InvocationArgs = {
  readonly request: ModuleExpertInvocationRequest;
};
