import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'bun:test';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
} from '../../src/agent-workflow/domain.ts';
import type { AgentAttemptEvent } from '../../src/agent-workflow/agent-events.ts';
import type {
  ModuleExpertAuthorization,
  ParentAgentAttempt,
} from '../../src/agent-workflow/domain.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';
import { invokeModuleExpert } from '../../src/module-experts/invoke.ts';
import type {
  InvokeModuleExpertArgs,
  ModuleExpertInvocationRequest,
} from '../../src/module-experts/invoke.ts';
import {
  createCompletedAttempt,
  createFailedAttempt,
  moduleDevelopmentPlanOutput,
  moduleExpertEvidenceOutput,
} from './invoke-parent-fixture.ts';
import { registerModuleExpertRuntimeMock } from './module-expert-runtime-mock.ts';
import type {
  ModuleExpertRuntimeMockRegistration,
  RegisterModuleExpertRuntimeMockArgs,
} from './module-expert-runtime-mock.ts';

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
    this.registration = registerModuleExpertRuntimeMock(registrationArgs);
  }

  async executeAgent(
    invocation: AgentExecutionInvocation<string, string>,
  ): Promise<AgentExecutionCompletion> {
    this.executionCount += 1;
    return {
      threadId: `thread-${invocation.task}`,
      output: moduleExpertEvidenceOutput(),
    };
  }

  dispose(): void {
    this.registration.dispose();
  }
}

test('rejects absent, failed, source-drifted, unauthorized, or corrupted parents before runtime', async () => {
  const setupCases: readonly ParentSetupCase[] = [
    { name: 'absent', setup: setupAbsentParent },
    { name: 'failed', setup: setupFailedParent },
    { name: 'source-drifted', setup: setupDriftedParent },
    { name: 'unauthorized', setup: setupUnauthorizedParent },
    { name: 'corrupted', setup: setupCorruptedParent },
  ];

  for (const setupCase of setupCases) {
    const request = directRequest(`parent-${setupCase.name}-${randomUUID()}`);
    const runDirectory = processingRunDirectory(request.runId);
    const runtime = new CountingRuntime(request.runId);
    try {
      const setupArgs: ParentSetupArgs = { request };
      await setupCase.setup(setupArgs);
      const invocationInput: InvocationArgs = { request };
      const invokeArgs = invocationArgs(invocationInput);
      await expect(invokeModuleExpert(invokeArgs)).rejects.toThrow(
        'parent authorization failed',
      );
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

test('rejects authorization storage collisions before lineage materializes', async () => {
  const siblingRequest = directRequest(
    `authorization-key-collision-${randomUUID()}`,
  );
  const siblingAuthorization = authorization(siblingRequest);
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
  const direct = directRequest(`authorization-parent-key-${randomUUID()}`);
  const parent = directParent(direct);
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
      authorizations: [authorization(parentKeyRequest)],
      expectedMessage: 'identity is invalid',
    },
  ];

  for (const testCase of cases) {
    const runDirectory = processingRunDirectory(testCase.request.runId);
    const immediateParent = directParent(testCase.request);
    const completedArgs = {
      repoRoot: REPO_ROOT,
      runId: testCase.request.runId,
      sourceCommit: testCase.request.sourceCommit,
      task: immediateParent.task,
      agent: immediateParent.agent,
      attempt: immediateParent.attempt,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
      output: moduleDevelopmentPlanOutput(testCase.authorizations),
    } as const;
    try {
      await expect(createCompletedAttempt(completedArgs)).rejects.toThrow(
        testCase.expectedMessage,
      );
    } finally {
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  }
});

test('runs a depth-three expert only when the root plan predeclares the exact child', async () => {
  const request = depthThreeRequest(`depth-three-${randomUUID()}`);
  const runDirectory = processingRunDirectory(request.runId);
  const runtime = new CountingRuntime(request.runId);
  try {
    const lineageArgs: CreateDepthThreeLineageArgs = {
      request,
      authorization: authorization(request),
    };
    await createDepthThreeLineage(lineageArgs);
    const invocationInput: InvocationArgs = { request };
    const invokeArgs = invocationArgs(invocationInput);
    const result = await invokeModuleExpert(invokeArgs);

    expect(result.terminal.kind).toBe(TaskTerminalKind.Completed);
    expect(runtime.executionCount).toBe(1);
  } finally {
    runtime.dispose();
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

test('does not treat depth-two expert evidence as authority for a grandchild', async () => {
  const request = depthThreeRequest(`depth-three-unplanned-${randomUUID()}`);
  const runDirectory = processingRunDirectory(request.runId);
  const runtime = new CountingRuntime(request.runId);
  const unrelated = {
    ...authorization(request),
    task: 'different-child',
  };
  try {
    const lineageArgs: CreateDepthThreeLineageArgs = {
      request,
      authorization: unrelated,
    };
    await createDepthThreeLineage(lineageArgs);
    const invocationInput: InvocationArgs = { request };
    const invokeArgs = invocationArgs(invocationInput);
    await expect(invokeModuleExpert(invokeArgs)).rejects.toThrow(
      'parent authorization failed',
    );
    expect(runtime.executionCount).toBe(0);
  } finally {
    runtime.dispose();
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

test('generic journal construction cannot forge module expert parent provenance', async () => {
  const request = depthThreeRequest(`generic-forgery-${randomUUID()}`);
  const runDirectory = processingRunDirectory(request.runId);
  const immediate = directParent(request);
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
    output: moduleExpertEvidenceOutput(),
  } as const;
  try {
    await expect(createCompletedAttempt(forgedArgs)).rejects.toThrow(
      'isolated invocation adapter',
    );
  } finally {
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

test('rejects depth-three lineage without a registered expert evidence parent', async () => {
  const registeredRequest = depthThreeRequest(
    `depth-three-non-expert-result-${randomUUID()}`,
  );
  const unregisteredRequest = {
    ...depthThreeRequest(`depth-three-unregistered-${randomUUID()}`),
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
      immediateOutput: moduleDevelopmentPlanOutput([
        authorization(unregisteredRequest),
      ]),
    },
    {
      request: registeredRequest,
      immediateOutput: moduleDevelopmentPlanOutput([
        authorization(registeredRequest),
      ]),
    },
  ];

  for (const testCase of cases) {
    const runDirectory = processingRunDirectory(testCase.request.runId);
    const runtime = new CountingRuntime(testCase.request.runId);
    try {
      await createDepthThreeFixtureLineage(testCase);
      const invocationInput: InvocationArgs = {
        request: testCase.request,
      };
      await expect(
        invokeModuleExpert(invocationArgs(invocationInput)),
      ).rejects.toThrow('parent authorization failed');
      expect(runtime.executionCount).toBe(0);
    } finally {
      runtime.dispose();
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  }
});

test('rejects depth-three evidence whose event provenance was downgraded', async () => {
  const request = depthThreeRequest(`downgraded-origin-${randomUUID()}`);
  const runDirectory = processingRunDirectory(request.runId);
  const runtime = new CountingRuntime(request.runId);
  try {
    const lineageArgs: CreateDepthThreeLineageArgs = {
      request,
      authorization: authorization(request),
    };
    await createDepthThreeLineage(lineageArgs);
    const immediate = directParent(request);
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
      invokeModuleExpert(invocationArgs(invocationInput)),
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
    typeof moduleDevelopmentPlanOutput | typeof moduleExpertEvidenceOutput
  >;
};

type AuthorizationStorageCollisionCase = {
  readonly request: ModuleExpertInvocationRequest;
  readonly authorizations: readonly ModuleExpertAuthorization[];
  readonly expectedMessage: string;
};

async function createDepthThreeFixtureLineage(
  args: InvalidDepthThreeParentCase,
): Promise<void> {
  const immediate = directParent(args.request);
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
    output: moduleDevelopmentPlanOutput([authorization(args.request)]),
  } as const;
  await createCompletedAttempt(rootPlanArgs);
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
  await createCompletedAttempt(immediateArgs);
}

type ParentSetupArgs = {
  readonly request: ModuleExpertInvocationRequest;
};

type ParentSetup = (args: ParentSetupArgs) => Promise<void>;

type ParentSetupCase = {
  readonly name: string;
  readonly setup: ParentSetup;
};

async function setupAbsentParent(_args: ParentSetupArgs): Promise<void> {}

async function setupFailedParent(args: ParentSetupArgs): Promise<void> {
  const parent = directParent(args.request);
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
  await createFailedAttempt(failedArgs);
}

async function setupDriftedParent(args: ParentSetupArgs): Promise<void> {
  const planArgs: CreateDirectPlanArgs = {
    request: args.request,
    sourceCommit: DRIFTED_SOURCE_COMMIT,
    authorization: authorization(args.request),
  };
  await createDirectPlan(planArgs);
}

async function setupUnauthorizedParent(args: ParentSetupArgs): Promise<void> {
  const unauthorized = {
    ...authorization(args.request),
    expert: 'different_expert',
  };
  const planArgs: CreateDirectPlanArgs = {
    request: args.request,
    sourceCommit: args.request.sourceCommit,
    authorization: unauthorized,
  };
  await createDirectPlan(planArgs);
}

async function setupCorruptedParent(args: ParentSetupArgs): Promise<void> {
  const planArgs: CreateDirectPlanArgs = {
    request: args.request,
    sourceCommit: args.request.sourceCommit,
    authorization: authorization(args.request),
  };
  await createDirectPlan(planArgs);
  const parent = directParent(args.request);
  const resultPath = join(
    processingRunDirectory(args.request.runId),
    'agents',
    parent.task,
    `attempt-${parent.attempt}`,
    'result.json',
  );
  const serialized = await readFile(resultPath, 'utf8');
  await writeFile(resultPath, `${serialized}corrupted`, 'utf8');
}

type CreateDirectPlanArgs = {
  readonly request: ModuleExpertInvocationRequest;
  readonly sourceCommit: string;
  readonly authorization: ModuleExpertAuthorization;
};

async function createDirectPlan(args: CreateDirectPlanArgs): Promise<void> {
  const parent = directParent(args.request);
  const completedArgs = {
    repoRoot: REPO_ROOT,
    runId: args.request.runId,
    sourceCommit: args.sourceCommit,
    task: parent.task,
    agent: parent.agent,
    attempt: parent.attempt,
    depth: 1,
    parent: { kind: AgentAttemptParentKind.WorkflowRoot },
    output: moduleDevelopmentPlanOutput([args.authorization]),
  } as const;
  await createCompletedAttempt(completedArgs);
}

type CreateDepthThreeLineageArgs = {
  readonly request: ModuleExpertInvocationRequest;
  readonly authorization: ModuleExpertAuthorization;
};

async function createDepthThreeLineage(
  args: CreateDepthThreeLineageArgs,
): Promise<void> {
  const immediate = directParent(args.request);
  const root: ParentAgentAttempt = {
    kind: AgentAttemptParentKind.AgentAttempt,
    task: 'feature-synthesis',
    agent: 'delivery-owner',
    attempt: 1,
  };
  const intermediateRequest: ModuleExpertInvocationRequest = {
    runId: args.request.runId,
    expert: immediate.agent,
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
    output: moduleDevelopmentPlanOutput([
      authorization(intermediateRequest),
      args.authorization,
    ]),
  } as const;
  await createCompletedAttempt(rootPlanArgs);
  const runtime = new CountingRuntime(intermediateRequest.runId);
  const invocationInput: InvocationArgs = {
    request: intermediateRequest,
  };
  try {
    const intermediateResult = await invokeModuleExpert(
      invocationArgs(invocationInput),
    );
    if (intermediateResult.terminal.kind !== TaskTerminalKind.Completed) {
      throw new Error('Expected completed intermediate module expert fixture.');
    }
  } finally {
    runtime.dispose();
  }
}

type InvocationArgs = {
  readonly request: ModuleExpertInvocationRequest;
};

function invocationArgs(args: InvocationArgs): InvokeModuleExpertArgs {
  const controller = new AbortController();
  return {
    repoRoot: REPO_ROOT,
    request: args.request,
    signal: controller.signal,
  };
}

function authorization(
  request: ModuleExpertInvocationRequest,
): ModuleExpertAuthorization {
  return {
    task: request.task,
    expert: request.expert,
    attempt: request.attempt,
    depth: request.depth,
    parent: directParent(request),
  };
}

function directParent(
  request: ModuleExpertInvocationRequest,
): ParentAgentAttempt {
  if (request.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
    throw new Error('Expected parent agent attempt in the test fixture.');
  }
  return request.parent;
}

function directRequest(runId: string): ModuleExpertInvocationRequest {
  return {
    runId,
    expert: 'core_expert',
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

function depthThreeRequest(runId: string): ModuleExpertInvocationRequest {
  const request = directRequest(runId);
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

function processingRunDirectory(runId: string): string {
  return join(
    REPO_ROOT,
    'workflow',
    'processing',
    DelegatedAgentWorkflowName.AgentWork,
    runId,
  );
}
