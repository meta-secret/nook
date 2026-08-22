import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  AgentWorkspacePolicy,
  WorkflowExecutorKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';
import { WorkflowRuntimeActivityKind } from '../../src/agent-workflow/events.ts';
import type { RuntimeActivityObservation } from '../../src/agent-workflow/events.ts';
import { parseModuleExpertCommandLine } from '../../src/module-experts/cli.ts';
import {
  decodeModuleExpertInvocationRequest,
  invokeModuleExpert,
} from '../../src/module-experts/invoke.ts';
import type {
  InvokeModuleExpertArgs,
  ModuleExpertInvocationRequest,
} from '../../src/module-experts/invoke.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

type ExtendedModuleExpertInvocationRequest = ModuleExpertInvocationRequest & {
  readonly allowWrites: boolean;
};

type ModuleExpertCommandArguments = string[];

class RecordingAgentRuntime implements AgentTaskRuntime<string, string> {
  invocation: AgentExecutionInvocation<string, string> | false = false;

  async executeAgent(
    invocation: AgentExecutionInvocation<string, string>,
  ): Promise<AgentExecutionCompletion> {
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

describe('module expert invocation', () => {
  test('decodes a bounded exact request', () => {
    const request: ModuleExpertInvocationRequest = {
      expert: 'core_expert',
      sourceCommit: SOURCE_COMMIT,
      task: 'inspect-core-contract',
      instruction: 'Describe the external vault API used by nook-wasm.',
    };
    const serialized = JSON.stringify(request);

    const expected: ModuleExpertInvocationRequest = {
      expert: 'core_expert',
      sourceCommit: SOURCE_COMMIT,
      task: 'inspect-core-contract',
      instruction: 'Describe the external vault API used by nook-wasm.',
    };
    expect(decodeModuleExpertInvocationRequest(serialized)).toEqual(expected);
  });

  test('rejects malformed, unbounded, and extended requests', () => {
    const invalidSourceRequest: ModuleExpertInvocationRequest = {
      expert: 'core_expert',
      sourceCommit: 'main',
      task: 'inspect-core-contract',
      instruction: 'Inspect the contract.',
    };
    const extraFieldRequest: ExtendedModuleExpertInvocationRequest = {
      expert: 'core_expert',
      sourceCommit: SOURCE_COMMIT,
      task: 'inspect-core-contract',
      instruction: 'Inspect the contract.',
      allowWrites: true,
    };
    const unboundedInstructionRequest: ModuleExpertInvocationRequest = {
      expert: 'core_expert',
      sourceCommit: SOURCE_COMMIT,
      task: 'inspect-core-contract',
      instruction: 'x'.repeat(16_385),
    };
    const invalidSource = JSON.stringify(invalidSourceRequest);
    const extraField = JSON.stringify(extraFieldRequest);
    const unboundedInstruction = JSON.stringify(unboundedInstructionRequest);

    expect(() => decodeModuleExpertInvocationRequest(invalidSource)).toThrow(
      'request is invalid',
    );
    expect(() => decodeModuleExpertInvocationRequest(extraField)).toThrow(
      'request is invalid',
    );
    expect(() =>
      decodeModuleExpertInvocationRequest(unboundedInstruction),
    ).toThrow('request is invalid');
  });

  test('resolves one catalog role and invokes the read-only runtime', async () => {
    const runtime = new RecordingAgentRuntime();
    const request: ModuleExpertInvocationRequest = {
      expert: 'core_expert',
      sourceCommit: SOURCE_COMMIT,
      task: 'inspect-core-contract',
      instruction: 'Describe the external vault API used by nook-wasm.',
    };
    const controller = new AbortController();
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: REPO_ROOT,
      request,
      runtime,
      signal: controller.signal,
    };

    const result = await invokeModuleExpert(invokeArgs);

    expect(result.expert).toBe('core_expert');
    expect(result.agentDefinitionPath).toBe(
      '.codex/agents/module-experts/core_expert.toml',
    );
    expect(result.agentDefinitionSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.threadId).toBe('module-expert-thread');
    const expectedActivities: readonly RuntimeActivityObservation[] = [
      {
        activity: WorkflowRuntimeActivityKind.TurnCompleted,
        detail: 'Codex turn completed.',
      },
    ];
    expect(result.activities).toEqual(expectedActivities);
    expect(runtime.invocation).not.toBe(false);
    if (!runtime.invocation) throw new Error('Expected captured invocation.');
    expect(runtime.invocation.agentProfile.name).toBe('core_expert');
    expect(runtime.invocation.agentProfile.workspacePolicy).toBe(
      AgentWorkspacePolicy.ReadOnly,
    );
    expect(runtime.invocation.execution.kind).toBe(WorkflowExecutorKind.Agent);
    expect(runtime.invocation.execution.resultKind).toBe(
      WorkflowResultKind.CortexEvidence,
    );
    expect(runtime.invocation.execution.instruction).toContain(
      'nook-app/nook-platform/nook-core',
    );
    expect(runtime.invocation.execution.instruction).toContain(
      request.instruction,
    );
  });

  test('rejects an unregistered expert before runtime execution', async () => {
    const runtime = new RecordingAgentRuntime();
    const request: ModuleExpertInvocationRequest = {
      expert: 'shadow_expert',
      sourceCommit: SOURCE_COMMIT,
      task: 'inspect-shadow-contract',
      instruction: 'Inspect the contract.',
    };
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
  });

  test('parses validate and invoke CLI commands without adding scheduler state', () => {
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
    const removeOptions: RmOptions = { recursive: true, force: true };
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
      await rm(fixtureRoot, removeOptions);
    }
  });
});
