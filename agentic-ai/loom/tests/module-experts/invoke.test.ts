import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { replayAgentAttemptJournal } from '../../src/agent-workflow/agent-replay.ts';
import type { AgentAttemptEvent } from '../../src/agent-workflow/agent-events.ts';
import type { FailedTaskTerminal } from '../../src/agent-workflow/domain.ts';
import {
  AgentAttemptParentKind,
  AgentWorkspacePolicy,
  DelegatedAgentWorkflowName,
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
  TaskTerminalKind,
  WorkflowExecutorKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import { WorkflowRuntimeActivityKind } from '../../src/agent-workflow/events.ts';
import type { RuntimeActivityObservation } from '../../src/agent-workflow/events.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';
import { parseModuleExpertCommandLine } from '../../src/module-experts/cli.ts';
import {
  decodeModuleExpertInvocationRequest,
  invokeModuleExpert,
  verifyModuleExpertInvocationResult,
} from '../../src/module-experts/invoke.ts';
import type {
  InvokeModuleExpertArgs,
  ModuleExpertInvocationRequest,
} from '../../src/module-experts/invoke.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const REMOVE_RECURSIVELY: RmOptions = { recursive: true, force: true };

type ExtendedModuleExpertInvocationRequest = ModuleExpertInvocationRequest & {
  readonly allowWrites: boolean;
};

type ModuleExpertCommandArguments = string[];

class RecordingAgentRuntime implements AgentTaskRuntime<string, string> {
  invocation: AgentExecutionInvocation<string, string> | false = false;
  executionCount = 0;

  async executeAgent(
    invocation: AgentExecutionInvocation<string, string>,
  ): Promise<AgentExecutionCompletion> {
    this.executionCount += 1;
    this.invocation = invocation;
    const observation: RuntimeActivityObservation = {
      activity: WorkflowRuntimeActivityKind.TurnCompleted,
      detail: 'Codex turn completed.',
    };
    await invocation.observe(observation);
    return {
      threadId: 'module-expert-thread',
      output: {
        resultKind: WorkflowResultKind.CortexEvidence,
        summary: 'Core contract inspected.',
        materializedViewMarkdown: '# Core contract\n\nInspected.',
        findings: [],
        notesForParent: [],
        artifacts: [],
      },
    };
  }
}

class FailingAgentRuntime implements AgentTaskRuntime<string, string> {
  async executeAgent(
    invocation: AgentExecutionInvocation<string, string>,
  ): Promise<AgentExecutionCompletion> {
    const observation: RuntimeActivityObservation = {
      activity: WorkflowRuntimeActivityKind.TurnFailed,
      detail: 'Codex turn failed.',
    };
    await invocation.observe(observation);
    throw new Error('private runtime detail must not be recorded');
  }
}

class InvalidCompletionAgentRuntime implements AgentTaskRuntime<
  string,
  string
> {
  executionCount = 0;

  async executeAgent(
    invocation: AgentExecutionInvocation<string, string>,
  ): Promise<AgentExecutionCompletion> {
    this.executionCount += 1;
    const observation: RuntimeActivityObservation = {
      activity: WorkflowRuntimeActivityKind.TurnCompleted,
      detail: 'Codex turn completed.',
    };
    await invocation.observe(observation);
    return {
      threadId: '',
      output: {
        resultKind: WorkflowResultKind.CortexEvidence,
        summary: 'Invalid completion must not escape.',
        materializedViewMarkdown: '# Invalid completion\n\nMust fail.',
        findings: [],
        notesForParent: [],
        artifacts: [],
      },
    };
  }
}

describe('module expert invocation', () => {
  test('decodes a bounded exact request with direct expert lineage', () => {
    const request = directRequest('module-expert-decode');
    const serialized = JSON.stringify(request);

    expect(decodeModuleExpertInvocationRequest(serialized)).toEqual(request);
  });

  test('decodes bounded exceptional depth-three lineage', () => {
    const direct = directRequest('module-expert-child');
    const request: ModuleExpertInvocationRequest = {
      ...direct,
      depth: 3,
      parent: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: 'inspect-feature-modules',
        agent: 'module-planner',
        attempt: 2,
      },
    };

    expect(
      decodeModuleExpertInvocationRequest(JSON.stringify(request)),
    ).toEqual(request);
  });

  test('rejects malformed, unbounded, extended, and excessive-depth requests', () => {
    const valid = directRequest('module-expert-invalid');
    const invalidSourceRequest: ModuleExpertInvocationRequest = {
      ...valid,
      sourceCommit: 'main',
    };
    const extraFieldRequest: ExtendedModuleExpertInvocationRequest = {
      ...valid,
      allowWrites: true,
    };
    const unboundedInstructionRequest: ModuleExpertInvocationRequest = {
      ...valid,
      instruction: 'x'.repeat(16_385),
    };
    const excessiveDepthRequest: ModuleExpertInvocationRequest = {
      ...valid,
      depth: 4,
    };
    const workflowRootAtDepthTwoRequest: ModuleExpertInvocationRequest = {
      ...valid,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
    };
    const workflowRootAtDepthOneRequest: ModuleExpertInvocationRequest = {
      ...valid,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
    };
    const selfParentRequest: ModuleExpertInvocationRequest = {
      ...valid,
      depth: 2,
      parent: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: valid.task,
        agent: valid.expert,
        attempt: valid.attempt,
      },
    };
    const zeroAttemptRequest: ModuleExpertInvocationRequest = {
      ...valid,
      attempt: 0,
    };
    const fractionalAttemptRequest: ModuleExpertInvocationRequest = {
      ...valid,
      attempt: 1.5,
    };
    const childAtRootDepthRequest: ModuleExpertInvocationRequest = {
      ...valid,
      depth: 1,
    };
    const invalidParentAttemptRequest: ModuleExpertInvocationRequest = {
      ...valid,
      depth: 2,
      parent: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: 'parent-task',
        agent: 'parent-agent',
        attempt: 0,
      },
    };
    const unsafeRunRequest: ModuleExpertInvocationRequest = {
      ...valid,
      runId: '../escape',
    };
    const invalidRequests = [
      invalidSourceRequest,
      extraFieldRequest,
      unboundedInstructionRequest,
      excessiveDepthRequest,
      workflowRootAtDepthTwoRequest,
      workflowRootAtDepthOneRequest,
      selfParentRequest,
      zeroAttemptRequest,
      fractionalAttemptRequest,
      childAtRootDepthRequest,
      invalidParentAttemptRequest,
      unsafeRunRequest,
    ];

    for (const request of invalidRequests) {
      expect(() =>
        decodeModuleExpertInvocationRequest(JSON.stringify(request)),
      ).toThrow('request is invalid');
    }
  });

  test('invokes one read-only expert and finalizes immutable evidence', async () => {
    const runtime = new RecordingAgentRuntime();
    const request = directRequest(uniqueRunId('module-expert-success'));
    const runDirectory = processingRunDirectory(request.runId);
    const controller = new AbortController();
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      runtime,
      signal: controller.signal,
    };
    try {
      const result = await invokeModuleExpert(invokeArgs);

      expect(result.expert).toBe('core_expert');
      expect(result.agentDefinitionPath).toBe(
        '.codex/agents/module-experts/core_expert.toml',
      );
      expect(result.agentDefinitionSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(result.runId).toBe(request.runId);
      expect(result.attempt).toBe(request.attempt);
      expect(result.depth).toBe(request.depth);
      expect(result.parent).toEqual(request.parent);
      expect(result.terminal.kind).toBe(TaskTerminalKind.Completed);
      if (result.terminal.kind !== TaskTerminalKind.Completed) {
        throw new Error('Expected completed module expert terminal.');
      }
      expect(result.terminal.threadId).toBe('module-expert-thread');
      expect(result.terminal.output.resultKind).toBe(
        WorkflowResultKind.CortexEvidence,
      );
      expect(runtime.invocation).not.toBe(false);
      if (!runtime.invocation) throw new Error('Expected captured invocation.');
      expect(runtime.invocation.runId).toBe(request.runId);
      expect(runtime.invocation.attempt).toBe(request.attempt);
      expect(runtime.invocation.agentProfile.name).toBe('core_expert');
      expect(runtime.invocation.agentProfile.workspacePolicy).toBe(
        AgentWorkspacePolicy.ReadOnly,
      );
      expect(runtime.invocation.execution.kind).toBe(
        WorkflowExecutorKind.Agent,
      );
      expect(runtime.invocation.execution.resultKind).toBe(
        WorkflowResultKind.CortexEvidence,
      );
      expect(runtime.invocation.execution.instruction).toContain(
        'nook-app/nook-platform/nook-core',
      );
      expect(runtime.invocation.execution.instruction).toContain(
        request.instruction,
      );
      const eventsPath = join(
        result.runDirectory,
        result.processing.events.path,
      );
      const eventsSerialized = await readFile(eventsPath, 'utf8');
      const events = await readEvents(eventsPath);
      for (const [index, event] of events.entries()) {
        expect(event.runId).toBe(request.runId);
        expect(event.sourceCommit).toBe(request.sourceCommit);
        expect(event.task).toBe(request.task);
        expect(event.agent).toBe(request.expert);
        expect(event.attempt).toBe(request.attempt);
        expect(event.depth).toBe(request.depth);
        expect(event.parent).toEqual(request.parent);
        expect(event.sequence).toBe(index + 1);
      }
      expect(result.processing.events.sha256).toBe(sha256(eventsSerialized));
      expect(
        events.some(
          (event) =>
            event.kind === 'runtime-activity' &&
            event.activity === WorkflowRuntimeActivityKind.TurnCompleted,
        ),
      ).toBe(true);
      const replayRequest = { events };
      expect(replayAgentAttemptJournal(replayRequest).terminalKind).toBe(
        TaskTerminalKind.Completed,
      );
      expect(result.processing.view.presence).toBe(
        MaterializedViewPresence.Recorded,
      );
      if (
        result.processing.view.presence === MaterializedViewPresence.Recorded
      ) {
        expect(result.processing.view.authorKind).toBe(
          MaterializedViewAuthorKind.Agent,
        );
      }
    } finally {
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });

  test('rejects a duplicate immutable attempt before running it again', async () => {
    const runtime = new RecordingAgentRuntime();
    const request = directRequest(uniqueRunId('module-expert-duplicate'));
    const runDirectory = processingRunDirectory(request.runId);
    const controller = new AbortController();
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      runtime,
      signal: controller.signal,
    };
    try {
      await invokeModuleExpert(invokeArgs);

      await expect(invokeModuleExpert(invokeArgs)).rejects.toThrow();
      expect(runtime.executionCount).toBe(1);
    } finally {
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });

  test('finalizes a failed terminal when the runtime throws', async () => {
    const runtime = new FailingAgentRuntime();
    const request = directRequest(uniqueRunId('module-expert-failure'));
    const runDirectory = processingRunDirectory(request.runId);
    const controller = new AbortController();
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      runtime,
      signal: controller.signal,
    };
    try {
      const result = await invokeModuleExpert(invokeArgs);

      const expectedTerminal: FailedTaskTerminal<string> = {
        kind: TaskTerminalKind.Failed,
        task: request.task,
        attempt: request.attempt,
        summary: 'Module expert runtime failed.',
      };
      expect(result.terminal).toEqual(expectedTerminal);
      const eventsPath = join(
        result.runDirectory,
        result.processing.events.path,
      );
      const eventsSerialized = await readFile(eventsPath, 'utf8');
      const events = await readEvents(eventsPath);
      expect(eventsSerialized).not.toContain('private runtime detail');
      expect(
        events.some(
          (event) =>
            event.kind === 'runtime-activity' &&
            event.activity === WorkflowRuntimeActivityKind.RuntimeError &&
            event.detail === 'Module expert runtime failed.',
        ),
      ).toBe(true);
      const replayRequest = { events };
      expect(replayAgentAttemptJournal(replayRequest).terminalKind).toBe(
        TaskTerminalKind.Failed,
      );
      expect(result.processing.view.presence).toBe(
        MaterializedViewPresence.Recorded,
      );
      if (
        result.processing.view.presence === MaterializedViewPresence.Recorded
      ) {
        expect(result.processing.view.authorKind).toBe(
          MaterializedViewAuthorKind.LoomRuntime,
        );
      }
      const resultPath = join(
        result.runDirectory,
        result.processing.result.path,
      );
      const resultSerialized = await readFile(resultPath, 'utf8');
      expect(JSON.parse(resultSerialized)).toEqual(result.terminal);
    } finally {
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });

  test('finalizes replayable failure when the runtime resolves invalid completion', async () => {
    const runtime = new InvalidCompletionAgentRuntime();
    const request = directRequest(uniqueRunId('module-expert-invalid-result'));
    const runDirectory = processingRunDirectory(request.runId);
    const controller = new AbortController();
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      runtime,
      signal: controller.signal,
    };
    try {
      const result = await invokeModuleExpert(invokeArgs);

      expect(runtime.executionCount).toBe(1);
      expect(result.terminal.kind).toBe(TaskTerminalKind.Failed);
      const eventsPath = join(
        result.runDirectory,
        result.processing.events.path,
      );
      const events = await readEvents(eventsPath);
      const replayRequest = { events };
      expect(replayAgentAttemptJournal(replayRequest).terminalKind).toBe(
        TaskTerminalKind.Failed,
      );
      expect(
        events.filter(
          (event) =>
            event.kind === 'attempt-terminal-recorded' &&
            event.terminalKind === TaskTerminalKind.Failed,
        ),
      ).toHaveLength(1);
    } finally {
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });

  test('rejects corrupted event, result, and view projection bytes', async () => {
    const runtime = new RecordingAgentRuntime();
    const request = directRequest(uniqueRunId('module-expert-corruption'));
    const runDirectory = processingRunDirectory(request.runId);
    const controller = new AbortController();
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      runtime,
      signal: controller.signal,
    };
    try {
      const result = await invokeModuleExpert(invokeArgs);
      if (
        result.processing.view.presence !== MaterializedViewPresence.Recorded
      ) {
        throw new Error('Expected recorded module expert view.');
      }
      const projectionPaths = [
        result.processing.events.path,
        result.processing.result.path,
        result.processing.view.projection.path,
      ];

      for (const projectionPath of projectionPaths) {
        const absolutePath = join(result.runDirectory, projectionPath);
        const original = await readFile(absolutePath, 'utf8');
        await writeFile(absolutePath, `${original}corrupted`, 'utf8');
        const verificationArgs = { result };
        await expect(
          verifyModuleExpertInvocationResult(verificationArgs),
        ).rejects.toThrow('processing verification failed');
        await writeFile(absolutePath, original, 'utf8');
      }
    } finally {
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });

  test('rejects invalid direct lineage before runtime or journal creation', async () => {
    const runtime = new RecordingAgentRuntime();
    const valid = directRequest(uniqueRunId('module-expert-lineage'));
    const workflowRootRequest: ModuleExpertInvocationRequest = {
      ...valid,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
    };
    const depthOneRequest: ModuleExpertInvocationRequest = {
      ...valid,
      depth: 1,
    };
    const depthFourRequest: ModuleExpertInvocationRequest = {
      ...valid,
      depth: 4,
    };
    const invalidParentAttemptRequest: ModuleExpertInvocationRequest = {
      ...valid,
      parent: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: 'feature-synthesis',
        agent: 'delivery-owner',
        attempt: 0,
      },
    };
    const selfParentRequest: ModuleExpertInvocationRequest = {
      ...valid,
      parent: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: valid.task,
        agent: valid.expert,
        attempt: valid.attempt,
      },
    };
    const invalidRequests = [
      workflowRootRequest,
      depthOneRequest,
      depthFourRequest,
      invalidParentAttemptRequest,
      selfParentRequest,
    ];
    const controller = new AbortController();

    for (const request of invalidRequests) {
      const invokeArgs: InvokeModuleExpertArgs = {
        repoRoot: REPO_ROOT,
        request,
        runtime,
        signal: controller.signal,
      };
      await expect(invokeModuleExpert(invokeArgs)).rejects.toThrow(
        'request is invalid',
      );
    }
    expect(runtime.executionCount).toBe(0);
    const runDirectory = processingRunDirectory(valid.runId);
    expect(Bun.file(runDirectory).exists()).resolves.toBe(false);
  });

  test('revalidates the complete direct request before runtime execution', async () => {
    const runtime = new RecordingAgentRuntime();
    const valid = directRequest(uniqueRunId('module-expert-direct-request'));
    const oversizedRequest: ModuleExpertInvocationRequest = {
      ...valid,
      instruction: 'x'.repeat(16_385),
    };
    const controlRequest: ModuleExpertInvocationRequest = {
      ...valid,
      instruction: 'Inspect the contract.\u0000',
    };
    const extendedRequest: ExtendedModuleExpertInvocationRequest = {
      ...valid,
      allowWrites: true,
    };
    const invalidRequests = [oversizedRequest, controlRequest, extendedRequest];
    const controller = new AbortController();

    for (const request of invalidRequests) {
      const invokeArgs: InvokeModuleExpertArgs = {
        repoRoot: REPO_ROOT,
        request,
        runtime,
        signal: controller.signal,
      };
      await expect(invokeModuleExpert(invokeArgs)).rejects.toThrow(
        'request is invalid',
      );
    }
    expect(runtime.executionCount).toBe(0);
    const runDirectory = processingRunDirectory(valid.runId);
    expect(Bun.file(runDirectory).exists()).resolves.toBe(false);
  });

  test('rejects an unregistered expert before creating attempt evidence', async () => {
    const runtime = new RecordingAgentRuntime();
    const direct = directRequest(uniqueRunId('module-expert-unknown'));
    const request: ModuleExpertInvocationRequest = {
      ...direct,
      expert: 'shadow_expert',
    };
    const runDirectory = processingRunDirectory(request.runId);
    const controller = new AbortController();
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      runtime,
      signal: controller.signal,
    };

    await expect(invokeModuleExpert(invokeArgs)).rejects.toThrow(
      'not registered',
    );
    expect(runtime.invocation).toBe(false);
    expect(Bun.file(runDirectory).exists()).resolves.toBe(false);
  });

  test('parses validate and invoke CLI commands without scheduler state', () => {
    const validateArguments: ModuleExpertCommandArguments = [
      'validate',
      '--working-directory',
      REPO_ROOT,
    ];
    const invokeArguments: ModuleExpertCommandArguments = [
      'invoke',
      '--request',
      '/tmp/module-expert-request.json',
      '--working-directory',
      REPO_ROOT,
    ];
    const invalidArguments: ModuleExpertCommandArguments = ['invoke'];
    const validate = parseModuleExpertCommandLine(validateArguments);
    const invoke = parseModuleExpertCommandLine(invokeArguments);

    expect(validate).not.toBe(false);
    expect(invoke).not.toBe(false);
    expect(parseModuleExpertCommandLine(invalidArguments)).toBe(false);
  });

  test('CLI rejects invalid requests before starting a Codex thread', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-expert-invoke-'));
    try {
      const requestPath = join(fixtureRoot, 'request.json');
      await writeFile(requestPath, '{"expert":"core_expert"}', 'utf8');
      const command: ModuleExpertCommandArguments = [
        process.execPath,
        join(import.meta.dir, '../../src/module-experts/cli.ts'),
        'invoke',
        '--request',
        requestPath,
        '--working-directory',
        REPO_ROOT,
      ];
      const spawnOptions = {
        stdout: 'pipe',
        stderr: 'pipe',
      } as const;
      const processResult = Bun.spawn(command, spawnOptions);
      const exitCode = await processResult.exited;
      const stdout = await new Response(processResult.stdout).text();
      const stderr = await new Response(processResult.stderr).text();

      expect(exitCode).toBe(1);
      expect(stdout).toBe('');
      expect(stderr).toBe('Module expert command failed.\n');
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });
});

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
    instruction: 'Describe the external vault API used by nook-wasm.',
  };
}

function uniqueRunId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
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

async function readEvents(eventsPath: string): Promise<AgentAttemptEvent[]> {
  const serialized = await readFile(eventsPath, 'utf8');
  return serialized
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as AgentAttemptEvent);
}

function sha256(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex');
}
