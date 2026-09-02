import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'bun:test';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import {
  DELEGATION_PLAN_SCHEMA_VERSION,
  DelegationBarrierPolicy,
} from '../../src/agent-workflow/delegation-domain.ts';
import type { DelegationPlan } from '../../src/agent-workflow/delegation-domain.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../../src/agent-workflow/agent-attempt-version.ts';
import { readVerifiedBarrierAttempt } from '../../src/agent-workflow/attempt-verification.ts';
import type { ReadParentAttemptArgs } from '../../src/agent-workflow/attempt-verification.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

describe('delegated agent journal CLI', () => {
  test('records an ordinary delegated attempt with its semantic view', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-delegation-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const cortexDirectory = join(workingDirectory, '.cortex');
      await mkdir(cortexDirectory);
      await writeFile(
        join(cortexDirectory, 'knowledge-graph.md'),
        '# Knowledge graph\n',
        'utf8',
      );
      const registry = {
        schemaVersion: 1,
        entries: [
          {
            id: 'CX-AI',
            kind: 'category',
            authority: 'ai',
            title: 'AI',
            locator: '.cortex/knowledge-graph.md',
          },
        ],
      };
      await writeFile(
        join(cortexDirectory, 'identifiers.json'),
        JSON.stringify(registry),
        'utf8',
      );
      const sourceCommit = commitFixture(workingDirectory);
      const requestPath = join(workingDirectory, 'request.json');
      const request = {
        runId: 'ordinary-coding-run',
        sourceCommit,
        task: 'inspect-contract',
        agent: 'contract-auditor',
        attempt: 1,
        depth: 1,
        parent: { kind: AgentAttemptParentKind.WorkflowRoot },
        terminal: {
          kind: TaskTerminalKind.Completed,
          task: 'inspect-contract',
          attempt: 1,
          threadId: 'delegated-thread',
          output: {
            resultKind: WorkflowResultKind.CortexEvidence,
            summary: 'Contract is consistent.',
            materializedViewMarkdown: '# Contract view\n\nConsistent.',
            findings: [],
            notesForParent: [],
            artifacts: [],
          },
        },
      };
      const planPath = join(workingDirectory, 'plan.json');
      const plan = {
        schemaVersion: DELEGATION_PLAN_SCHEMA_VERSION,
        workflow: DelegatedAgentWorkflowName.AgentWork,
        runId: request.runId,
        sourceCommit: request.sourceCommit,
        rootMaterializer: {
          task: request.task,
          agent: request.agent,
          attempt: request.attempt,
        },
        attempts: [
          {
            identity: {
              task: request.task,
              agent: request.agent,
              attempt: request.attempt,
            },
            depth: request.depth,
            parent: request.parent,
            terminalBarrier: {
              policy: DelegationBarrierPolicy.AllTerminal,
              attempts: [],
            },
          },
        ],
      };
      await writeFile(planPath, JSON.stringify(plan), 'utf8');
      const delegationCli = join(
        import.meta.dir,
        '../../src/agent-workflow/delegation-cli.ts',
      );
      const startCommand = [
        process.execPath,
        delegationCli,
        'start',
        '--plan',
        planPath,
        '--working-directory',
        workingDirectory,
      ];
      const spawnOptions = {
        stdout: 'pipe',
        stderr: 'pipe',
      } as const;
      const startProcess = Bun.spawn(startCommand, spawnOptions);
      expect(await startProcess.exited).toBe(0);
      const startStdout = await new Response(startProcess.stdout).text();
      const startStderr = await new Response(startProcess.stderr).text();
      expect(() => JSON.parse(startStdout)).not.toThrow();
      expect(startStdout).not.toContain('gizmo');
      expect(startStderr).toBe(
        ['gizmo', '└─ contract-auditor', '  └─ inspect contract', ''].join(
          '\n',
        ),
      );
      const admissionPath = join(workingDirectory, 'admission.json');
      const admissionRequest = {
        runId: request.runId,
        sourceCommit: request.sourceCommit,
        identity: {
          task: request.task,
          agent: request.agent,
          attempt: request.attempt,
        },
        depth: request.depth,
        parent: request.parent,
      };
      await writeFile(admissionPath, JSON.stringify(admissionRequest), 'utf8');
      const admissionCommand = [
        process.execPath,
        delegationCli,
        'admit',
        '--request',
        admissionPath,
        '--working-directory',
        workingDirectory,
      ];
      const admissionProcess = Bun.spawn(admissionCommand, spawnOptions);
      expect(await admissionProcess.exited).toBe(0);
      await new Response(admissionProcess.stdout).text();
      const command = [
        process.execPath,
        delegationCli,
        'record',
        '--request',
        requestPath,
        '--working-directory',
        workingDirectory,
      ];

      const legacyActivityRequest = {
        ...request,
        activities: [
          {
            activity: 'turn-completed',
            detail: 'Persisted progress is no longer accepted.',
          },
        ],
      };
      await writeFile(
        requestPath,
        JSON.stringify(legacyActivityRequest),
        'utf8',
      );
      const legacyActivityProcess = Bun.spawn(command, spawnOptions);
      expect(await legacyActivityProcess.exited).not.toBe(0);
      await new Response(legacyActivityProcess.stderr).text();
      const attemptDirectory = join(
        workingDirectory,
        'workflow',
        'processing',
        DelegatedAgentWorkflowName.AgentWork,
        request.runId,
        'agents',
        request.task,
        'attempt-1',
      );
      await expect(stat(attemptDirectory)).rejects.toThrow();

      const extraTerminalFieldRequest = {
        ...request,
        terminal: {
          ...request.terminal,
          prompt: 'must not persist',
        },
      };
      await writeFile(
        requestPath,
        JSON.stringify(extraTerminalFieldRequest),
        'utf8',
      );
      const extraTerminalProcess = Bun.spawn(command, spawnOptions);
      expect(await extraTerminalProcess.exited).not.toBe(0);
      await new Response(extraTerminalProcess.stderr).text();
      await expect(stat(attemptDirectory)).rejects.toThrow();

      const mismatchedSourceRequest = {
        ...request,
        sourceCommit: SOURCE_COMMIT,
      };
      await writeFile(
        requestPath,
        JSON.stringify(mismatchedSourceRequest),
        'utf8',
      );
      const mismatchedSourceProcess = Bun.spawn(command, spawnOptions);
      expect(await mismatchedSourceProcess.exited).not.toBe(0);
      await new Response(mismatchedSourceProcess.stderr).text();
      await expect(stat(attemptDirectory)).rejects.toThrow();

      await writeFile(requestPath, JSON.stringify(request), 'utf8');
      const processResult = Bun.spawn(command, spawnOptions);
      const exitCode = await processResult.exited;
      const stdout = await new Response(processResult.stdout).text();
      const stderr = await new Response(processResult.stderr).text();
      expect(exitCode).toBe(0);
      expect(stdout).toContain('events.jsonl');
      expect(stderr).not.toContain('runtime-activity');
      expect(await readFile(join(attemptDirectory, 'view.md'), 'utf8')).toBe(
        '# Contract view\n\nConsistent.\n',
      );
      expect(
        (await readFile(join(attemptDirectory, 'events.jsonl'), 'utf8'))
          .trim()
          .split('\n'),
      ).toHaveLength(4);
      const eventLines = (
        await readFile(join(attemptDirectory, 'events.jsonl'), 'utf8')
      )
        .trim()
        .split('\n');
      expect(eventLines.join('\n')).not.toContain('runtime-activity');
      expect(eventLines.join('\n')).not.toContain('"detail"');
      expect(
        eventLines.every(
          (line) =>
            line.includes(
              `"adapter":"${AgentAttemptAdapterKind.GenericDelegationRecorder}"`,
            ) &&
            line.includes(
              `"workflowVersion":"${CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION}"`,
            ),
        ),
      ).toBe(true);
      for (const [index, line] of eventLines.entries()) {
        const expectedActionId = `"actionId":"a${(index + 1).toString().padStart(4, '0')}"`;
        expect(line).toContain(expectedActionId);
      }
      const finalizationPath = join(workingDirectory, 'finalization.json');
      const finalizationRequest = {
        runId: request.runId,
        sourceCommit: request.sourceCommit,
        barrierEvidence: [
          {
            parent: plan.rootMaterializer,
            children: [],
          },
        ],
      };
      await writeFile(
        finalizationPath,
        JSON.stringify(finalizationRequest),
        'utf8',
      );
      const finalizeCommand = [
        process.execPath,
        delegationCli,
        'finalize',
        '--request',
        finalizationPath,
        '--working-directory',
        workingDirectory,
      ];
      const finalizeProcess = Bun.spawn(finalizeCommand, spawnOptions);
      expect(await finalizeProcess.exited).toBe(0);
      await new Response(finalizeProcess.stdout).text();
      const runDirectory = join(
        workingDirectory,
        'workflow',
        'processing',
        DelegatedAgentWorkflowName.AgentWork,
        request.runId,
      );
      expect(await readFile(join(runDirectory, 'view.md'), 'utf8')).toBe(
        '# Contract view\n\nConsistent.\n',
      );
      const verificationRequest: ReadParentAttemptArgs = {
        runDirectory,
        runId: request.runId,
        workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
        sourceCommit: request.sourceCommit,
        identity: {
          task: request.task,
          agent: request.agent,
          attempt: request.attempt,
          depth: request.depth,
        },
      };
      await writeFile(
        join(attemptDirectory, 'view.md'),
        '# Tampered\n',
        'utf8',
      );
      await expect(
        readVerifiedBarrierAttempt(verificationRequest),
      ).rejects.toThrow('parent authorization failed');

      const unsafeRequest = {
        ...request,
        runId: '../../../../escaped-delegation-run',
      };
      await writeFile(requestPath, JSON.stringify(unsafeRequest), 'utf8');
      const unsafeProcess = Bun.spawn(command, spawnOptions);
      expect(await unsafeProcess.exited).not.toBe(0);
      await new Response(unsafeProcess.stderr).text();

      const malformedOutputRequest = {
        ...request,
        runId: 'malformed-output-run',
        terminal: {
          ...request.terminal,
          output: {
            materializedViewMarkdown: '# Incomplete output',
          },
        },
      };
      await writeFile(
        requestPath,
        JSON.stringify(malformedOutputRequest),
        'utf8',
      );
      const malformedProcess = Bun.spawn(command, spawnOptions);
      expect(await malformedProcess.exited).not.toBe(0);
      await new Response(malformedProcess.stderr).text();
      const malformedRunDirectory = join(
        workingDirectory,
        'workflow',
        'processing',
        DelegatedAgentWorkflowName.AgentWork,
        malformedOutputRequest.runId,
      );
      await expect(stat(malformedRunDirectory)).rejects.toThrow();

      const depthFourRequest = {
        ...request,
        runId: 'depth-four-run',
        depth: 4,
      };
      await writeFile(requestPath, JSON.stringify(depthFourRequest), 'utf8');
      const depthFourProcess = Bun.spawn(command, spawnOptions);
      expect(await depthFourProcess.exited).not.toBe(0);
      await new Response(depthFourProcess.stderr).text();
      const depthFourRunDirectory = join(
        workingDirectory,
        'workflow',
        'processing',
        DelegatedAgentWorkflowName.AgentWork,
        depthFourRequest.runId,
      );
      await expect(stat(depthFourRunDirectory)).rejects.toThrow();

      const forgedModuleExpertRequest = {
        ...request,
        adapter: AgentAttemptAdapterKind.ModuleExpertInvocation,
        runId: 'forged-module-expert-run',
        terminal: {
          ...request.terminal,
          output: {
            ...request.terminal.output,
            resultKind: WorkflowResultKind.ModuleExpertEvidence,
            continuation: {
              externalApi: ['Public facade.'],
              dependencies: ['Direct provider.'],
              consumers: ['Immediate consumer.'],
              behaviorInvariants: ['Preserve behavior.'],
              securityInvariants: ['Preserve security.'],
              compatibilityInvariants: ['Preserve compatibility.'],
              owningTests: ['Provider tests.'],
              focusedValidation: ['Focused validation.'],
              risks: ['No additional risk.'],
              unresolvedDecisions: ['No unresolved decision.'],
              parentActions: ['Review evidence without scheduling from it.'],
            },
          },
        },
      };
      await writeFile(
        requestPath,
        JSON.stringify(forgedModuleExpertRequest),
        'utf8',
      );
      const forgedProcess = Bun.spawn(command, spawnOptions);
      expect(await forgedProcess.exited).not.toBe(0);
      await new Response(forgedProcess.stderr).text();
      const forgedRunDirectory = join(
        workingDirectory,
        'workflow',
        'processing',
        DelegatedAgentWorkflowName.AgentWork,
        forgedModuleExpertRequest.runId,
      );
      await expect(stat(forgedRunDirectory)).rejects.toThrow();
    } finally {
      await rm(workingDirectory, removeOptions);
    }
  });

  test('records every non-completed terminal as verified barrier evidence', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-delegation-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    const terminalKinds: readonly TaskTerminalKind[] = [
      TaskTerminalKind.Failed,
      TaskTerminalKind.Blocked,
      TaskTerminalKind.Cancelled,
      TaskTerminalKind.TimedOut,
      TaskTerminalKind.Skipped,
    ];
    const delegationCli = join(
      import.meta.dir,
      '../../src/agent-workflow/delegation-cli.ts',
    );
    const spawnOptions = {
      stdout: 'pipe',
      stderr: 'pipe',
    } as const;
    try {
      for (const kind of terminalKinds) {
        const runId = `terminal-${kind}`;
        const task = `task-${kind}`;
        const agent = `agent-${kind}`;
        const identity = { task, agent, attempt: 1 };
        const parent = { kind: AgentAttemptParentKind.WorkflowRoot } as const;
        const plan: DelegationPlan = {
          schemaVersion: DELEGATION_PLAN_SCHEMA_VERSION,
          workflow: DelegatedAgentWorkflowName.AgentWork,
          runId,
          sourceCommit: SOURCE_COMMIT,
          rootMaterializer: identity,
          attempts: [
            {
              identity,
              depth: 1,
              parent,
              terminalBarrier: {
                policy: DelegationBarrierPolicy.AllTerminal,
                attempts: [],
              },
            },
          ],
        };
        const planPath = join(workingDirectory, `${runId}-plan.json`);
        await writeFile(planPath, JSON.stringify(plan), 'utf8');
        const startCommand = [
          process.execPath,
          delegationCli,
          'start',
          '--plan',
          planPath,
          '--working-directory',
          workingDirectory,
        ];
        const startProcess = Bun.spawn(startCommand, spawnOptions);
        expect(await startProcess.exited).toBe(0);
        await new Response(startProcess.stdout).text();

        const requestPath = join(workingDirectory, `${runId}-request.json`);
        const request = {
          runId,
          sourceCommit: SOURCE_COMMIT,
          ...identity,
          depth: 1,
          parent,
          terminal: {
            kind,
            task,
            attempt: 1,
            summary: `${kind} evidence.`,
          },
        };
        await writeFile(requestPath, JSON.stringify(request), 'utf8');
        const recordCommand = [
          process.execPath,
          delegationCli,
          'record',
          '--request',
          requestPath,
          '--working-directory',
          workingDirectory,
        ];
        const recordProcess = Bun.spawn(recordCommand, spawnOptions);
        expect(await recordProcess.exited).toBe(0);
        await new Response(recordProcess.stdout).text();
        const viewPath = join(
          workingDirectory,
          'workflow',
          'processing',
          DelegatedAgentWorkflowName.AgentWork,
          runId,
          'agents',
          task,
          'attempt-1',
          'view.md',
        );
        expect(await readFile(viewPath, 'utf8')).toContain(`Status: ${kind}`);
      }
    } finally {
      await rm(workingDirectory, removeOptions);
    }
  });
});

function commitFixture(workingDirectory: string): string {
  const options = { cwd: workingDirectory, encoding: 'utf8' } as const;
  execFileSync('git', ['init', '--quiet'], options);
  execFileSync('git', ['config', 'user.name', 'Loom Test'], options);
  execFileSync(
    'git',
    ['config', 'user.email', 'loom@example.invalid'],
    options,
  );
  execFileSync('git', ['add', '.cortex'], options);
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], options);
  return execFileSync('git', ['rev-parse', 'HEAD'], options).trim();
}
