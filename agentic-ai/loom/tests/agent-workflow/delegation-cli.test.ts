import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import { WorkflowRuntimeActivityKind } from '../../src/agent-workflow/events.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

describe('delegated agent journal CLI', () => {
  test('records an ordinary delegated attempt with its semantic view', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-delegation-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const requestPath = join(workingDirectory, 'request.json');
      const request = {
        runId: 'ordinary-coding-run',
        sourceCommit: SOURCE_COMMIT,
        task: 'inspect-contract',
        agent: 'contract-auditor',
        attempt: 1,
        depth: 1,
        parent: { kind: AgentAttemptParentKind.WorkflowRoot },
        activities: [
          {
            activity: WorkflowRuntimeActivityKind.TurnCompleted,
            detail: 'Contract inspection completed.',
          },
        ],
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
      await writeFile(requestPath, JSON.stringify(request), 'utf8');
      const command = [
        process.execPath,
        join(import.meta.dir, '../../src/agent-workflow/delegation-cli.ts'),
        'record',
        '--request',
        requestPath,
        '--working-directory',
        workingDirectory,
      ];
      const spawnOptions = {
        stdout: 'pipe',
        stderr: 'pipe',
      } as const;
      const processResult = Bun.spawn(command, spawnOptions);
      const exitCode = await processResult.exited;
      const stdout = await new Response(processResult.stdout).text();
      expect(exitCode).toBe(0);
      expect(stdout).toContain('events.jsonl');
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
      expect(await readFile(join(attemptDirectory, 'view.md'), 'utf8')).toBe(
        '# Contract view\n\nConsistent.\n',
      );
      expect(
        (await readFile(join(attemptDirectory, 'events.jsonl'), 'utf8'))
          .trim()
          .split('\n'),
      ).toHaveLength(5);
    } finally {
      await rm(workingDirectory, removeOptions);
    }
  });
});
