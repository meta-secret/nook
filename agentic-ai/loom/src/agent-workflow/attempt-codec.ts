import {
  AgentAttemptEventKind,
  type AgentAttemptEvent,
  type AgentAttemptEventMetadata,
} from './agent-events.ts';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
  TaskTerminalKind,
  type AgentAttemptParent,
  type MaterializedViewReference,
  type ProjectionReference,
  type TaskTerminal,
} from './domain.ts';
import { WorkflowResultSchema } from './structured-result-codec.ts';
import {
  UntrustedYamlBoundary,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
} from '../lib/guards.ts';

/** Decodes persisted attempt artifacts before lifecycle or authorization logic. */
export class AgentAttemptTransport {
  private constructor() {}

  static decodeEvents(serialized: string): readonly AgentAttemptEvent[] {
    return serialized
      .trim()
      .split('\n')
      .map((line) => AgentAttemptTransport.decodeEvent(line));
  }

  static decodeEvent(serialized: string): AgentAttemptEvent {
    const value = UntrustedYamlBoundary.fromJson(JSON.parse(serialized));
    const node = AgentAttemptTransport.record(value);
    const metadata: AgentAttemptEventMetadata = {
      adapter: AgentAttemptTransport.enumeration({
        value: node.adapter,
        values: Object.values(AgentAttemptAdapterKind),
      }),
      runId: AgentAttemptTransport.string(node.runId),
      workflow: AgentAttemptTransport.enumeration({
        value: node.workflow,
        values: Object.values(DelegatedAgentWorkflowName),
      }),
      workflowVersion: AgentAttemptTransport.string(node.workflowVersion),
      sourceCommit: AgentAttemptTransport.string(node.sourceCommit),
      task: AgentAttemptTransport.string(node.task),
      agent: AgentAttemptTransport.string(node.agent),
      attempt: AgentAttemptTransport.integer(node.attempt),
      depth: AgentAttemptTransport.integer(node.depth),
      parent: AgentAttemptTransport.decodeParent(node.parent),
      sequence: AgentAttemptTransport.integer(node.sequence),
      actionId: AgentAttemptTransport.string(node.actionId),
      occurredAt: AgentAttemptTransport.string(node.occurredAt),
    };
    const fields = Object.keys(metadata);
    switch (node.kind) {
      case AgentAttemptEventKind.AttemptStarted: {
        const optional = Object.hasOwn(node, 'invocationContextSha256')
          ? {
              invocationContextSha256: AgentAttemptTransport.string(
                node.invocationContextSha256,
              ),
            }
          : {};
        AgentAttemptTransport.exactKeys({
          node,
          fields: [...fields, 'kind', ...Object.keys(optional)],
        });
        return { ...metadata, kind: node.kind, ...optional };
      }
      case AgentAttemptEventKind.ResultProjected:
        AgentAttemptTransport.exactKeys({
          node,
          fields: [...fields, 'kind', 'result'],
        });
        return {
          ...metadata,
          kind: node.kind,
          result: AgentAttemptTransport.projection(node.result),
        };
      case AgentAttemptEventKind.ViewProjected:
        AgentAttemptTransport.exactKeys({
          node,
          fields: [...fields, 'kind', 'view'],
        });
        return {
          ...metadata,
          kind: node.kind,
          view: AgentAttemptTransport.view(node.view),
        };
      case AgentAttemptEventKind.AttemptTerminalRecorded:
        AgentAttemptTransport.exactKeys({
          node,
          fields: [...fields, 'kind', 'terminalKind', 'result', 'view'],
        });
        return {
          ...metadata,
          kind: node.kind,
          terminalKind: AgentAttemptTransport.enumeration({
            value: node.terminalKind,
            values: Object.values(TaskTerminalKind),
          }),
          result: AgentAttemptTransport.projection(node.result),
          view: AgentAttemptTransport.view(node.view),
        };
      default:
        throw new AgentAttemptDecodeError();
    }
  }

  static decodeTerminal(serialized: string): TaskTerminal<string> {
    const value = UntrustedYamlBoundary.fromJson(JSON.parse(serialized));
    return AgentAttemptTransport.decodeTerminalValue(value);
  }

  static decodeTerminalValue(
    value: AttemptTransportValue,
  ): TaskTerminal<string> {
    const node = AgentAttemptTransport.record(value);
    const identity = {
      task: AgentAttemptTransport.string(node.task),
      attempt: AgentAttemptTransport.integer(node.attempt),
    };
    const kind = AgentAttemptTransport.enumeration({
      value: node.kind,
      values: Object.values(TaskTerminalKind),
    });
    if (kind === TaskTerminalKind.Completed) {
      AgentAttemptTransport.exactKeys({
        node,
        fields: ['kind', 'task', 'attempt', 'threadId', 'output'],
      });
      return {
        ...identity,
        kind,
        threadId: AgentAttemptTransport.string(node.threadId),
        output: WorkflowResultSchema.decodeWorkflowTaskOutputNode(node.output),
      };
    }
    AgentAttemptTransport.exactKeys({
      node,
      fields: ['kind', 'task', 'attempt', 'summary'],
    });
    return {
      ...identity,
      kind,
      summary: AgentAttemptTransport.string(node.summary),
    };
  }

  static decodeParent(value: AttemptTransportValue): AgentAttemptParent {
    const node = AgentAttemptTransport.record(value);
    if (node.kind === AgentAttemptParentKind.WorkflowRoot) {
      AgentAttemptTransport.exactKeys({ node, fields: ['kind'] });
      return { kind: node.kind };
    }
    if (node.kind === AgentAttemptParentKind.AgentAttempt) {
      AgentAttemptTransport.exactKeys({
        node,
        fields: ['kind', 'task', 'agent', 'attempt'],
      });
      return {
        kind: node.kind,
        task: AgentAttemptTransport.string(node.task),
        agent: AgentAttemptTransport.string(node.agent),
        attempt: AgentAttemptTransport.integer(node.attempt),
      };
    }
    throw new AgentAttemptDecodeError();
  }

  private static projection(value: AttemptTransportValue): ProjectionReference {
    const node = AgentAttemptTransport.record(value);
    AgentAttemptTransport.exactKeys({ node, fields: ['path', 'sha256'] });
    return {
      path: AgentAttemptTransport.string(node.path),
      sha256: AgentAttemptTransport.string(node.sha256),
    };
  }

  private static view(value: AttemptTransportValue): MaterializedViewReference {
    const node = AgentAttemptTransport.record(value);
    if (node.presence === MaterializedViewPresence.Unavailable) {
      AgentAttemptTransport.exactKeys({ node, fields: ['presence', 'reason'] });
      return {
        presence: node.presence,
        reason: AgentAttemptTransport.string(node.reason),
      };
    }
    if (node.presence === MaterializedViewPresence.Recorded) {
      AgentAttemptTransport.exactKeys({
        node,
        fields: ['presence', 'authorKind', 'projection', 'eventHighWaterMark'],
      });
      return {
        presence: node.presence,
        authorKind: AgentAttemptTransport.enumeration({
          value: node.authorKind,
          values: Object.values(MaterializedViewAuthorKind),
        }),
        projection: AgentAttemptTransport.projection(node.projection),
        eventHighWaterMark: AgentAttemptTransport.integer(
          node.eventHighWaterMark,
        ),
      };
    }
    throw new AgentAttemptDecodeError();
  }

  private static record(value: AttemptTransportValue): AttemptTransportRecord {
    if (!AgentAttemptTransport.isRecord(value))
      throw new AgentAttemptDecodeError();
    return value;
  }
  private static isRecord(
    value: AttemptTransportValue,
  ): value is AttemptTransportRecord {
    return typeof value === 'object' && Boolean(value) && !Array.isArray(value);
  }
  private static string(value: AttemptTransportValue): string {
    if (typeof value !== 'string') throw new AgentAttemptDecodeError();
    return value;
  }
  private static integer(value: AttemptTransportValue): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value))
      throw new AgentAttemptDecodeError();
    return value;
  }
  private static enumeration<T extends string>(
    request: AttemptEnumDecode<T>,
  ): T {
    for (const value of request.values) {
      if (value === request.value) return value;
    }
    throw new AgentAttemptDecodeError();
  }
  private static exactKeys(request: AttemptFieldsDecode): void {
    const keys = Object.keys(request.node);
    if (
      keys.length !== request.fields.length ||
      keys.some((key) => !request.fields.includes(key))
    )
      throw new AgentAttemptDecodeError();
  }
}

type AttemptTransportRecord = UntrustedYamlMap;
type AttemptTransportValue = UntrustedYamlNode | void;
type AttemptEnumDecode<T extends string> = {
  readonly value: AttemptTransportValue;
  readonly values: readonly T[];
};
type AttemptFieldsDecode = {
  readonly node: AttemptTransportRecord;
  readonly fields: readonly string[];
};

export class AgentAttemptDecodeError extends Error {
  constructor() {
    super('Invalid agent attempt artifact.');
    this.name = 'AgentAttemptDecodeError';
  }
}
