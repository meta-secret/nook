import { test, expect } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentAttemptJournal,
  type AgentAttemptJournalConfiguration,
} from '../../src/agent-workflow/agent-journal.ts';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
  type FailedTaskTerminal,
} from '../../src/agent-workflow/domain.ts';
import { AgentAttemptEventKind } from '../../src/agent-workflow/agent-events.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../../src/agent-workflow/agent-attempt-version.ts';

class JournalLifetimeFixture {
  static configuration(runDirectory: string): AgentAttemptJournalConfiguration {
    return {
      adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
      runDirectory,
      runId: 'lifetime',
      workflow: DelegatedAgentWorkflowName.AgentWork,
      workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      task: 'inspect',
      agent: 'auditor',
      attempt: 1,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
      now: () => '2026-09-09T00:00:00.000Z',
      compactOutput: () => {},
    };
  }
}

test('initialization consumes prepared journal and finalization drains admitted writes', async () => {
  const runDirectory = await mkdtemp(join(tmpdir(), 'loom-journal-lifetime-'));
  try {
    const prepared = new AgentAttemptJournal<'inspect'>(
      JournalLifetimeFixture.configuration(runDirectory),
    );
    const opening = prepared.initialize();
    await expect(prepared.initialize()).rejects.toThrow('expected prepared');
    const active = await opening;
    const accepted = active.append({
      kind: AgentAttemptEventKind.ResultProjected,
      result: { path: 'accepted.json', sha256: 'a'.repeat(64) },
    });
    const terminal: FailedTaskTerminal<'inspect'> = {
      kind: TaskTerminalKind.Failed,
      task: 'inspect',
      attempt: 1,
      summary: 'Stopped.',
    };
    const finishing = active.finalize(terminal);
    await expect(active.finalize(terminal)).rejects.toThrow('expected active');
    await expect(
      active.append({ kind: AgentAttemptEventKind.AttemptStarted }),
    ).rejects.toThrow('expected active');
    const admitted = await accepted;
    await finishing;
    const serialized = await readFile(active.eventsPath, 'utf8');
    expect(serialized).toContain(JSON.stringify(admitted));
    expect(serialized.indexOf('accepted.json')).toBeLessThan(
      serialized.indexOf('attempt-terminal-recorded'),
    );
    await expect(active.finalize(terminal)).rejects.toThrow('completed');
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
});
