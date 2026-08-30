import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
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
import {
  CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
  LEGACY_AGENT_ATTEMPT_WORKFLOW_VERSION,
  PROVENANCE_AGENT_ATTEMPT_WORKFLOW_VERSION,
} from '../../src/agent-workflow/agent-attempt-version.ts';
import { CortexReferenceRelation } from '../../src/agent-workflow/cortex-references.ts';

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
        cortexReferences: [
          { id: 'CX-AI', relation: CortexReferenceRelation.Applied },
        ],
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
      const knownCortexIdentifiers = new Set(['CX-AI']);
      const replayRequest: ReplayAgentAttemptJournalRequest = {
        events: parsedEvents,
        knownCortexIdentifiers,
      };
      const replay = replayAgentAttemptJournal(replayRequest);
      expect(processing.events.sha256).toBe(sha256(events));
      expect(replay.terminalKind).toBe(TaskTerminalKind.Completed);
      const unregisteredReferenceEvents = parsedEvents.map((event) =>
        event.kind === AgentAttemptEventKind.RuntimeActivity
          ? {
              ...event,
              cortexReferences: [
                {
                  id: 'CX-AI-7K3M2',
                  relation: CortexReferenceRelation.Applied,
                },
              ],
            }
          : event,
      );
      expect(() =>
        replayAgentAttemptJournal({
          events: unregisteredReferenceEvents,
          knownCortexIdentifiers,
        }),
      ).toThrow('invalid Cortex reference');
      expect(parsedEvents.map((event) => event.actionId)).toEqual([
        'a0001',
        'a0002',
        'a0003',
        'a0004',
        'a0005',
      ]);
      const expectedReferencedEvent = {
        cortexReferences: [
          { id: 'CX-AI', relation: CortexReferenceRelation.Applied },
        ],
      };
      expect(parsedEvents[1]).toMatchObject(expectedReferencedEvent);
      const firstEvent = parsedEvents[0]!;
      const unknownKindEvent = {
        ...firstEvent,
        kind: 'future-agent-event',
        sequence: 2,
        actionId: 'a0002',
      } as never as AgentAttemptEvent;
      const shiftedEvents = parsedEvents.slice(1).map((event) => ({
        ...event,
        sequence: event.sequence + 1,
        actionId: `a${(event.sequence + 1).toString().padStart(4, '0')}`,
      }));
      const unknownKindEvents = [
        firstEvent,
        unknownKindEvent,
        ...shiftedEvents,
      ];
      const unknownKindRequest: ReplayAgentAttemptJournalRequest = {
        events: unknownKindEvents,
        knownCortexIdentifiers,
      };
      expect(() => replayAgentAttemptJournal(unknownKindRequest)).toThrow(
        'unknown event kind',
      );
      const invalidActionIdentity = parsedEvents.map((event) =>
        event.sequence === 2 ? { ...event, actionId: 'a9999' } : event,
      );
      const invalidActionRequest = {
        events: invalidActionIdentity,
        knownCortexIdentifiers,
      };
      expect(() => replayAgentAttemptJournal(invalidActionRequest)).toThrow(
        'action identity is invalid',
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
        knownCortexIdentifiers,
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
            actionId: `a${(event.sequence + 1).toString().padStart(4, '0')}`,
          };
          duplicateViewEvents.push(shiftedTerminal);
          continue;
        }
        duplicateViewEvents.push(event);
        if (event.kind === AgentAttemptEventKind.ViewProjected) {
          const duplicateView: AgentAttemptEvent = {
            ...event,
            sequence: event.sequence + 1,
            actionId: `a${(event.sequence + 1).toString().padStart(4, '0')}`,
          };
          duplicateViewEvents.push(duplicateView);
        }
      }
      const duplicateViewReplayRequest: ReplayAgentAttemptJournalRequest = {
        events: duplicateViewEvents,
        knownCortexIdentifiers,
      };
      expect(() =>
        replayAgentAttemptJournal(duplicateViewReplayRequest),
      ).toThrow('duplicate views');
      const secretBearingActivityEvents = parsedEvents.map((event) =>
        event.kind === AgentAttemptEventKind.RuntimeActivity
          ? { ...event, detail: 'secret-bearing free-form text' }
          : event,
      );
      const secretBearingActivityRequest = {
        events: secretBearingActivityEvents,
        knownCortexIdentifiers,
      };
      expect(() =>
        replayAgentAttemptJournal(secretBearingActivityRequest),
      ).toThrow('runtime activity');
      const malformedParentEvents = parsedEvents.map((event) => ({
        ...event,
        parent: { kind: AgentAttemptParentKind.AgentAttempt },
      })) as never as readonly AgentAttemptEvent[];
      const malformedParentRequest = {
        events: malformedParentEvents,
        knownCortexIdentifiers,
      };
      expect(() => replayAgentAttemptJournal(malformedParentRequest)).toThrow(
        'lineage',
      );
      const excessiveDepthEvents = parsedEvents.map((event) => ({
        ...event,
        depth: 4,
      }));
      const excessiveDepthRequest = {
        events: excessiveDepthEvents,
        knownCortexIdentifiers,
      };
      expect(() => replayAgentAttemptJournal(excessiveDepthRequest)).toThrow(
        'identity is invalid',
      );
      const mismatchedAdapterEvents = parsedEvents.map((event) =>
        event.kind === AgentAttemptEventKind.AttemptTerminalRecorded
          ? {
              ...event,
              adapter: AgentAttemptAdapterKind.ModuleExpertInvocation,
            }
          : event,
      );
      const mismatchedAdapterRequest = {
        events: mismatchedAdapterEvents,
        knownCortexIdentifiers,
      };
      expect(() => replayAgentAttemptJournal(mismatchedAdapterRequest)).toThrow(
        'identity changed within the stream',
      );
      const unknownAdapterEvents = parsedEvents.map((event) => ({
        ...event,
        adapter: 'caller-forged-adapter',
      })) as never as readonly AgentAttemptEvent[];
      const unknownAdapterRequest = {
        events: unknownAdapterEvents,
        knownCortexIdentifiers,
      };
      expect(() => replayAgentAttemptJournal(unknownAdapterRequest)).toThrow(
        'identity is invalid',
      );
      const wrongAuthorEvents = parsedEvents.map((event) => {
        if (
          event.kind !== AgentAttemptEventKind.ViewProjected &&
          event.kind !== AgentAttemptEventKind.AttemptTerminalRecorded
        ) {
          return event;
        }
        return {
          ...event,
          view: {
            ...event.view,
            authorKind: MaterializedViewAuthorKind.LoomRuntime,
          },
        };
      }) as readonly AgentAttemptEvent[];
      const wrongAuthorRequest = {
        events: wrongAuthorEvents,
        knownCortexIdentifiers,
      };
      expect(() => replayAgentAttemptJournal(wrongAuthorRequest)).toThrow(
        'view author',
      );
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

  test('does not let compact output failure gate journal persistence', async () => {
    const runDirectory = await mkdtemp(join(tmpdir(), 'loom-agent-output-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const failingOutputConfiguration: AgentAttemptJournalConfiguration = {
        ...configuration(runDirectory),
        compactOutput: async () =>
          Promise.reject(new Error('Output unavailable.')),
      };
      const journal = new AgentAttemptJournal<'inspect'>(
        failingOutputConfiguration,
      );

      await expect(journal.initialize()).resolves.toBeUndefined();
      const events = await readFile(journal.eventsPath, 'utf8');
      expect(events).toContain('"actionId":"a0001"');
    } finally {
      await rm(runDirectory, removeOptions);
    }
  });

  test('requires a source-bound registry for referenced activity', async () => {
    const runDirectory = await mkdtemp(join(tmpdir(), 'loom-agent-registry-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const configured = configuration(runDirectory);
      const missingRegistryConfiguration: AgentAttemptJournalConfiguration = {
        adapter: configured.adapter,
        runDirectory: configured.runDirectory,
        runId: configured.runId,
        workflow: configured.workflow,
        workflowVersion: configured.workflowVersion,
        sourceCommit: configured.sourceCommit,
        task: configured.task,
        agent: configured.agent,
        attempt: configured.attempt,
        depth: configured.depth,
        parent: configured.parent,
        now: configured.now,
      };
      const journal = new AgentAttemptJournal<'inspect'>(
        missingRegistryConfiguration,
      );
      await journal.initialize();
      const referencedActivity: AgentAttemptEventWithoutMetadata = {
        kind: AgentAttemptEventKind.RuntimeActivity,
        activity: WorkflowRuntimeActivityKind.TurnCompleted,
        cortexReferences: [
          { id: 'CX-AI', relation: CortexReferenceRelation.Applied },
        ],
      };
      await expect(journal.append(referencedActivity)).rejects.toThrow(
        'source-bound registry',
      );
      expect(
        (await readFile(journal.eventsPath, 'utf8')).split('\n'),
      ).toHaveLength(2);
    } finally {
      await rm(runDirectory, removeOptions);
    }
  });

  test('rejects module expert evidence from a generic journal adapter', async () => {
    const runDirectory = await mkdtemp(join(tmpdir(), 'loom-agent-origin-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const genericConfiguration: AgentAttemptJournalConfiguration = {
        ...configuration(runDirectory),
        adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
      };
      const journal = new AgentAttemptJournal<'inspect'>(genericConfiguration);
      await journal.initialize();
      const terminal: CompletedTaskTerminal<'inspect'> = {
        kind: TaskTerminalKind.Completed,
        task: 'inspect',
        attempt: 1,
        threadId: 'generic-thread',
        output: {
          resultKind: WorkflowResultKind.ModuleExpertEvidence,
          summary: 'Caller-forged expert evidence.',
          materializedViewMarkdown: '# Forged evidence\n\nRejected.',
          findings: [],
          notesForParent: [],
          artifacts: [],
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
      };

      await expect(journal.finalize(terminal)).rejects.toThrow(
        'isolated invocation adapter',
      );
    } finally {
      await rm(runDirectory, removeOptions);
    }
  });

  test('rejects a structurally forged module expert journal adapter', () => {
    const forgedConfiguration = configuration('/tmp');
    Reflect.set(
      forgedConfiguration,
      'adapter',
      AgentAttemptAdapterKind.ModuleExpertInvocation,
    );

    expect(() => new AgentAttemptJournal(forgedConfiguration)).toThrow(
      'runtime completion authority',
    );
  });

  test('rejects path traversal in attempt identities', () => {
    const unsafe = { ...configuration('/tmp'), task: '../escape' };
    expect(() => new AgentAttemptJournal(unsafe)).toThrow(
      'Unsafe agent processing identifier',
    );
  });

  test('rejects hierarchy depth greater than three', () => {
    const excessiveDepth = { ...configuration('/tmp'), depth: 4 };
    expect(() => new AgentAttemptJournal(excessiveDepth)).toThrow(
      'hierarchy depth must be bounded',
    );
  });

  test('rejects legacy and unsupported attempt journal schemas', () => {
    const legacyConfiguration: AgentAttemptJournalConfiguration = {
      ...configuration('/tmp'),
      workflowVersion: LEGACY_AGENT_ATTEMPT_WORKFLOW_VERSION,
    };
    expect(() => new AgentAttemptJournal(legacyConfiguration)).toThrow(
      'legacy and cannot establish adapter provenance',
    );

    const legacyWithoutAdapter = {
      kind: AgentAttemptEventKind.AttemptStarted,
      runId: 'run-1',
      workflow: DelegatedAgentWorkflowName.AgentWork,
      workflowVersion: LEGACY_AGENT_ATTEMPT_WORKFLOW_VERSION,
      sourceCommit: SOURCE_COMMIT,
      task: 'inspect',
      agent: 'auditor',
      attempt: 1,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
      sequence: 1,
      actionId: 'a0001',
      occurredAt: FIXED_TIME,
    } as never as AgentAttemptEvent;
    const legacyReplayRequest = { events: [legacyWithoutAdapter] };
    expect(() => replayAgentAttemptJournal(legacyReplayRequest)).toThrow(
      'Remove or explicitly migrate the persisted attempt',
    );

    const currentWithoutAdapter = {
      ...legacyWithoutAdapter,
      workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
    };
    const currentReplayRequest = { events: [currentWithoutAdapter] };
    expect(() => replayAgentAttemptJournal(currentReplayRequest)).toThrow(
      'identity is invalid',
    );

    const unsupportedVersion = {
      ...legacyWithoutAdapter,
      workflowVersion: '4.0.0',
    };
    const unsupportedReplayRequest = { events: [unsupportedVersion] };
    expect(() => replayAgentAttemptJournal(unsupportedReplayRequest)).toThrow(
      'version is unsupported',
    );

    const provenanceVersion = {
      ...legacyWithoutAdapter,
      workflowVersion: PROVENANCE_AGENT_ATTEMPT_WORKFLOW_VERSION,
    };
    const provenanceRequest = { events: [provenanceVersion] };
    expect(() => replayAgentAttemptJournal(provenanceRequest)).toThrow(
      'predates compact action identities',
    );
  });
});

function configuration(runDirectory: string): AgentAttemptJournalConfiguration {
  return {
    adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
    runDirectory,
    runId: 'run-1',
    workflow: DelegatedAgentWorkflowName.AgentWork,
    workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
    sourceCommit: SOURCE_COMMIT,
    task: 'inspect',
    agent: 'auditor',
    attempt: 1,
    depth: 1,
    parent: { kind: AgentAttemptParentKind.WorkflowRoot },
    now: () => FIXED_TIME,
    knownCortexIdentifiers: new Set(['CX-AI']),
    compactOutput: () => {},
  };
}

function sha256(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex');
}
