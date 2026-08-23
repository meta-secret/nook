import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { McpToolCallItem, ThreadEvent } from '@openai/codex-sdk';
import { describe, expect, test } from 'bun:test';
import {
  AgentSourceStabilityPhase,
  assertAgentSourceStable,
  collectCodexTurn,
} from '../../src/agent-workflow/codex-runtime.ts';
import type {
  AgentSourceStabilityCheck,
  CollectCodexTurnArgs,
} from '../../src/agent-workflow/codex-runtime.ts';
import { replayAgentAttemptJournal } from '../../src/agent-workflow/agent-replay.ts';
import type { AgentAttemptEvent } from '../../src/agent-workflow/agent-events.ts';
import {
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import type { WorkflowTaskOutput } from '../../src/agent-workflow/domain.ts';
import { WorkflowRuntimeActivityKind } from '../../src/agent-workflow/events.ts';
import type { RuntimeActivityObservation } from '../../src/agent-workflow/events.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';
import { runCommand } from '../../src/lib/run.ts';
import type { RunCommandArgs } from '../../src/lib/run.ts';
import { invokeModuleExpert } from '../../src/module-experts/invoke.ts';
import type {
  InvokeModuleExpertArgs,
  ModuleExpertInvocationRequest,
} from '../../src/module-experts/invoke.ts';
import { createAuthorizedDirectParent } from '../module-experts/invoke-parent-fixture.ts';
import { registerModuleExpertRuntimeMock } from '../module-experts/module-expert-runtime-mock.ts';
import type { RegisterModuleExpertRuntimeMockArgs } from '../module-experts/module-expert-runtime-mock.ts';
import { MODULE_EXPERT_READ_CONTEXT_TOOLS } from '../../src/module-experts/read-context-mcp.ts';
import { MODULE_EXPERT_CONTEXT_MCP } from '../../src/module-experts/runtime-contract.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const REMOVE_RECURSIVELY: RmOptions = { recursive: true, force: true };

function runGit(command: RunCommandArgs): string {
  const result = runCommand(command);
  expect(result.exitCode).toBe(0);
  return result.stdout.trim();
}

describe('Codex agent source stability', () => {
  test('fails closed for commit or worktree drift', async () => {
    const workingDirectory = await mkdtemp(
      join(tmpdir(), 'loom-agent-source-stability-'),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const initCommand: RunCommandArgs = {
        command: 'git',
        args: ['init'],
        cwd: workingDirectory,
      };
      runGit(initCommand);
      const identityCommand: RunCommandArgs = {
        command: 'git',
        args: [
          '-c',
          'user.name=Loom Test',
          '-c',
          'user.email=loom@example.test',
        ],
        cwd: workingDirectory,
      };
      const trackedPath = join(workingDirectory, 'tracked.txt');
      await writeFile(trackedPath, 'stable\n');
      const addCommand: RunCommandArgs = {
        command: 'git',
        args: ['add', 'tracked.txt'],
        cwd: workingDirectory,
      };
      runGit(addCommand);
      const commitCommand: RunCommandArgs = {
        ...identityCommand,
        args: [
          '-c',
          'user.name=Loom Test',
          '-c',
          'user.email=loom@example.test',
          'commit',
          '-m',
          'fixture',
        ],
      };
      runGit(commitCommand);
      const headCommand: RunCommandArgs = {
        command: 'git',
        args: ['rev-parse', 'HEAD'],
        cwd: workingDirectory,
      };
      const sourceCommit = runGit(headCommand);
      const stableCheck: AgentSourceStabilityCheck = {
        workingDirectory,
        sourceCommit,
        phase: AgentSourceStabilityPhase.BeforeAttempt,
      };
      expect(() => assertAgentSourceStable(stableCheck)).not.toThrow();

      const wrongCommitCheck: AgentSourceStabilityCheck = {
        ...stableCheck,
        sourceCommit: '0000000000000000000000000000000000000000',
      };
      expect(() => assertAgentSourceStable(wrongCommitCheck)).toThrow(
        'is not at immutable commit',
      );

      const untrackedPath = join(workingDirectory, 'untracked.txt');
      await writeFile(untrackedPath, 'drifted\n');
      expect(() => assertAgentSourceStable(stableCheck)).toThrow(
        'worktree is not clean before attempt',
      );
      await unlink(untrackedPath);

      await writeFile(trackedPath, 'drifted\n');
      const dirtyCheck: AgentSourceStabilityCheck = {
        ...stableCheck,
        phase: AgentSourceStabilityPhase.AfterAttempt,
      };
      expect(() => assertAgentSourceStable(dirtyCheck)).toThrow(
        'worktree is not clean after attempt',
      );
    } finally {
      await rm(workingDirectory, removeOptions);
    }
  });
});

describe('Codex streamed turn terminal state', () => {
  test('requires an explicit successful turn terminal', async () => {
    const completedEvents = [
      threadStartedEvent(),
      agentMessageEvent(),
      turnCompletedEvent(),
    ];
    const completedStreamArgs: FakeThreadEventStreamArgs = {
      events: completedEvents,
    };
    const completedArgs: CollectCodexTurnArgs = {
      events: fakeThreadEventStream(completedStreamArgs),
      expectedResultKind: WorkflowResultKind.CortexEvidence,
      observe: async () => {},
    };

    const completion = await collectCodexTurn(completedArgs);
    expect(completion.threadId).toBe('streamed-thread');
    expect(completion.output.resultKind).toBe(
      WorkflowResultKind.CortexEvidence,
    );

    const unterminatedEvents = [threadStartedEvent(), agentMessageEvent()];
    const unterminatedStreamArgs: FakeThreadEventStreamArgs = {
      events: unterminatedEvents,
    };
    const unterminatedArgs: CollectCodexTurnArgs = {
      events: fakeThreadEventStream(unterminatedStreamArgs),
      expectedResultKind: WorkflowResultKind.CortexEvidence,
      observe: async () => {},
    };
    await expect(collectCodexTurn(unterminatedArgs)).rejects.toThrow(
      'without a thread identity or structured result',
    );
  });

  test('keeps turn failure authoritative across event ordering', async () => {
    const sequences: readonly (readonly ThreadEvent[])[] = [
      [threadStartedEvent(), agentMessageEvent(), turnFailedEvent()],
      [
        threadStartedEvent(),
        fatalErrorEvent(),
        agentMessageEvent(),
        turnCompletedEvent(),
      ],
      [
        threadStartedEvent(),
        turnFailedEvent(),
        agentMessageEvent(),
        turnCompletedEvent(),
      ],
    ];

    for (const events of sequences) {
      const observations: RuntimeActivityObservation[] = [];
      const streamArgs: FakeThreadEventStreamArgs = { events };
      const collectArgs: CollectCodexTurnArgs = {
        events: fakeThreadEventStream(streamArgs),
        expectedResultKind: WorkflowResultKind.CortexEvidence,
        observe: async (observation) => {
          observations.push(observation);
        },
      };

      await expect(collectCodexTurn(collectArgs)).rejects.toThrow(
        'Codex turn failed',
      );
      expect(
        observations.some(
          (observation) =>
            observation.activity === WorkflowRuntimeActivityKind.TurnFailed ||
            observation.activity === WorkflowRuntimeActivityKind.RuntimeError,
        ),
      ).toBe(true);
    }
  });

  test('records bounded source-read activity without MCP payloads', async () => {
    const events = [
      threadStartedEvent(),
      completedSourceReadEvent(),
      failedSourceReadEvent(),
      agentMessageEvent(),
      turnCompletedEvent(),
    ];
    const observations: RuntimeActivityObservation[] = [];
    const streamArgs: FakeThreadEventStreamArgs = { events };
    const collectArgs: CollectCodexTurnArgs = {
      events: fakeThreadEventStream(streamArgs),
      expectedResultKind: WorkflowResultKind.CortexEvidence,
      observe: async (observation) => {
        observations.push(observation);
      },
    };

    await collectCodexTurn(collectArgs);

    const sourceReads = observations.filter(
      (observation) =>
        observation.activity ===
        WorkflowRuntimeActivityKind.SourceReadCompleted,
    );
    expect(sourceReads).toEqual([
      {
        activity: WorkflowRuntimeActivityKind.SourceReadCompleted,
        detail: 'Repository file read completed.',
      },
      {
        activity: WorkflowRuntimeActivityKind.SourceReadCompleted,
        detail: 'Repository text search failed.',
      },
    ]);
    const serializedObservations = JSON.stringify(observations);
    expect(serializedObservations).not.toContain('private-read-argument');
    expect(serializedObservations).not.toContain('private-read-result');
    expect(serializedObservations).not.toContain('private-search-error');
    expect(
      sourceReads.every((observation) => observation.detail.length < 64),
    ).toBe(true);
  });

  test('module invocation records failed evidence after a structured message then failure', async () => {
    const runtime = new FailingStreamAgentRuntime();
    const request = directExpertRequest(
      `module-expert-stream-failure-${randomUUID()}`,
    );
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
      expect(result.terminal.kind).not.toBe(TaskTerminalKind.Completed);
      const eventsPath = join(
        result.runDirectory,
        result.processing.events.path,
      );
      const eventsSerialized = await readFile(eventsPath, 'utf8');
      const events = parseAgentAttemptEvents(eventsSerialized);
      const replayRequest = { events };
      expect(replayAgentAttemptJournal(replayRequest).terminalKind).toBe(
        TaskTerminalKind.Failed,
      );
      expect(eventsSerialized).not.toContain('private streamed failure');
    } finally {
      runtimeMock.dispose();
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });
});

type FakeThreadEventStreamArgs = {
  readonly events: readonly ThreadEvent[];
};

async function* fakeThreadEventStream(
  args: FakeThreadEventStreamArgs,
): AsyncGenerator<ThreadEvent> {
  for (const event of args.events) {
    yield event;
  }
}

class FailingStreamAgentRuntime implements AgentTaskRuntime<string, string> {
  async executeAgent(
    invocation: AgentExecutionInvocation<string, string>,
  ): Promise<AgentExecutionCompletion> {
    const events = [
      threadStartedEvent(),
      agentMessageEvent(),
      turnFailedEvent(),
    ];
    const streamArgs: FakeThreadEventStreamArgs = { events };
    const collectArgs: CollectCodexTurnArgs = {
      events: fakeThreadEventStream(streamArgs),
      expectedResultKind: invocation.execution.resultKind,
      observe: invocation.observe,
    };
    return collectCodexTurn(collectArgs);
  }
}

function threadStartedEvent(): ThreadEvent {
  return { type: 'thread.started', thread_id: 'streamed-thread' };
}

function agentMessageEvent(): ThreadEvent {
  return {
    type: 'item.completed',
    item: {
      id: 'structured-message',
      type: 'agent_message',
      text: serializedEvidenceOutput(),
    },
  };
}

function completedSourceReadEvent(): ThreadEvent {
  const item: McpToolCallItem = {
    id: 'completed-source-read',
    type: 'mcp_tool_call',
    server: MODULE_EXPERT_CONTEXT_MCP,
    tool: MODULE_EXPERT_READ_CONTEXT_TOOLS[1],
    arguments: { path: 'private-read-argument' },
    result: {
      content: [{ type: 'text', text: 'private-read-result' }],
      structured_content: { path: 'private-read-result' },
    },
    status: 'completed',
  };
  return { type: 'item.completed', item };
}

function failedSourceReadEvent(): ThreadEvent {
  const item: McpToolCallItem = {
    id: 'failed-source-read',
    type: 'mcp_tool_call',
    server: MODULE_EXPERT_CONTEXT_MCP,
    tool: MODULE_EXPERT_READ_CONTEXT_TOOLS[2],
    arguments: { query: 'private-read-argument' },
    error: { message: 'private-search-error' },
    status: 'failed',
  };
  return { type: 'item.completed', item };
}

function turnFailedEvent(): ThreadEvent {
  return {
    type: 'turn.failed',
    error: { message: 'private streamed failure' },
  };
}

function fatalErrorEvent(): ThreadEvent {
  return { type: 'error', message: 'private streamed failure' };
}

function turnCompletedEvent(): ThreadEvent {
  return {
    type: 'turn.completed',
    usage: {
      input_tokens: 1,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0,
    },
  };
}

function serializedEvidenceOutput(): string {
  const output: WorkflowTaskOutput = {
    resultKind: WorkflowResultKind.CortexEvidence,
    summary: 'This output precedes a failed turn.',
    materializedViewMarkdown: '# Failed turn\n\nMust not complete.',
    findings: [],
    notesForParent: [],
    artifacts: [],
  };
  return JSON.stringify(output);
}

function directExpertRequest(runId: string): ModuleExpertInvocationRequest {
  return {
    runId,
    expert: 'core_expert',
    sourceCommit: SOURCE_COMMIT,
    task: 'inspect-stream-failure',
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

function processingRunDirectory(runId: string): string {
  return join(
    REPO_ROOT,
    'workflow',
    'processing',
    DelegatedAgentWorkflowName.AgentWork,
    runId,
  );
}

function parseAgentAttemptEvents(
  serialized: string,
): readonly AgentAttemptEvent[] {
  return serialized
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as AgentAttemptEvent);
}
