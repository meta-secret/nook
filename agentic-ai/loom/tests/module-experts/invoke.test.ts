import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  AgentAttemptJournal,
  type AgentAttemptJournalConfiguration,
} from '../../src/agent-workflow/agent-journal.ts';
import { replayAgentAttemptJournal } from '../../src/agent-workflow/agent-replay.ts';
import type { AgentAttemptEvent } from '../../src/agent-workflow/agent-events.ts';
import type {
  CompletedTaskTerminal,
  FailedTaskTerminal,
  ModuleExpertContinuation,
  TaskTerminal,
} from '../../src/agent-workflow/domain.ts';
import {
  AgentAttemptAdapterKind,
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
  invokeModuleExpert,
  verifyModuleExpertInvocationResult,
} from '../../src/module-experts/invoke.ts';
import type {
  InvokeModuleExpertArgs,
  ModuleExpertInvocationResult,
  ModuleExpertInvocationRequest,
} from '../../src/module-experts/invoke.ts';
import { MODULE_EXPERT_WORKFLOW_VERSION } from '../../src/module-experts/trusted-runtime.ts';
import { createAuthorizedDirectParent } from './invoke-parent-fixture.ts';
import { registerModuleExpertRuntimeMock } from './module-expert-runtime-mock.ts';
import type { RegisterModuleExpertRuntimeMockArgs } from './module-expert-runtime-mock.ts';
import type { WebExpertAllowedContextPath } from '../../src/module-experts/catalog.ts';

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
        summary: 'Core contract inspected.',
        materializedViewMarkdown: '# Core contract\n\nInspected.',
        findings: [],
        notesForParent: [],
        artifacts: [],
        resultKind: WorkflowResultKind.ModuleExpertEvidence,
        continuation: moduleExpertContinuation(),
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
        resultKind: WorkflowResultKind.ModuleExpertEvidence,
        summary: 'Invalid completion must not escape.',
        materializedViewMarkdown: '# Invalid completion\n\nMust fail.',
        findings: [],
        notesForParent: [],
        artifacts: [],
        continuation: moduleExpertContinuation(),
      },
    };
  }
}

class MissingContinuationAgentRuntime implements AgentTaskRuntime<
  string,
  string
> {
  async executeAgent(
    invocation: AgentExecutionInvocation<string, string>,
  ): Promise<AgentExecutionCompletion> {
    const observation: RuntimeActivityObservation = {
      activity: WorkflowRuntimeActivityKind.TurnCompleted,
      detail: 'Codex turn completed.',
    };
    await invocation.observe(observation);
    const incompleteCompletion = {
      threadId: 'incomplete-module-expert-thread',
      output: {
        resultKind: WorkflowResultKind.ModuleExpertEvidence,
        summary: 'Prompt-compliant prose without continuation data.',
        materializedViewMarkdown:
          '# Complete-looking report\n\nAll requested headings are present.',
        findings: [],
        notesForParent: [],
        artifacts: [],
      },
    };
    return JSON.parse(
      JSON.stringify(incompleteCompletion),
    ) as AgentExecutionCompletion;
  }
}

describe('module expert invocation runtime', () => {
  test('invokes one read-only expert and finalizes immutable evidence', async () => {
    const runtime = new RecordingAgentRuntime();
    const request = directRequest(uniqueRunId('module-expert-success'));
    const runDirectory = processingRunDirectory(request.runId);
    const controller = new AbortController();
    const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
      runId: request.runId,
      runtime,
    };
    const runtimeMock = registerModuleExpertRuntimeMock(runtimeMockArgs);
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      signal: controller.signal,
    };
    try {
      await createAuthorizedDirectParent(request);
      const result = await invokeModuleExpert(invokeArgs);

      expect(result.expert).toBe('core_expert');
      expect(result.selectedContextPaths).toEqual([]);
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
        WorkflowResultKind.ModuleExpertEvidence,
      );
      expect(result.terminal.output.continuation).toEqual(
        moduleExpertContinuation(),
      );
      expect(runtime.invocation).not.toBe(false);
      if (!runtime.invocation) throw new Error('Expected captured invocation.');
      expect(runtime.invocation.runId).toBe(request.runId);
      expect(runtime.invocation.task).toBe(request.task);
      expect(runtime.invocation.attempt).toBe(request.attempt);
      expect(runtime.invocation.sourceCommit).toBe(request.sourceCommit);
      expect(runtime.invocation.signal).toBe(controller.signal);
      expect(runtime.invocation.upstreamOutputs).toEqual([]);
      expect(runtime.invocation.agentProfile.name).toBe('core_expert');
      expect(runtime.invocation.agentProfile.workspacePolicy).toBe(
        AgentWorkspacePolicy.ReadOnly,
      );
      expect(runtime.invocation.execution.kind).toBe(
        WorkflowExecutorKind.Agent,
      );
      expect(runtime.invocation.execution.resultKind).toBe(
        WorkflowResultKind.ModuleExpertEvidence,
      );
      expect(runtime.invocation.execution.instruction).toContain(
        'nook-app/nook-platform/nook-core',
      );
      expect(runtime.invocation.execution.instruction).toContain(
        request.instruction,
      );
      expect(runtime.invocation.execution.instruction).toContain(
        'unresolvedDecisions',
      );
      const eventsPath = join(
        result.runDirectory,
        result.processing.events.path,
      );
      const eventsSerialized = await readFile(eventsPath, 'utf8');
      const events = await readEvents(eventsPath);
      for (const [index, event] of events.entries()) {
        expect(event.adapter).toBe(
          AgentAttemptAdapterKind.ModuleExpertInvocation,
        );
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
      const resultPath = join(
        result.runDirectory,
        result.processing.result.path,
      );
      const projectedTerminal = JSON.parse(
        await readFile(resultPath, 'utf8'),
      ) as TaskTerminal<string>;
      expect(projectedTerminal).toEqual(result.terminal);
      if (projectedTerminal.kind !== TaskTerminalKind.Completed) {
        throw new Error('Expected projected completed module expert terminal.');
      }
      expect(projectedTerminal.output.continuation).toEqual(
        moduleExpertContinuation(),
      );
    } finally {
      runtimeMock.dispose();
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });

  test('binds exact web context selection into invocation and runtime evidence', async () => {
    const runtime = new RecordingAgentRuntime();
    const selectedContextPaths: readonly WebExpertAllowedContextPath[] = [
      '.cortex/teams/web-dev/product-specs/browser-extension.md',
      '.github/workflows/release.yml',
      '.cortex/teams/web-dev/dynamic-skills/ui-design-skills.md',
      '.cortex/teams/security/dynamic-skills/browser-extension-release-security.md',
      '.cortex/teams/security/dynamic-skills/browser-extension-release-security.md',
    ];
    const request: ModuleExpertInvocationRequest = {
      ...directRequest(uniqueRunId('web-expert-context-evidence')),
      expert: 'web_expert',
      selectedContextPaths,
    };
    const runDirectory = processingRunDirectory(request.runId);
    const controller = new AbortController();
    const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
      runId: request.runId,
      runtime,
    };
    const runtimeMock = registerModuleExpertRuntimeMock(runtimeMockArgs);
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      signal: controller.signal,
    };
    try {
      await createAuthorizedDirectParent(request);
      const result = await invokeModuleExpert(invokeArgs);

      expect(result.selectedContextPaths).toEqual(selectedContextPaths);
      if (!runtime.invocation) throw new Error('Expected captured invocation.');
      expect(runtime.invocation.agentProfile.name).toBe('web_expert');
      expect(runtime.invocation.execution.instruction).toContain(
        `Selected task context: ${JSON.stringify(selectedContextPaths)}`,
      );
    } finally {
      runtimeMock.dispose();
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });

  test('rejects a duplicate immutable attempt before running it again', async () => {
    const runtime = new RecordingAgentRuntime();
    const request = directRequest(uniqueRunId('module-expert-duplicate'));
    const runDirectory = processingRunDirectory(request.runId);
    const controller = new AbortController();
    const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
      runId: request.runId,
      runtime,
    };
    const runtimeMock = registerModuleExpertRuntimeMock(runtimeMockArgs);
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      signal: controller.signal,
    };
    try {
      await createAuthorizedDirectParent(request);
      await invokeModuleExpert(invokeArgs);

      await expect(invokeModuleExpert(invokeArgs)).rejects.toThrow();
      expect(runtime.executionCount).toBe(1);
    } finally {
      runtimeMock.dispose();
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });

  test('finalizes a failed terminal when the runtime throws', async () => {
    const runtime = new FailingAgentRuntime();
    const request = directRequest(uniqueRunId('module-expert-failure'));
    const runDirectory = processingRunDirectory(request.runId);
    const controller = new AbortController();
    const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
      runId: request.runId,
      runtime,
    };
    const runtimeMock = registerModuleExpertRuntimeMock(runtimeMockArgs);
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      signal: controller.signal,
    };
    try {
      await createAuthorizedDirectParent(request);
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
      runtimeMock.dispose();
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });

  test('finalizes replayable failure when the runtime resolves invalid completion', async () => {
    const runtime = new InvalidCompletionAgentRuntime();
    const request = directRequest(uniqueRunId('module-expert-invalid-result'));
    const runDirectory = processingRunDirectory(request.runId);
    const controller = new AbortController();
    const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
      runId: request.runId,
      runtime,
    };
    const runtimeMock = registerModuleExpertRuntimeMock(runtimeMockArgs);
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      signal: controller.signal,
    };
    try {
      await createAuthorizedDirectParent(request);
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
      runtimeMock.dispose();
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });

  test('finalizes replayable failure when expert evidence omits typed continuation', async () => {
    const runtime = new MissingContinuationAgentRuntime();
    const request = directRequest(uniqueRunId('module-expert-incomplete'));
    const runDirectory = processingRunDirectory(request.runId);
    const controller = new AbortController();
    const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
      runId: request.runId,
      runtime,
    };
    const runtimeMock = registerModuleExpertRuntimeMock(runtimeMockArgs);
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      signal: controller.signal,
    };
    try {
      await createAuthorizedDirectParent(request);
      const result = await invokeModuleExpert(invokeArgs);

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
        events.filter((event) => event.kind === 'attempt-terminal-recorded'),
      ).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain('Complete-looking report');
    } finally {
      runtimeMock.dispose();
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });

  test('rejects corrupted projections and a forged generic adapter', async () => {
    const runtime = new RecordingAgentRuntime();
    const request = directRequest(uniqueRunId('module-expert-corruption'));
    const runDirectory = processingRunDirectory(request.runId);
    const controller = new AbortController();
    const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
      runId: request.runId,
      runtime,
    };
    const runtimeMock = registerModuleExpertRuntimeMock(runtimeMockArgs);
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      signal: controller.signal,
    };
    try {
      await createAuthorizedDirectParent(request);
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

      const reboundContextResult: ModuleExpertInvocationResult = {
        ...result,
        selectedContextPaths: [
          '.cortex/teams/web-dev/product-specs/browser-extension.md',
        ],
      };
      const reboundContextVerification = { result: reboundContextResult };
      await expect(
        verifyModuleExpertInvocationResult(reboundContextVerification),
      ).rejects.toThrow('processing verification failed');

      const eventsPath = join(
        result.runDirectory,
        result.processing.events.path,
      );
      const originalEvents = await readFile(eventsPath, 'utf8');
      const forgedEvents = (await readEvents(eventsPath)).map((event) => ({
        ...event,
        adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
      }));
      const forgedEventsSerialized = `${forgedEvents
        .map((event) => JSON.stringify(event))
        .join('\n')}\n`;
      await writeFile(eventsPath, forgedEventsSerialized, 'utf8');
      const forgedResult: ModuleExpertInvocationResult = {
        ...result,
        processing: {
          ...result.processing,
          events: {
            ...result.processing.events,
            sha256: sha256(forgedEventsSerialized),
          },
        },
      };
      const forgedVerificationArgs = { result: forgedResult };
      await expect(
        verifyModuleExpertInvocationResult(forgedVerificationArgs),
      ).rejects.toThrow('processing verification failed');
      await writeFile(eventsPath, originalEvents, 'utf8');
    } finally {
      runtimeMock.dispose();
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });

  test('rejects generic Cortex evidence wrapped as module expert evidence', async () => {
    const request = directRequest(uniqueRunId('module-expert-forged-generic'));
    const runDirectory = await mkdtemp(
      join(tmpdir(), 'loom-module-expert-forged-generic-'),
    );
    const journalConfiguration: AgentAttemptJournalConfiguration = {
      adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
      runDirectory,
      runId: request.runId,
      workflow: DelegatedAgentWorkflowName.AgentWork,
      workflowVersion: MODULE_EXPERT_WORKFLOW_VERSION,
      sourceCommit: request.sourceCommit,
      task: request.task,
      agent: request.expert,
      attempt: request.attempt,
      depth: request.depth,
      parent: request.parent,
      now: () => '2026-08-22T00:00:00.000Z',
    };
    const journal = new AgentAttemptJournal<string>(journalConfiguration);
    const terminal: CompletedTaskTerminal<string> = {
      kind: TaskTerminalKind.Completed,
      task: request.task,
      attempt: request.attempt,
      threadId: 'generic-cortex-thread',
      output: {
        resultKind: WorkflowResultKind.CortexEvidence,
        summary: 'Generic evidence with matching invocation identity.',
        materializedViewMarkdown:
          '# Generic evidence\n\nThis is not module expert evidence.',
        findings: [],
        notesForParent: [],
        artifacts: [],
      },
    };

    try {
      await journal.initialize();
      const processing = await journal.finalize(terminal);
      const forgedResult: ModuleExpertInvocationResult = {
        runDirectory,
        runId: request.runId,
        expert: request.expert,
        selectedContextPaths: request.selectedContextPaths ?? [],
        sourceCommit: request.sourceCommit,
        task: request.task,
        attempt: request.attempt,
        depth: request.depth,
        parent: request.parent,
        terminal,
        processing,
      };
      const verificationArgs = { result: forgedResult };

      await expect(
        verifyModuleExpertInvocationResult(verificationArgs),
      ).rejects.toThrow('processing verification failed');
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
    const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
      runId: valid.runId,
      runtime,
    };
    const runtimeMock = registerModuleExpertRuntimeMock(runtimeMockArgs);

    try {
      for (const request of invalidRequests) {
        const invokeArgs: InvokeModuleExpertArgs = {
          repoRoot: REPO_ROOT,
          request,
          signal: controller.signal,
        };
        await expect(invokeModuleExpert(invokeArgs)).rejects.toThrow(
          'request is invalid',
        );
      }
      expect(runtime.executionCount).toBe(0);
      const runDirectory = processingRunDirectory(valid.runId);
      expect(Bun.file(runDirectory).exists()).resolves.toBe(false);
    } finally {
      runtimeMock.dispose();
    }
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
    const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
      runId: valid.runId,
      runtime,
    };
    const runtimeMock = registerModuleExpertRuntimeMock(runtimeMockArgs);

    try {
      for (const request of invalidRequests) {
        const invokeArgs: InvokeModuleExpertArgs = {
          repoRoot: REPO_ROOT,
          request,
          signal: controller.signal,
        };
        await expect(invokeModuleExpert(invokeArgs)).rejects.toThrow(
          'request is invalid',
        );
      }
      expect(runtime.executionCount).toBe(0);
      const runDirectory = processingRunDirectory(valid.runId);
      expect(Bun.file(runDirectory).exists()).resolves.toBe(false);
    } finally {
      runtimeMock.dispose();
    }
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
    const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
      runId: request.runId,
      runtime,
    };
    const runtimeMock = registerModuleExpertRuntimeMock(runtimeMockArgs);
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      signal: controller.signal,
    };

    try {
      await expect(invokeModuleExpert(invokeArgs)).rejects.toThrow(
        'not registered',
      );
      expect(runtime.executionCount).toBe(0);
      expect(Bun.file(runDirectory).exists()).resolves.toBe(false);
    } finally {
      runtimeMock.dispose();
    }
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
    instruction: 'Describe the external vault API used by nook-wasm.',
  };
}

function uniqueRunId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function moduleExpertContinuation(): ModuleExpertContinuation {
  return {
    externalApi: ['VaultService exposes typed vault operations.'],
    dependencies: ['nook-crypto supplies protected cryptographic primitives.'],
    consumers: ['nook-wasm consumes the public Rust facade.'],
    behaviorInvariants: ['Vault operations preserve domain state transitions.'],
    securityInvariants: [
      'Protected material never crosses the public projection.',
    ],
    compatibilityInvariants: ['The existing WASM DTO remains stable.'],
    owningTests: ['The nook-core suite owns domain behavior.'],
    focusedValidation: ['Run the focused nook-core behavior tests.'],
    risks: ['No new implementation risk was found.'],
    unresolvedDecisions: ['No unresolved decisions remain.'],
    parentActions: [
      'Use the facade contract when planning the consumer slice.',
    ],
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
