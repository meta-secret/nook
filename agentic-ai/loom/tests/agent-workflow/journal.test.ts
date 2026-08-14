import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  StaticAgentWorkflowName,
  TaskTerminalKind,
  WorkflowResultKind,
  WorkflowTerminalKind,
} from '../../src/agent-workflow/domain.ts';
import { WorkflowEventKind } from '../../src/agent-workflow/events.ts';
import { WorkflowJournal } from '../../src/agent-workflow/journal.ts';
import {
  ReplayedWorkflowTerminalPresence,
  replayWorkflowJournal,
} from '../../src/agent-workflow/replay.ts';

import type { RmOptions } from 'node:fs';
import type {
  CompletedTaskTerminal,
  WorkflowRunTerminal,
} from '../../src/agent-workflow/domain.ts';
import type {
  TaskTerminalRecordedEvent,
  WorkflowEvent,
  WorkflowEventWithoutMetadata,
} from '../../src/agent-workflow/events.ts';
import type { WorkflowJournalConfiguration } from '../../src/agent-workflow/journal.ts';
import type { ReplayWorkflowJournalRequest } from '../../src/agent-workflow/replay.ts';

enum TestTask {
  Inspect = 'inspect',
}

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const STARTED_AT = '2026-08-14T00:00:00.000Z';
const FINISHED_AT = '2026-08-14T00:01:00.000Z';

describe('workflow journal', () => {
  test('rejects reuse of an existing local run directory', async () => {
    const runRoot = await mkdtemp(join(tmpdir(), 'loom-workflow-exclusive-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const configuration: WorkflowJournalConfiguration = {
        runRoot,
        identity: {
          runId: 'exclusive-run',
          workflow: StaticAgentWorkflowName.CortexFullGarbageCollection,
          workflowVersion: '1.0.0',
          sourceCommit: SOURCE_COMMIT,
        },
        now: () => STARTED_AT,
      };
      const firstJournal = new WorkflowJournal<TestTask>(configuration);
      const secondJournal = new WorkflowJournal<TestTask>(configuration);
      await firstJournal.initialize();
      await expect(secondJournal.initialize()).rejects.toThrow();
    } finally {
      await rm(runRoot, removeOptions);
    }
  });

  test('appends events and replays terminal projection references', async () => {
    const runRoot = await mkdtemp(join(tmpdir(), 'loom-workflow-journal-'));
    const removeOptions: RmOptions = { recursive: true, force: true };

    try {
      const configuration: WorkflowJournalConfiguration = {
        runRoot,
        identity: {
          runId: 'run-1',
          workflow: StaticAgentWorkflowName.CortexFullGarbageCollection,
          workflowVersion: '1.0.0',
          sourceCommit: SOURCE_COMMIT,
        },
        now: () => STARTED_AT,
      };
      const journal = new WorkflowJournal<TestTask>(configuration);
      await journal.initialize();

      const startedEvent: WorkflowEventWithoutMetadata<TestTask> = {
        kind: WorkflowEventKind.WorkflowStarted,
        entry: TestTask.Inspect,
      };
      await journal.append(startedEvent);

      const taskTerminal: CompletedTaskTerminal<TestTask> = {
        kind: TaskTerminalKind.Completed,
        task: TestTask.Inspect,
        attempt: 1,
        threadId: 'thread-1',
        output: {
          resultKind: WorkflowResultKind.CortexEvidence,
          summary: 'Inspection complete.',
          findings: [],
          notesForParent: [],
          artifacts: [],
        },
      };
      const taskProjection = await journal.projectTaskTerminal(taskTerminal);
      const taskTerminalEvent: WorkflowEventWithoutMetadata<TestTask> = {
        kind: WorkflowEventKind.TaskTerminalRecorded,
        task: TestTask.Inspect,
        attempt: 1,
        terminalKind: TaskTerminalKind.Completed,
        resultPath: taskProjection.path,
        resultSha256: taskProjection.sha256,
      };
      await journal.append(taskTerminalEvent);

      const workflowTerminal: WorkflowRunTerminal<TestTask> = {
        kind: WorkflowTerminalKind.Completed,
        runId: 'run-1',
        workflow: StaticAgentWorkflowName.CortexFullGarbageCollection,
        version: '1.0.0',
        sourceCommit: SOURCE_COMMIT,
        taskTerminals: [taskTerminal],
        startedAt: STARTED_AT,
        finishedAt: FINISHED_AT,
      };
      const workflowProjection =
        await journal.projectWorkflowTerminal(workflowTerminal);
      const workflowTerminalEvent: WorkflowEventWithoutMetadata<TestTask> = {
        kind: WorkflowEventKind.WorkflowTerminalRecorded,
        terminalKind: WorkflowTerminalKind.Completed,
        resultPath: workflowProjection.path,
        resultSha256: workflowProjection.sha256,
      };
      await journal.append(workflowTerminalEvent);

      const eventText = await readFile(journal.eventsPath, 'utf8');
      const events = eventText
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as WorkflowEvent<TestTask>);
      const replayRequest: ReplayWorkflowJournalRequest<TestTask> = { events };
      const replay = replayWorkflowJournal(replayRequest);

      expect(replay.eventCount).toBe(3);
      expect(replay.taskTerminals).toHaveLength(1);
      expect(replay.taskTerminals[0]?.resultSha256).toBe(taskProjection.sha256);
      expect(replay.workflowTerminal.presence).toBe(
        ReplayedWorkflowTerminalPresence.Recorded,
      );

      const taskResultPath = join(journal.runDirectory, taskProjection.path);
      const taskResultText = await readFile(taskResultPath, 'utf8');
      const expectedTaskDigest = createHash('sha256')
        .update(taskResultText)
        .digest('hex');
      expect(taskProjection.sha256).toBe(expectedTaskDigest);

      const runResultPath = join(journal.runDirectory, workflowProjection.path);
      const runResultText = await readFile(runResultPath, 'utf8');
      const expectedRunDigest = createHash('sha256')
        .update(runResultText)
        .digest('hex');
      expect(workflowProjection.sha256).toBe(expectedRunDigest);
    } finally {
      await rm(runRoot, removeOptions);
    }
  });

  test('rejects a non-monotonic event sequence', () => {
    const started: WorkflowEvent<TestTask> = {
      kind: WorkflowEventKind.WorkflowStarted,
      runId: 'run-1',
      workflow: StaticAgentWorkflowName.CortexFullGarbageCollection,
      workflowVersion: '1.0.0',
      sequence: 1,
      occurredAt: STARTED_AT,
      sourceCommit: SOURCE_COMMIT,
      entry: TestTask.Inspect,
    };
    const inconsistentTerminal: TaskTerminalRecordedEvent<TestTask> = {
      kind: WorkflowEventKind.TaskTerminalRecorded,
      runId: 'run-2',
      workflow: StaticAgentWorkflowName.CortexFullGarbageCollection,
      workflowVersion: '1.0.0',
      sequence: 3,
      occurredAt: FINISHED_AT,
      sourceCommit: SOURCE_COMMIT,
      task: TestTask.Inspect,
      attempt: 1,
      terminalKind: TaskTerminalKind.Completed,
      resultPath: 'task-results/inspect-attempt-1.json',
      resultSha256: 'digest',
    };
    const events: readonly WorkflowEvent<TestTask>[] = [
      started,
      inconsistentTerminal,
    ];
    const replayRequest: ReplayWorkflowJournalRequest<TestTask> = { events };

    expect(() => replayWorkflowJournal(replayRequest)).toThrow(
      'workflow journal sequence 3 must equal 2',
    );
  });

  test('rejects an event from another journal identity', () => {
    const started: WorkflowEvent<TestTask> = {
      kind: WorkflowEventKind.WorkflowStarted,
      runId: 'run-1',
      workflow: StaticAgentWorkflowName.CortexFullGarbageCollection,
      workflowVersion: '1.0.0',
      sequence: 1,
      occurredAt: STARTED_AT,
      sourceCommit: SOURCE_COMMIT,
      entry: TestTask.Inspect,
    };
    const inconsistentTerminal: TaskTerminalRecordedEvent<TestTask> = {
      kind: WorkflowEventKind.TaskTerminalRecorded,
      runId: 'run-2',
      workflow: StaticAgentWorkflowName.CortexFullGarbageCollection,
      workflowVersion: '1.0.0',
      sequence: 2,
      occurredAt: FINISHED_AT,
      sourceCommit: SOURCE_COMMIT,
      task: TestTask.Inspect,
      attempt: 1,
      terminalKind: TaskTerminalKind.Completed,
      resultPath: 'task-results/inspect-attempt-1.json',
      resultSha256: 'digest',
    };
    const events: readonly WorkflowEvent<TestTask>[] = [
      started,
      inconsistentTerminal,
    ];
    const replayRequest: ReplayWorkflowJournalRequest<TestTask> = { events };

    expect(() => replayWorkflowJournal(replayRequest)).toThrow(
      'workflow journal event 2 has a different identity',
    );
  });
});
