import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  AgentAttemptParentKind,
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
  StaticAgentWorkflowName,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import { AgentAttemptEventKind } from '../../src/agent-workflow/agent-events.ts';
import { WorkflowRuntimeActivityKind } from '../../src/agent-workflow/events.ts';
import { AgentAttemptJournal } from '../../src/agent-workflow/agent-journal.ts';
import { replayAgentAttemptJournal } from '../../src/agent-workflow/agent-replay.ts';
import type { RmOptions } from 'node:fs';
import type {
  CompletedTaskTerminal,
  FailedTaskTerminal,
} from '../../src/agent-workflow/domain.ts';
import type { AgentAttemptJournalConfiguration } from '../../src/agent-workflow/agent-journal.ts';
import type { AgentAttemptEventWithoutMetadata } from '../../src/agent-workflow/agent-events.ts';
import type { AgentAttemptEvent } from '../../src/agent-workflow/agent-events.ts';
import type { ReplayAgentAttemptJournalRequest } from '../../src/agent-workflow/agent-replay.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const FIXED_TIME = '2026-08-21T00:00:00.000Z';

describe('agent attempt journal', () => {
  test('persists an immutable action stream and agent-authored view', async () => {
    const runDirectory = await mkdtemp(join(tmpdir(), 'loom-agent-journal-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const journal = new AgentAttemptJournal<'inspect'>(
        configuration(runDirectory),
      );
      await journal.initialize();
      const activityEvent: AgentAttemptEventWithoutMetadata = {
        kind: AgentAttemptEventKind.RuntimeActivity,
        activity: WorkflowRuntimeActivityKind.TurnCompleted,
        detail: 'Codex turn completed.',
      };
      await journal.append(activityEvent);
      const terminal: CompletedTaskTerminal<'inspect'> = {
        kind: TaskTerminalKind.Completed,
        task: 'inspect',
        attempt: 1,
        threadId: 'thread-1',
        output: {
          resultKind: WorkflowResultKind.CortexEvidence,
          summary: 'Inspection complete.',
          materializedViewMarkdown: '# Inspection\n\nEvidence is complete.',
          findings: [],
          notesForParent: [],
          artifacts: [],
        },
      };
      const processing = await journal.finalize(terminal);
      const events = await readFile(journal.eventsPath, 'utf8');
      const parsedEvents = events
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as AgentAttemptEvent);
      const replayRequest: ReplayAgentAttemptJournalRequest = {
        events: parsedEvents,
      };
      const replay = replayAgentAttemptJournal(replayRequest);
      expect(processing.events.sha256).toBe(sha256(events));
      expect(replay.terminalKind).toBe(TaskTerminalKind.Completed);
      const firstEvent = parsedEvents[0]!;
      const unknownKindEvent = {
        ...firstEvent,
        kind: 'future-agent-event',
        sequence: 2,
      } as never as AgentAttemptEvent;
      const shiftedEvents = parsedEvents
        .slice(1)
        .map((event) => ({ ...event, sequence: event.sequence + 1 }));
      const unknownKindEvents = [
        firstEvent,
        unknownKindEvent,
        ...shiftedEvents,
      ];
      const unknownKindRequest: ReplayAgentAttemptJournalRequest = {
        events: unknownKindEvents,
      };
      expect(() => replayAgentAttemptJournal(unknownKindRequest)).toThrow(
        'unknown event kind',
      );
      const mismatchedEvents = parsedEvents.map((event) =>
        event.kind === AgentAttemptEventKind.AttemptTerminalRecorded
          ? {
              ...event,
              result: { ...event.result, sha256: 'mismatched-result' },
            }
          : event,
      );
      const mismatchedReplayRequest: ReplayAgentAttemptJournalRequest = {
        events: mismatchedEvents,
      };
      expect(() => replayAgentAttemptJournal(mismatchedReplayRequest)).toThrow(
        'terminal result differs from its projection event',
      );
      const duplicateViewEvents: AgentAttemptEvent[] = [];
      for (const event of parsedEvents) {
        if (event.kind === AgentAttemptEventKind.AttemptTerminalRecorded) {
          const shiftedTerminal: AgentAttemptEvent = {
            ...event,
            sequence: event.sequence + 1,
          };
          duplicateViewEvents.push(shiftedTerminal);
          continue;
        }
        duplicateViewEvents.push(event);
        if (event.kind === AgentAttemptEventKind.ViewProjected) {
          const duplicateView: AgentAttemptEvent = {
            ...event,
            sequence: event.sequence + 1,
          };
          duplicateViewEvents.push(duplicateView);
        }
      }
      const duplicateViewReplayRequest: ReplayAgentAttemptJournalRequest = {
        events: duplicateViewEvents,
      };
      expect(() =>
        replayAgentAttemptJournal(duplicateViewReplayRequest),
      ).toThrow('duplicate views');
      expect(processing.view.presence).toBe(MaterializedViewPresence.Recorded);
      if (processing.view.presence === MaterializedViewPresence.Recorded) {
        const view = await readFile(
          join(runDirectory, processing.view.projection.path),
          'utf8',
        );
        expect(processing.view.authorKind).toBe(
          MaterializedViewAuthorKind.Agent,
        );
        expect(view).toBe('# Inspection\n\nEvidence is complete.\n');
      }
      const lateEvent: AgentAttemptEventWithoutMetadata = {
        kind: AgentAttemptEventKind.AttemptStarted,
      };
      await expect(journal.append(lateEvent)).rejects.toThrow(
        'finalized agent attempt journal',
      );
    } finally {
      await rm(runDirectory, removeOptions);
    }
  });

  test('labels a machine-authored view when the agent fails', async () => {
    const runDirectory = await mkdtemp(join(tmpdir(), 'loom-agent-failure-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const journal = new AgentAttemptJournal<'inspect'>(
        configuration(runDirectory),
      );
      await journal.initialize();
      const terminal: FailedTaskTerminal<'inspect'> = {
        kind: TaskTerminalKind.Failed,
        task: 'inspect',
        attempt: 1,
        summary: 'Normalized runtime failure.',
      };
      const processing = await journal.finalize(terminal);

      expect(processing.view.presence).toBe(MaterializedViewPresence.Recorded);
      if (processing.view.presence === MaterializedViewPresence.Recorded) {
        expect(processing.view.authorKind).toBe(
          MaterializedViewAuthorKind.LoomRuntime,
        );
      }
    } finally {
      await rm(runDirectory, removeOptions);
    }
  });

  test('rejects path traversal in attempt identities', () => {
    const unsafe = { ...configuration('/tmp'), task: '../escape' };
    expect(() => new AgentAttemptJournal(unsafe)).toThrow(
      'Unsafe agent processing identifier',
    );
  });
});

function configuration(runDirectory: string): AgentAttemptJournalConfiguration {
  return {
    runDirectory,
    runId: 'run-1',
    workflow: StaticAgentWorkflowName.CortexFullGarbageCollection,
    workflowVersion: '1.0.0',
    sourceCommit: SOURCE_COMMIT,
    task: 'inspect',
    agent: 'auditor',
    attempt: 1,
    depth: 1,
    parent: { kind: AgentAttemptParentKind.WorkflowRoot },
    now: () => FIXED_TIME,
  };
}

function sha256(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex');
}
