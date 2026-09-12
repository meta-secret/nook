import { AgentAttemptEventKind } from './agent-events.ts';

import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
  TaskTerminalKind,
} from './domain.ts';

import type {
  AgentAttemptEvent,
  AgentAttemptEventMetadata,
} from './agent-events.ts';

import { MAX_AGENT_HIERARCHY_DEPTH } from './hierarchy.ts';

import type {
  MaterializedViewReference,
  ProjectionReference,
} from './domain.ts';

import { AgentAttemptSchema } from './agent-attempt-version.ts';

import { AgentEventPresentation } from './agent-event-renderer.ts';

export class AgentAttemptReplay {
  private constructor(
    private readonly request: ReplayAgentAttemptJournalRequest,
  ) {}
  static replay(
    request: ReplayAgentAttemptJournalRequest,
  ): ReplayedAgentAttempt {
    return new AgentAttemptReplay(request).execute();
  }
  private execute(): ReplayedAgentAttempt {
    const request = this.request;
    const first = request.events[0];
    if (!first || first.kind !== AgentAttemptEventKind.AttemptStarted) {
      throw new Error('Agent attempt journal must start with attempt-started.');
    }
    const moduleExpertAttempt =
      first.adapter === AgentAttemptAdapterKind.ModuleExpertInvocation;
    if (
      moduleExpertAttempt
        ? !first.invocationContextSha256 ||
          !/^[0-9a-f]{64}$/u.test(first.invocationContextSha256)
        : first.invocationContextSha256
    ) {
      throw new Error('Agent attempt invocation context binding is invalid.');
    }
    AgentAttemptSchema.assertCurrent(first.workflowVersion);
    let projectedResult: ProjectionReference | false = false;
    let sawView = false;
    let terminal: ReplayedAgentAttempt | false = false;
    for (const [index, event] of request.events.entries()) {
      if (!AGENT_EVENT_KINDS.has(event.kind)) {
        throw new Error(
          'Agent attempt journal contains an unknown event kind.',
        );
      }
      if (!this.eventHasExactKeys(event)) {
        throw new Error('Agent attempt journal event fields are invalid.');
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
      if (
        event.actionId !== AgentEventPresentation.cortexActionId(event.sequence)
      ) {
        throw new Error('Agent attempt journal action identity is invalid.');
      }
      AgentAttemptSchema.assertCurrent(event.workflowVersion);
      const identityPair: AgentAttemptIdentityPair = {
        expected: first,
        actual: event,
      };
      this.assertSameIdentity(identityPair);
      if (!PARENT_KINDS.has(event.parent.kind)) {
        throw new Error(
          'Agent attempt journal contains an unknown parent kind.',
        );
      }
      this.assertValidIdentity(event);
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
        if (!this.validProjection(event.result)) {
          throw new Error('Agent attempt result projection is invalid.');
        }
        projectedResult = event.result;
      }
      if (event.kind === AgentAttemptEventKind.ViewProjected) {
        if (sawView) {
          throw new Error('Agent attempt journal contains duplicate views.');
        }
        if (!projectedResult) {
          throw new Error(
            'Agent attempt view was projected before its result.',
          );
        }
        if (
          !this.validMaterializedView(event.view) ||
          event.view.presence !== MaterializedViewPresence.Recorded ||
          event.view.eventHighWaterMark !== event.sequence - 1 ||
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
          JSON.stringify(viewProjectionEvent.view) !==
            JSON.stringify(event.view)
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

  private assertValidIdentity(event: AgentAttemptEventMetadata): void {
    if (
      !AGENT_ATTEMPT_ADAPTER_KINDS.has(event.adapter) ||
      !this.safeIdentifier(event.task) ||
      !this.safeIdentifier(event.agent) ||
      !this.safeIdentifier(event.runId) ||
      !PROCESSING_WORKFLOW_NAMES.has(event.workflow) ||
      event.workflowVersion.trim() === '' ||
      event.workflowVersion.length > 128 ||
      !/^[0-9a-f]{40}$/.test(event.sourceCommit) ||
      Number.isNaN(Date.parse(event.occurredAt)) ||
      !Number.isSafeInteger(event.attempt) ||
      event.attempt < 1 ||
      !Number.isSafeInteger(event.depth) ||
      event.depth < 1 ||
      event.depth > MAX_AGENT_HIERARCHY_DEPTH ||
      (event.parent.kind === AgentAttemptParentKind.AgentAttempt &&
        Object.keys(event.parent).length !== 4)
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
      !this.safeIdentifier(event.parent.task) ||
      !this.safeIdentifier(event.parent.agent) ||
      !Number.isSafeInteger(event.parent.attempt) ||
      event.parent.attempt < 1 ||
      (event.parent.task === event.task &&
        event.parent.agent === event.agent &&
        event.parent.attempt === event.attempt)
    ) {
      throw new Error('Parent agent attempt lineage is invalid.');
    }
  }

  private safeIdentifier(value: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
  }

  private validProjection(projection: ProjectionReference): boolean {
    return (
      Object.keys(projection).length === 2 &&
      Object.hasOwn(projection, 'path') &&
      Object.hasOwn(projection, 'sha256') &&
      projection.path.trim() !== '' &&
      /^[0-9a-f]{64}$/.test(projection.sha256)
    );
  }

  private validMaterializedView(view: MaterializedViewReference): boolean {
    if (view.presence !== MaterializedViewPresence.Recorded) return false;
    const expected = new Set([
      'presence',
      'authorKind',
      'eventHighWaterMark',
      'projection',
    ]);
    const keys = Object.keys(view);
    return (
      keys.length === expected.size &&
      keys.every((key) => expected.has(key)) &&
      this.validProjection(view.projection)
    );
  }

  private eventHasExactKeys(event: AgentAttemptEvent): boolean {
    const startFields =
      event.kind === AgentAttemptEventKind.AttemptStarted &&
      event.invocationContextSha256
        ? ['invocationContextSha256']
        : [];
    const fieldsByKind: Record<AgentAttemptEventKind, readonly string[]> = {
      [AgentAttemptEventKind.AttemptStarted]: startFields,
      [AgentAttemptEventKind.ResultProjected]: ['result'],
      [AgentAttemptEventKind.ViewProjected]: ['view'],
      [AgentAttemptEventKind.AttemptTerminalRecorded]: [
        'terminalKind',
        'result',
        'view',
      ],
    };
    const expected = new Set([
      ...EVENT_METADATA_KEYS,
      'kind',
      ...fieldsByKind[event.kind],
    ]);
    const keys = Object.keys(event);
    return (
      keys.length === expected.size && keys.every((key) => expected.has(key))
    );
  }

  private assertSameIdentity(pair: AgentAttemptIdentityPair): void {
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
}

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

const TASK_TERMINAL_KINDS = new Set<string>(Object.values(TaskTerminalKind));

const VIEW_AUTHOR_KINDS = new Set<string>(
  Object.values(MaterializedViewAuthorKind),
);

const PARENT_KINDS = new Set<string>(Object.values(AgentAttemptParentKind));

const PROCESSING_WORKFLOW_NAMES = new Set<string>(
  Object.values(DelegatedAgentWorkflowName),
);

const EVENT_METADATA_KEYS = [
  'adapter',
  'runId',
  'workflow',
  'workflowVersion',
  'sourceCommit',
  'task',
  'agent',
  'attempt',
  'depth',
  'parent',
  'sequence',
  'actionId',
  'occurredAt',
] as const;

type AgentAttemptIdentityPair = {
  readonly expected: AgentAttemptEventMetadata;
  readonly actual: AgentAttemptEventMetadata;
};
