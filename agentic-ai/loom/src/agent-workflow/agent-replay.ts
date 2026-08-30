import { AgentAttemptEventKind } from './agent-events.ts';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
  TaskTerminalKind,
} from './domain.ts';
import { WorkflowRuntimeActivityKind } from './events.ts';
import type {
  AgentAttemptEvent,
  AgentAttemptEventMetadata,
} from './agent-events.ts';
import { MAX_AGENT_HIERARCHY_DEPTH } from './hierarchy.ts';
import type {
  MaterializedViewReference,
  ProjectionReference,
} from './domain.ts';
import { assertCurrentAgentAttemptWorkflowVersion } from './agent-attempt-version.ts';
import { assertCortexReferences } from './cortex-references.ts';
import { cortexActionId } from './agent-event-renderer.ts';

export type ReplayAgentAttemptJournalRequest = {
  readonly events: readonly AgentAttemptEvent[];
};

export type ReplayedAgentAttempt = {
  readonly eventCount: number;
  readonly terminalKind: TaskTerminalKind;
  readonly view: MaterializedViewReference;
};

const AGENT_EVENT_KINDS = new Set<string>(Object.values(AgentAttemptEventKind));
const AGENT_ATTEMPT_ADAPTER_KINDS = new Set<string>(
  Object.values(AgentAttemptAdapterKind),
);
const RUNTIME_ACTIVITY_KINDS = new Set<string>(
  Object.values(WorkflowRuntimeActivityKind),
);
const TASK_TERMINAL_KINDS = new Set<string>(Object.values(TaskTerminalKind));
const VIEW_AUTHOR_KINDS = new Set<string>(
  Object.values(MaterializedViewAuthorKind),
);
const PARENT_KINDS = new Set<string>(Object.values(AgentAttemptParentKind));
const PROCESSING_WORKFLOW_NAMES = new Set<string>(
  Object.values(DelegatedAgentWorkflowName),
);
export function replayAgentAttemptJournal(
  request: ReplayAgentAttemptJournalRequest,
): ReplayedAgentAttempt {
  const first = request.events[0];
  if (!first || first.kind !== AgentAttemptEventKind.AttemptStarted) {
    throw new Error('Agent attempt journal must start with attempt-started.');
  }
  assertCurrentAgentAttemptWorkflowVersion(first.workflowVersion);
  let projectedResult: ProjectionReference | false = false;
  let sawView = false;
  let terminal: ReplayedAgentAttempt | false = false;
  for (const [index, event] of request.events.entries()) {
    if (!AGENT_EVENT_KINDS.has(event.kind)) {
      throw new Error('Agent attempt journal contains an unknown event kind.');
    }
    if (terminal) {
      throw new Error(
        'Agent attempt journal contains an event after terminal.',
      );
    }
    if (event.sequence !== index + 1) {
      throw new Error(
        `Agent attempt journal sequence ${event.sequence} must equal ${index + 1}.`,
      );
    }
    if (event.actionId !== cortexActionId(event.sequence)) {
      throw new Error('Agent attempt journal action identity is invalid.');
    }
    assertCurrentAgentAttemptWorkflowVersion(event.workflowVersion);
    const identityPair: AgentAttemptIdentityPair = {
      expected: first,
      actual: event,
    };
    assertSameIdentity(identityPair);
    if (!PARENT_KINDS.has(event.parent.kind)) {
      throw new Error('Agent attempt journal contains an unknown parent kind.');
    }
    assertValidIdentity(event);
    if (
      event.kind === AgentAttemptEventKind.AttemptStarted &&
      event.sequence !== 1
    ) {
      throw new Error('Agent attempt journal contains a duplicate start.');
    }
    if (event.kind === AgentAttemptEventKind.ResultProjected) {
      if (projectedResult) {
        throw new Error('Agent attempt journal contains duplicate results.');
      }
      if (!validProjection(event.result)) {
        throw new Error('Agent attempt result projection is invalid.');
      }
      projectedResult = event.result;
    }
    if (
      event.kind === AgentAttemptEventKind.RuntimeActivity &&
      (!RUNTIME_ACTIVITY_KINDS.has(event.activity) ||
        Object.hasOwn(event, 'detail') ||
        ('evidenceSha256' in event &&
          !/^[0-9a-f]{64}$/u.test(event.evidenceSha256)))
    ) {
      throw new Error(
        'Agent attempt journal contains unknown runtime activity.',
      );
    }
    if (event.kind === AgentAttemptEventKind.RuntimeActivity) {
      const referenceArgs = {
        references: event.cortexReferences,
        knownIdentifiers: false,
      } as const;
      assertCortexReferences(referenceArgs);
    }
    if (event.kind === AgentAttemptEventKind.ViewProjected) {
      if (sawView) {
        throw new Error('Agent attempt journal contains duplicate views.');
      }
      if (!projectedResult) {
        throw new Error('Agent attempt view was projected before its result.');
      }
      if (
        event.view.presence !== MaterializedViewPresence.Recorded ||
        event.view.eventHighWaterMark !== event.sequence - 1 ||
        !validProjection(event.view.projection) ||
        !VIEW_AUTHOR_KINDS.has(event.view.authorKind)
      ) {
        throw new Error(
          'Agent attempt view has an invalid event high-water mark.',
        );
      }
      sawView = true;
    }
    if (event.kind === AgentAttemptEventKind.AttemptTerminalRecorded) {
      if (!TASK_TERMINAL_KINDS.has(event.terminalKind)) {
        throw new Error('Agent attempt terminal kind is unknown.');
      }
      if (!projectedResult) {
        throw new Error('Agent attempt terminal has no result projection.');
      }
      if (JSON.stringify(projectedResult) !== JSON.stringify(event.result)) {
        throw new Error(
          'Agent attempt terminal result differs from its projection event.',
        );
      }
      if (!sawView) {
        throw new Error('Agent attempt terminal has no materialized view.');
      }
      const viewProjectionEvent = request.events.find(
        (candidate) => candidate.kind === AgentAttemptEventKind.ViewProjected,
      );
      if (
        !viewProjectionEvent ||
        JSON.stringify(viewProjectionEvent.view) !== JSON.stringify(event.view)
      ) {
        throw new Error(
          'Agent attempt terminal view differs from its projection event.',
        );
      }
      if (
        event.view.presence !== MaterializedViewPresence.Recorded ||
        (event.terminalKind === TaskTerminalKind.Completed
          ? event.view.authorKind !== MaterializedViewAuthorKind.Agent
          : event.view.authorKind !== MaterializedViewAuthorKind.LoomRuntime)
      ) {
        throw new Error(
          'Agent attempt terminal and materialized view author are inconsistent.',
        );
      }
      terminal = {
        eventCount: request.events.length,
        terminalKind: event.terminalKind,
        view: event.view,
      };
    }
  }
  if (!terminal) {
    throw new Error('Agent attempt journal has no terminal event.');
  }
  return terminal;
}

function assertValidIdentity(event: AgentAttemptEventMetadata): void {
  if (
    !AGENT_ATTEMPT_ADAPTER_KINDS.has(event.adapter) ||
    !safeIdentifier(event.task) ||
    !safeIdentifier(event.agent) ||
    !safeIdentifier(event.runId) ||
    !PROCESSING_WORKFLOW_NAMES.has(event.workflow) ||
    event.workflowVersion.trim() === '' ||
    event.workflowVersion.length > 128 ||
    !/^[0-9a-f]{40}$/.test(event.sourceCommit) ||
    Number.isNaN(Date.parse(event.occurredAt)) ||
    !Number.isSafeInteger(event.attempt) ||
    event.attempt < 1 ||
    !Number.isSafeInteger(event.depth) ||
    event.depth < 1 ||
    event.depth > MAX_AGENT_HIERARCHY_DEPTH
  ) {
    throw new Error('Agent attempt journal identity is invalid.');
  }
  if (event.parent.kind === AgentAttemptParentKind.WorkflowRoot) {
    if (event.depth !== 1 || Object.keys(event.parent).length !== 1) {
      throw new Error('Root agent attempt lineage is invalid.');
    }
    return;
  }
  if (
    event.depth < 2 ||
    !safeIdentifier(event.parent.task) ||
    !safeIdentifier(event.parent.agent) ||
    !Number.isSafeInteger(event.parent.attempt) ||
    event.parent.attempt < 1 ||
    (event.parent.task === event.task &&
      event.parent.agent === event.agent &&
      event.parent.attempt === event.attempt)
  ) {
    throw new Error('Parent agent attempt lineage is invalid.');
  }
}

function safeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function validProjection(projection: ProjectionReference): boolean {
  return (
    projection.path.trim() !== '' && /^[0-9a-f]{64}$/.test(projection.sha256)
  );
}

type AgentAttemptIdentityPair = {
  readonly expected: AgentAttemptEventMetadata;
  readonly actual: AgentAttemptEventMetadata;
};

function assertSameIdentity(pair: AgentAttemptIdentityPair): void {
  const expected = pair.expected;
  const actual = pair.actual;
  if (
    actual.adapter !== expected.adapter ||
    actual.runId !== expected.runId ||
    actual.workflow !== expected.workflow ||
    actual.workflowVersion !== expected.workflowVersion ||
    actual.sourceCommit !== expected.sourceCommit ||
    actual.task !== expected.task ||
    actual.agent !== expected.agent ||
    actual.attempt !== expected.attempt ||
    actual.depth !== expected.depth ||
    JSON.stringify(actual.parent) !== JSON.stringify(expected.parent)
  ) {
    throw new Error(
      'Agent attempt journal identity changed within the stream.',
    );
  }
}
