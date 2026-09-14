import assert from 'node:assert/strict';
import { type Result } from 'neverthrow';
import { type AgentExecutionFailure } from '../../src/agent-workflow/runtime.ts';
import { randomUUID } from 'node:crypto';

import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';

import { existsSync } from 'node:fs';

import type { RmOptions } from 'node:fs';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import type {
  CodexOptions,
  McpToolCallItem,
  ThreadEvent,
} from '@openai/codex-sdk';

import { describe, expect, test } from 'bun:test';

import {
  AgentCodexOptions,
  AgentSourceStabilityPhase,
  AgentSourceSnapshot,
  CodexTurn,
  TeamAgentRuntimeProfile,
} from '../../src/agent-workflow/codex-runtime.ts';

import type {
  AgentSourceStabilityCheck,
  CollectCodexTurnArgs,
} from '../../src/agent-workflow/codex-runtime.ts';

import { AgentAttemptReplay } from '../../src/agent-workflow/agent-replay.ts';
import { AgentAttemptTransport } from '../../src/agent-workflow/attempt-codec.ts';

import type { AgentAttemptEvent } from '../../src/agent-workflow/agent-events.ts';

import {
  AgentAttemptParentKind,
  AgentReasoningEffort,
  AgentServiceTier,
  AgentWorkspacePolicy,
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import {
  TEAM_GIZMO_CATALOG,
  TeamGizmoKey,
  TeamInternalAgentKey,
  TeamKey,
} from '../../src/team-agents/catalog.ts';

import type { WorkflowTaskOutput } from '../../src/agent-workflow/domain.ts';

import { WorkflowRuntimeActivityKind } from '../../src/agent-workflow/events.ts';

import type { RuntimeActivityObservation } from '../../src/agent-workflow/events.ts';

import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';

import {
  RepositoryCommand,
  RepositoryCommandExecutable,
} from '../../src/lib/run.ts';

import type { RepositoryCommandRequest } from '../../src/lib/run.ts';

import { ModuleExpertInvocation } from '../../src/module-experts/invoke.ts';

import type {
  InvokeModuleExpertArgs,
  ModuleExpertInvocationRequest,
} from '../../src/module-experts/invoke.ts';

import { ModuleExpertsInvokeParentFixtureScenario } from '../module-experts/invoke-parent-fixture.ts';

import { ModuleExpertsModuleExpertRuntimeMockScenario } from '../module-experts/module-expert-runtime-mock.ts';

import type { RegisterModuleExpertRuntimeMockArgs } from '../module-experts/module-expert-runtime-mock.ts';

import { MODULE_EXPERT_READ_CONTEXT_TOOLS } from '../../src/module-experts/read-context-mcp.ts';

import { MODULE_EXPERT_CONTEXT_MCP } from '../../src/module-experts/runtime-contract.ts';

export class AgentWorkflowCodexRuntimeScenario {
  private constructor(private readonly request: string) {}

  static runGit(command: RepositoryCommandRequest): string {
    const hostLaunch1 = new RepositoryCommand(command).execute();
    assert(hostLaunch1.isOk());
    const result = hostLaunch1.value;
    expect(result.exitCode).toBe(0);
    return result.stdout.trim();
  }

  static async *fakeThreadEventStream(
    args: FakeThreadEventStreamArgs,
  ): AsyncGenerator<ThreadEvent> {
    for (const event of args.events) {
      yield event;
    }
  }

  static threadStartedEvent(): ThreadEvent {
    return { type: 'thread.started', thread_id: 'streamed-thread' };
  }

  static agentMessageEvent(): ThreadEvent {
    return {
      type: 'item.completed',
      item: {
        id: 'structured-message',
        type: 'agent_message',
        text: AgentWorkflowCodexRuntimeScenario.serializedEvidenceOutput(),
      },
    };
  }

  static completedSourceReadEvent(): ThreadEvent {
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

  static failedSourceReadEvent(): ThreadEvent {
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

  static turnFailedEvent(): ThreadEvent {
    return {
      type: 'turn.failed',
      error: { message: 'private streamed failure' },
    };
  }

  static fatalErrorEvent(): ThreadEvent {
    return { type: 'error', message: 'private streamed failure' };
  }

  static turnCompletedEvent(): ThreadEvent {
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

  static serializedEvidenceOutput(): string {
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

  static directExpertRequest(runId: string): ModuleExpertInvocationRequest {
    return new AgentWorkflowCodexRuntimeScenario(runId).execute();
  }

  private execute(): ModuleExpertInvocationRequest {
    const runId = this.request;
    return {
      runId,
      expert: 'core_expert',
      selectedContextPaths: [],
      sourceCommit: SOURCE_COMMIT,
      originMainSha: SOURCE_COMMIT,
      pinnedLocalDevSha: SOURCE_COMMIT,
      featureHeadSha: SOURCE_COMMIT,
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

  static processingRunDirectory(runId: string): string {
    return join(
      REPO_ROOT,
      'workflow',
      'processing',
      DelegatedAgentWorkflowName.AgentWork,
      runId,
    );
  }

  static parseAgentAttemptEvents(
    serialized: string,
  ): readonly AgentAttemptEvent[] {
    return serialized
      .trim()
      .split('\n')
      .map((line) => AgentAttemptTransport.decodeEvent(line));
  }
}

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

const REMOVE_RECURSIVELY: RmOptions = { recursive: true, force: true };

describe('Team Agent Codex settings', () => {
  test('maps the profile service tier through the SDK config boundary', () => {
    const codexOptions: CodexOptions = {
      config: { existing_override: true },
    };
    const agentProfile = TeamAgentRuntimeProfile.resolve({
      agent: TeamGizmoKey.Ai,
      instructionPrefix: 'Inspect only.',
    });
    const configured = AgentCodexOptions.forProfile({
      codexOptions,
      agentProfile,
    });

    expect(configured.config?.service_tier).toBe('fast');
    expect(codexOptions.config?.service_tier).toBeUndefined();
  });

  test('resolves canonical Team Gizmo and leaf runtime profiles', () => {
    const profiles = [
      TeamAgentRuntimeProfile.resolve({
        agent: TeamKey.Ai,
        instructionPrefix: 'Coordinate only.',
      }),
      TeamAgentRuntimeProfile.resolve({
        agent: TeamInternalAgentKey.LoomSpecialist,
        instructionPrefix: 'Inspect only.',
      }),
    ];

    expect(profiles).toMatchObject([
      {
        name: TeamGizmoKey.Ai,
        model: 'gpt-5.6-sol',
        reasoningEffort: AgentReasoningEffort.Low,
        serviceTier: AgentServiceTier.Fast,
        workspacePolicy: AgentWorkspacePolicy.ReadOnly,
      },
      {
        name: TeamInternalAgentKey.LoomSpecialist,
        model: 'gpt-5.6-luna',
        reasoningEffort: AgentReasoningEffort.XHigh,
        serviceTier: AgentServiceTier.Fast,
        workspacePolicy: AgentWorkspacePolicy.ReadOnly,
      },
    ]);
  });

  test('resolves catalog profiles at the runtime invocation boundary', () => {
    const codexOptions: CodexOptions = {
      config: { existing_override: true },
    };
    const configured = AgentCodexOptions.forInvocation({
      codexOptions,
      agentProfile: {
        name: TeamInternalAgentKey.LoomSpecialist,
        instructionPrefix: 'Inspect only.',
        workspacePolicy: AgentWorkspacePolicy.ReadOnly,
        reasoningEffort: AgentReasoningEffort.XHigh,
      },
    });

    expect(configured.agentProfile).toMatchObject({
      name: TeamInternalAgentKey.LoomSpecialist,
      model: 'gpt-5.6-luna',
      reasoningEffort: AgentReasoningEffort.XHigh,
      serviceTier: AgentServiceTier.Fast,
    });
    expect(configured.codexOptions.config?.service_tier).toBe('fast');
    expect(codexOptions.config?.service_tier).toBeUndefined();
  });

  test('rejects drifted canonical runtime profiles', () => {
    expect(() =>
      AgentCodexOptions.forInvocation({
        codexOptions: {},
        agentProfile: {
          name: TeamGizmoKey.Ai,
          instructionPrefix: 'Coordinate only.',
          workspacePolicy: AgentWorkspacePolicy.ReadOnly,
          reasoningEffort: AgentReasoningEffort.High,
          model: 'gpt-5.6-sol',
          serviceTier: AgentServiceTier.Fast,
        },
      }),
    ).toThrow('Team Agent runtime profile drifted');
  });

  test('maps every catalog Team Gizmo service tier through the SDK config boundary', () => {
    for (const teamGizmo of TEAM_GIZMO_CATALOG) {
      const configured = AgentCodexOptions.forProfile({
        codexOptions: { config: { existing_override: true } },
        agentProfile: TeamAgentRuntimeProfile.resolve({
          agent: teamGizmo.key,
          instructionPrefix: 'Coordinate only.',
        }),
      });

      expect(configured.config?.service_tier).toBe('fast');
      expect(configured.config?.existing_override).toBe(true);
    }
  });

  test('requires canonical model and Fast tier for direct runtime options', () => {
    expect(() =>
      AgentCodexOptions.forProfile({
        codexOptions: {},
        agentProfile: {
          name: TeamGizmoKey.Ai,
          instructionPrefix: 'Coordinate only.',
          workspacePolicy: AgentWorkspacePolicy.ReadOnly,
          reasoningEffort: AgentReasoningEffort.Low,
          model: '',
          serviceTier: AgentServiceTier.Fast,
        },
      }),
    ).toThrow('Team Agent runtime profile drifted');
  });

  test('leaves module expert options unchanged at the expert boundary', () => {
    const codexOptions: CodexOptions = {
      config: { existing_override: true },
    };
    const configured = AgentCodexOptions.forExpertProfile({ codexOptions });

    expect(configured).toEqual(codexOptions);
  });
});

describe('Codex agent source stability', () => {
  test('fails closed for commit or worktree drift', async () => {
    const workingDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'loom-agent-source-stability-')),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const initCommand: RepositoryCommandRequest = {
        command: RepositoryCommandExecutable.Git,
        args: ['init'],
        rootDirectory: workingDirectory,
        workingDirectory,
      };
      AgentWorkflowCodexRuntimeScenario.runGit(initCommand);
      const identityCommand: RepositoryCommandRequest = {
        command: RepositoryCommandExecutable.Git,
        args: [
          '-c',
          'user.name=Loom Test',
          '-c',
          'user.email=loom@example.test',
        ],
        rootDirectory: workingDirectory,
        workingDirectory,
      };
      const trackedPath = join(workingDirectory, 'tracked.txt');
      await writeFile(trackedPath, 'stable\n');
      const addCommand: RepositoryCommandRequest = {
        command: RepositoryCommandExecutable.Git,
        args: ['add', 'tracked.txt'],
        rootDirectory: workingDirectory,
        workingDirectory,
      };
      AgentWorkflowCodexRuntimeScenario.runGit(addCommand);
      const commitCommand: RepositoryCommandRequest = {
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
      AgentWorkflowCodexRuntimeScenario.runGit(commitCommand);
      const headCommand: RepositoryCommandRequest = {
        command: RepositoryCommandExecutable.Git,
        args: ['rev-parse', 'HEAD'],
        rootDirectory: workingDirectory,
        workingDirectory,
      };
      const sourceCommit =
        AgentWorkflowCodexRuntimeScenario.runGit(headCommand);
      AgentWorkflowCodexRuntimeScenario.runGit({
        command: RepositoryCommandExecutable.Git,
        args: ['update-ref', 'refs/remotes/origin/main', sourceCommit],
        rootDirectory: workingDirectory,
        workingDirectory,
      });
      const stableCheck: AgentSourceStabilityCheck = {
        workingDirectory,
        sourceCommit,
        originMainSha: sourceCommit,
        pinnedLocalDevSha: sourceCommit,
        featureHeadSha: sourceCommit,
        phase: AgentSourceStabilityPhase.BeforeAttempt,
      };
      const runtimeFailure1 = new AgentSourceSnapshot(
        stableCheck,
      ).assertStable();
      assert(runtimeFailure1.isOk());

      const wrongCommitCheck: AgentSourceStabilityCheck = {
        ...stableCheck,
        sourceCommit: '0000000000000000000000000000000000000000',
      };
      const runtimeFailure2 = new AgentSourceSnapshot(
        wrongCommitCheck,
      ).assertStable();
      assert(runtimeFailure2.isErr());
      expect(runtimeFailure2.error.message).toContain(
        'is not at immutable commit',
      );

      const untrackedPath = join(workingDirectory, 'untracked.txt');
      await writeFile(untrackedPath, 'drifted\n');
      const runtimeFailure3 = new AgentSourceSnapshot(
        stableCheck,
      ).assertStable();
      assert(runtimeFailure3.isErr());
      expect(runtimeFailure3.error.message).toContain(
        'worktree is not clean before attempt',
      );
      await unlink(untrackedPath);

      await writeFile(trackedPath, 'drifted\n');
      const dirtyCheck: AgentSourceStabilityCheck = {
        ...stableCheck,
        phase: AgentSourceStabilityPhase.AfterAttempt,
      };
      const runtimeFailure4 = new AgentSourceSnapshot(
        dirtyCheck,
      ).assertStable();
      assert(runtimeFailure4.isErr());
      expect(runtimeFailure4.error.message).toContain(
        'worktree is not clean after attempt',
      );
    } finally {
      await rm(workingDirectory, removeOptions);
    }
  });

  test('ignores executable fsmonitor and ambient Git config', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-agent-git-isolation-'),
    );
    const workingDirectory = join(fixtureRoot, 'repository');
    const marker = join(fixtureRoot, 'fsmonitor-ran');
    const monitor = join(fixtureRoot, 'fsmonitor.sh');
    const globalConfig = join(fixtureRoot, 'global.gitconfig');
    const systemConfig = join(fixtureRoot, 'system.gitconfig');
    const configNames = [
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_SYSTEM',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0',
    ] as const;
    const previousEnvironment = new Map(
      configNames.map((name) => [name, process.env[name]]),
    );
    await mkdir(workingDirectory);
    try {
      const command = (args: readonly string[]): string =>
        AgentWorkflowCodexRuntimeScenario.runGit({
          command: RepositoryCommandExecutable.Git,
          args,
          rootDirectory: workingDirectory,
          workingDirectory,
        });
      command(['init']);
      await writeFile(join(workingDirectory, 'tracked.txt'), 'stable\n');
      command(['add', 'tracked.txt']);
      command([
        '-c',
        'user.name=Loom Test',
        '-c',
        'user.email=loom@example.test',
        'commit',
        '-m',
        'fixture',
      ]);
      const sourceCommit = command(['rev-parse', 'HEAD']);
      command(['update-ref', 'refs/remotes/origin/main', sourceCommit]);
      await writeFile(
        monitor,
        `#!/bin/sh\nprintf touched > '${marker}'\nexit 1\n`,
        { mode: 0o700 },
      );
      command(['config', '--local', 'core.fsmonitor', monitor]);
      await writeFile(globalConfig, `[core]\nfsmonitor = ${monitor}\n`);
      await writeFile(systemConfig, `[core]\nfsmonitor = ${monitor}\n`);
      await rm(marker, { force: true });
      process.env.GIT_CONFIG_GLOBAL = globalConfig;
      process.env.GIT_CONFIG_SYSTEM = systemConfig;
      process.env.GIT_CONFIG_COUNT = '1';
      process.env.GIT_CONFIG_KEY_0 = 'core.fsmonitor';
      process.env.GIT_CONFIG_VALUE_0 = monitor;
      try {
        const result = new AgentSourceSnapshot({
          workingDirectory,
          sourceCommit,
          originMainSha: sourceCommit,
          pinnedLocalDevSha: sourceCommit,
          featureHeadSha: sourceCommit,
          phase: AgentSourceStabilityPhase.BeforeAttempt,
        }).assertStable();
        assert(result.isOk());
      } finally {
        for (const name of configNames) {
          const value = previousEnvironment.get(name);
          if (typeof value !== 'string') delete process.env[name];
          else process.env[name] = value;
        }
      }
      expect(existsSync(marker)).toBe(false);
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });
});

describe('Codex streamed turn terminal state', () => {
  test('requires an explicit successful turn terminal', async () => {
    const completedEvents = [
      AgentWorkflowCodexRuntimeScenario.threadStartedEvent(),
      AgentWorkflowCodexRuntimeScenario.agentMessageEvent(),
      AgentWorkflowCodexRuntimeScenario.turnCompletedEvent(),
    ];
    const completedStreamArgs: FakeThreadEventStreamArgs = {
      events: completedEvents,
    };
    const completedArgs: CollectCodexTurnArgs = {
      events:
        AgentWorkflowCodexRuntimeScenario.fakeThreadEventStream(
          completedStreamArgs,
        ),
      expectedResultKind: WorkflowResultKind.CortexEvidence,
      observe: async () => {},
    };

    const completionResult = await new CodexTurn(completedArgs).collect();
    assert(completionResult.isOk());
    const completion = completionResult.value;
    expect(completion.threadId).toBe('streamed-thread');
    expect(completion.output.resultKind).toBe(
      WorkflowResultKind.CortexEvidence,
    );

    const unterminatedEvents = [
      AgentWorkflowCodexRuntimeScenario.threadStartedEvent(),
      AgentWorkflowCodexRuntimeScenario.agentMessageEvent(),
    ];
    const unterminatedStreamArgs: FakeThreadEventStreamArgs = {
      events: unterminatedEvents,
    };
    const unterminatedArgs: CollectCodexTurnArgs = {
      events: AgentWorkflowCodexRuntimeScenario.fakeThreadEventStream(
        unterminatedStreamArgs,
      ),
      expectedResultKind: WorkflowResultKind.CortexEvidence,
      observe: async () => {},
    };
    const runtimeFailure5 = await new CodexTurn(unterminatedArgs).collect();
    assert(runtimeFailure5.isErr());
    expect(runtimeFailure5.error.message).toContain(
      'without a thread identity or structured result',
    );
  });

  test('returns a typed failure for malformed completed output', async () => {
    const malformedMessage: ThreadEvent = {
      type: 'item.completed',
      item: {
        id: 'malformed-structured-message',
        type: 'agent_message',
        text: 'not-json',
      },
    };
    const streamArgs: FakeThreadEventStreamArgs = {
      events: [
        AgentWorkflowCodexRuntimeScenario.threadStartedEvent(),
        malformedMessage,
        AgentWorkflowCodexRuntimeScenario.turnCompletedEvent(),
      ],
    };
    const result = await new CodexTurn({
      events:
        AgentWorkflowCodexRuntimeScenario.fakeThreadEventStream(streamArgs),
      expectedResultKind: WorkflowResultKind.CortexEvidence,
      observe: async () => {},
    }).collect();

    assert(result.isErr());
    expect(result.error.message).toBe(
      'Codex structured result could not be decoded.',
    );
  });

  test('keeps turn failure authoritative across event ordering', async () => {
    const sequences: readonly (readonly ThreadEvent[])[] = [
      [
        AgentWorkflowCodexRuntimeScenario.threadStartedEvent(),
        AgentWorkflowCodexRuntimeScenario.agentMessageEvent(),
        AgentWorkflowCodexRuntimeScenario.turnFailedEvent(),
      ],
      [
        AgentWorkflowCodexRuntimeScenario.threadStartedEvent(),
        AgentWorkflowCodexRuntimeScenario.fatalErrorEvent(),
        AgentWorkflowCodexRuntimeScenario.agentMessageEvent(),
        AgentWorkflowCodexRuntimeScenario.turnCompletedEvent(),
      ],
      [
        AgentWorkflowCodexRuntimeScenario.threadStartedEvent(),
        AgentWorkflowCodexRuntimeScenario.turnFailedEvent(),
        AgentWorkflowCodexRuntimeScenario.agentMessageEvent(),
        AgentWorkflowCodexRuntimeScenario.turnCompletedEvent(),
      ],
    ];

    for (const events of sequences) {
      const observations: RuntimeActivityObservation[] = [];
      const streamArgs: FakeThreadEventStreamArgs = { events };
      const collectArgs: CollectCodexTurnArgs = {
        events:
          AgentWorkflowCodexRuntimeScenario.fakeThreadEventStream(streamArgs),
        expectedResultKind: WorkflowResultKind.CortexEvidence,
        observe: async (observation) => {
          observations.push(observation);
        },
      };

      const runtimeFailure6 = await new CodexTurn(collectArgs).collect();
      assert(runtimeFailure6.isErr());
      expect(runtimeFailure6.error.message).toContain('Codex turn failed');
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
      AgentWorkflowCodexRuntimeScenario.threadStartedEvent(),
      AgentWorkflowCodexRuntimeScenario.completedSourceReadEvent(),
      AgentWorkflowCodexRuntimeScenario.failedSourceReadEvent(),
      AgentWorkflowCodexRuntimeScenario.agentMessageEvent(),
      AgentWorkflowCodexRuntimeScenario.turnCompletedEvent(),
    ];
    const observations: RuntimeActivityObservation[] = [];
    const streamArgs: FakeThreadEventStreamArgs = { events };
    const collectArgs: CollectCodexTurnArgs = {
      events:
        AgentWorkflowCodexRuntimeScenario.fakeThreadEventStream(streamArgs),
      expectedResultKind: WorkflowResultKind.CortexEvidence,
      observe: async (observation) => {
        observations.push(observation);
      },
    };

    assert((await new CodexTurn(collectArgs).collect()).isOk());

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
    const request = AgentWorkflowCodexRuntimeScenario.directExpertRequest(
      `module-expert-stream-failure-${randomUUID()}`,
    );
    const runDirectory =
      AgentWorkflowCodexRuntimeScenario.processingRunDirectory(request.runId);
    const controller = new AbortController();
    const runtimeMockArgs: RegisterModuleExpertRuntimeMockArgs = {
      runId: request.runId,
      runtime,
    };
    const runtimeMock =
      ModuleExpertsModuleExpertRuntimeMockScenario.registerModuleExpertRuntimeMock(
        runtimeMockArgs,
      );
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      signal: controller.signal,
    };
    try {
      await ModuleExpertsInvokeParentFixtureScenario.createAuthorizedDirectParent(
        request,
      );
      const result =
        await ModuleExpertInvocation.invokeModuleExpert(invokeArgs);

      expect(result.terminal.kind).toBe(TaskTerminalKind.Failed);
      expect(result.terminal.kind).not.toBe(TaskTerminalKind.Completed);
      const eventsPath = join(
        result.runDirectory,
        result.processing.events.path,
      );
      const eventsSerialized = await readFile(eventsPath, 'utf8');
      const events =
        AgentWorkflowCodexRuntimeScenario.parseAgentAttemptEvents(
          eventsSerialized,
        );
      const replayRequest = { events };
      expect(AgentAttemptReplay.replay(replayRequest).terminalKind).toBe(
        TaskTerminalKind.Failed,
      );
      expect(eventsSerialized).not.toContain('private streamed failure');
      expect(eventsSerialized).not.toContain('runtime-activity');
    } finally {
      runtimeMock.dispose();
      await rm(runDirectory, REMOVE_RECURSIVELY);
    }
  });
});

type FakeThreadEventStreamArgs = {
  readonly events: readonly ThreadEvent[];
};

class FailingStreamAgentRuntime implements AgentTaskRuntime<string, string> {
  async executeAgent(
    invocation: AgentExecutionInvocation<string, string>,
  ): Promise<Result<AgentExecutionCompletion, AgentExecutionFailure>> {
    const events = [
      AgentWorkflowCodexRuntimeScenario.threadStartedEvent(),
      AgentWorkflowCodexRuntimeScenario.agentMessageEvent(),
      AgentWorkflowCodexRuntimeScenario.turnFailedEvent(),
    ];
    const streamArgs: FakeThreadEventStreamArgs = { events };
    const collectArgs: CollectCodexTurnArgs = {
      events:
        AgentWorkflowCodexRuntimeScenario.fakeThreadEventStream(streamArgs),
      expectedResultKind: invocation.execution.resultKind,
      observe: invocation.observe,
    };
    return new CodexTurn(collectArgs).collect();
  }
}
