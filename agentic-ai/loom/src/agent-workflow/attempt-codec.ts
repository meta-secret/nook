import {
  AgentAttemptEventKind,
  type AgentAttemptEvent,
  type AgentAttemptEventMetadata,
  type LegacyAgentAttemptEvent,
  type LegacyAgentAttemptEventMetadata,
} from './agent-events.ts';
import {
  AgentAttemptSchema,
  BASE_EVIDENCE_AGENT_ATTEMPT_WORKFLOW_VERSION,
  CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
} from './agent-attempt-version.ts';
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
  UntrustedYamlPropertyPresence,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
} from '../lib/guards.ts';
import { PinnedDevBaseEvidenceContract } from '../lib/base-evidence.ts';
import type { PinnedDevBaseEvidence } from '../lib/base-evidence.ts';

/** Decodes persisted attempt artifacts before lifecycle or authorization logic. */
export class AgentAttemptTransport {
  private constructor() {}

  static decodeEvents(serialized: string): readonly AgentAttemptEvent[] {
    return serialized
      .trim()
      .split('\n')
      .map((line) => AgentAttemptTransport.decodeEvent(line));
  }

  static decodeCompatibleEvents(
    serialized: string,
  ): readonly (AgentAttemptEvent | LegacyAgentAttemptEvent)[] {
    return serialized
      .trim()
      .split('\n')
      .map((line) => AgentAttemptTransport.decodeCompatibleEvent(line));
  }

  static decodeEvent(serialized: string): AgentAttemptEvent {
    const event = AgentAttemptTransport.decodeCompatibleEvent(serialized);
    if (!AgentAttemptTransport.isCurrentEvent(event))
      throw new AgentAttemptDecodeError();
    return event;
  }

  private static isCurrentEvent(
    event: AgentAttemptEvent | LegacyAgentAttemptEvent,
  ): event is AgentAttemptEvent {
    return (
      event.workflowVersion === CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION &&
      Object.hasOwn(event, 'featureHeadSha')
    );
  }

  /** Decodes V4 and V5 events while preserving the V4 shape verbatim. */
  static decodeCompatibleEvent(
    serialized: string,
  ): AgentAttemptEvent | LegacyAgentAttemptEvent {
    const value = UntrustedYamlBoundary.fromJson(JSON.parse(serialized));
    const node = AgentAttemptTransport.record(value);
    const workflowVersion = AgentAttemptTransport.string(
      AgentAttemptTransport.field(node, 'workflowVersion'),
    );
    AgentAttemptSchema.assertCompatible(workflowVersion);
    const commonMetadata = {
      adapter: AgentAttemptTransport.enumeration({
        value: AgentAttemptTransport.field(node, 'adapter'),
        values: Object.values(AgentAttemptAdapterKind),
      }),
      runId: AgentAttemptTransport.string(
        AgentAttemptTransport.field(node, 'runId'),
      ),
      workflow: AgentAttemptTransport.enumeration({
        value: AgentAttemptTransport.field(node, 'workflow'),
        values: Object.values(DelegatedAgentWorkflowName),
      }),
      workflowVersion,
      sourceCommit: AgentAttemptTransport.string(
        AgentAttemptTransport.field(node, 'sourceCommit'),
      ),
      task: AgentAttemptTransport.string(
        AgentAttemptTransport.field(node, 'task'),
      ),
      agent: AgentAttemptTransport.string(
        AgentAttemptTransport.field(node, 'agent'),
      ),
      attempt: AgentAttemptTransport.integer(
        AgentAttemptTransport.field(node, 'attempt'),
      ),
      depth: AgentAttemptTransport.integer(
        AgentAttemptTransport.field(node, 'depth'),
      ),
      parent: AgentAttemptTransport.decodeParentField({ node, key: 'parent' }),
      sequence: AgentAttemptTransport.integer(
        AgentAttemptTransport.field(node, 'sequence'),
      ),
      actionId: AgentAttemptTransport.string(
        AgentAttemptTransport.field(node, 'actionId'),
      ),
      occurredAt: AgentAttemptTransport.string(
        AgentAttemptTransport.field(node, 'occurredAt'),
      ),
    };
    const hasFeatureHead = Object.hasOwn(node, 'featureHeadSha');
    const hasOriginMain = Object.hasOwn(node, 'originMainSha');
    const hasPinnedLocalDev = Object.hasOwn(node, 'pinnedLocalDevSha');
    if (
      workflowVersion === BASE_EVIDENCE_AGENT_ATTEMPT_WORKFLOW_VERSION &&
      (hasFeatureHead || hasOriginMain || hasPinnedLocalDev)
    )
      throw new AgentAttemptDecodeError();
    if (
      workflowVersion === CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION &&
      (!hasFeatureHead || !hasOriginMain || !hasPinnedLocalDev)
    )
      throw new AgentAttemptDecodeError();
    const metadata:
      AgentAttemptEventMetadata | LegacyAgentAttemptEventMetadata =
      hasFeatureHead
        ? {
            ...commonMetadata,
            originMainSha: AgentAttemptTransport.string(
              AgentAttemptTransport.field(node, 'originMainSha'),
            ),
            pinnedLocalDevSha: AgentAttemptTransport.string(
              AgentAttemptTransport.field(node, 'pinnedLocalDevSha'),
            ),
            featureHeadSha: AgentAttemptTransport.string(
              AgentAttemptTransport.field(node, 'featureHeadSha'),
            ),
          }
        : commonMetadata;
    if (hasFeatureHead) {
      if (!('featureHeadSha' in metadata)) throw new AgentAttemptDecodeError();
      PinnedDevBaseEvidenceContract.assertShape({
        originMainSha: metadata.originMainSha,
        pinnedLocalDevSha: metadata.pinnedLocalDevSha,
      });
    }
    const fields = Object.keys(metadata);
    const kind = AgentAttemptTransport.enumeration({
      value: AgentAttemptTransport.field(node, 'kind'),
      values: Object.values(AgentAttemptEventKind),
    });
    switch (kind) {
      case AgentAttemptEventKind.AttemptStarted: {
        const optional = Object.hasOwn(node, 'invocationContextSha256')
          ? {
              invocationContextSha256: AgentAttemptTransport.string(
                AgentAttemptTransport.field(node, 'invocationContextSha256'),
              ),
            }
          : {};
        AgentAttemptTransport.exactKeys({
          node,
          fields: [...fields, 'kind', ...Object.keys(optional)],
        });
        return { ...metadata, kind, ...optional } as
          AgentAttemptEvent | LegacyAgentAttemptEvent;
      }
      case AgentAttemptEventKind.ResultProjected:
        AgentAttemptTransport.exactKeys({
          node,
          fields: [...fields, 'kind', 'result'],
        });
        return {
          ...metadata,
          kind,
          result: AgentAttemptTransport.projection(
            AgentAttemptTransport.field(node, 'result'),
          ),
        } as AgentAttemptEvent | LegacyAgentAttemptEvent;
      case AgentAttemptEventKind.ViewProjected:
        AgentAttemptTransport.exactKeys({
          node,
          fields: [...fields, 'kind', 'view'],
        });
        return {
          ...metadata,
          kind,
          view: AgentAttemptTransport.view(
            AgentAttemptTransport.field(node, 'view'),
          ),
        } as AgentAttemptEvent | LegacyAgentAttemptEvent;
      case AgentAttemptEventKind.AttemptTerminalRecorded:
        AgentAttemptTransport.exactKeys({
          node,
          fields: [...fields, 'kind', 'terminalKind', 'result', 'view'],
        });
        return {
          ...metadata,
          kind,
          terminalKind: AgentAttemptTransport.enumeration({
            value: AgentAttemptTransport.field(node, 'terminalKind'),
            values: Object.values(TaskTerminalKind),
          }),
          result: AgentAttemptTransport.projection(
            AgentAttemptTransport.field(node, 'result'),
          ),
          view: AgentAttemptTransport.view(
            AgentAttemptTransport.field(node, 'view'),
          ),
        } as AgentAttemptEvent | LegacyAgentAttemptEvent;
      default:
        throw new AgentAttemptDecodeError();
    }
  }

  /** Copies a V4 event into the V5 wire shape with explicitly supplied evidence. */
  static migrateEvent(
    request: AgentAttemptEventMigrationRequest,
  ): AgentAttemptEvent {
    const { event, featureHeadSha, originMainSha, pinnedLocalDevSha } = request;
    if (event.workflowVersion !== BASE_EVIDENCE_AGENT_ATTEMPT_WORKFLOW_VERSION)
      throw new AgentAttemptDecodeError();
    PinnedDevBaseEvidenceContract.assertShape({
      originMainSha,
      pinnedLocalDevSha,
    });
    if (!/^[0-9a-f]{40}$/.test(featureHeadSha))
      throw new AgentAttemptDecodeError();
    return {
      ...event,
      originMainSha,
      pinnedLocalDevSha,
      workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
      featureHeadSha,
    } as AgentAttemptEvent;
  }

  static migrateEvents(
    request: AgentAttemptEventsMigrationRequest,
  ): readonly AgentAttemptEvent[] {
    return request.events.map((event) =>
      AgentAttemptTransport.migrateEvent({
        event,
        featureHeadSha: request.featureHeadSha,
        originMainSha: request.originMainSha,
        pinnedLocalDevSha: request.pinnedLocalDevSha,
      }),
    );
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
      task: AgentAttemptTransport.string(
        AgentAttemptTransport.field(node, 'task'),
      ),
      attempt: AgentAttemptTransport.integer(
        AgentAttemptTransport.field(node, 'attempt'),
      ),
    };
    const kind = AgentAttemptTransport.enumeration({
      value: AgentAttemptTransport.field(node, 'kind'),
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
        threadId: AgentAttemptTransport.string(
          AgentAttemptTransport.field(node, 'threadId'),
        ),
        output: WorkflowResultSchema.decodeWorkflowTaskOutputNode(
          AgentAttemptTransport.field(node, 'output'),
        ),
      };
    }
    AgentAttemptTransport.exactKeys({
      node,
      fields: ['kind', 'task', 'attempt', 'summary'],
    });
    return {
      ...identity,
      kind,
      summary: AgentAttemptTransport.string(
        AgentAttemptTransport.field(node, 'summary'),
      ),
    };
  }

  static decodeParent(value: AttemptTransportValue): AgentAttemptParent {
    const node = AgentAttemptTransport.record(value);
    const kind = AgentAttemptTransport.field(node, 'kind');
    if (kind === AgentAttemptParentKind.WorkflowRoot) {
      AgentAttemptTransport.exactKeys({ node, fields: ['kind'] });
      return { kind };
    }
    if (kind === AgentAttemptParentKind.AgentAttempt) {
      AgentAttemptTransport.exactKeys({
        node,
        fields: ['kind', 'task', 'agent', 'attempt'],
      });
      return {
        kind,
        task: AgentAttemptTransport.string(
          AgentAttemptTransport.field(node, 'task'),
        ),
        agent: AgentAttemptTransport.string(
          AgentAttemptTransport.field(node, 'agent'),
        ),
        attempt: AgentAttemptTransport.integer(
          AgentAttemptTransport.field(node, 'attempt'),
        ),
      };
    }
    throw new AgentAttemptDecodeError();
  }

  private static projection(value: AttemptTransportValue): ProjectionReference {
    const node = AgentAttemptTransport.record(value);
    AgentAttemptTransport.exactKeys({ node, fields: ['path', 'sha256'] });
    return {
      path: AgentAttemptTransport.string(
        AgentAttemptTransport.field(node, 'path'),
      ),
      sha256: AgentAttemptTransport.string(
        AgentAttemptTransport.field(node, 'sha256'),
      ),
    };
  }

  private static view(value: AttemptTransportValue): MaterializedViewReference {
    const node = AgentAttemptTransport.record(value);
    const presence = AgentAttemptTransport.field(node, 'presence');
    if (presence === MaterializedViewPresence.Unavailable) {
      AgentAttemptTransport.exactKeys({ node, fields: ['presence', 'reason'] });
      return {
        presence,
        reason: AgentAttemptTransport.string(
          AgentAttemptTransport.field(node, 'reason'),
        ),
      };
    }
    if (presence === MaterializedViewPresence.Recorded) {
      AgentAttemptTransport.exactKeys({
        node,
        fields: ['presence', 'authorKind', 'projection', 'eventHighWaterMark'],
      });
      return {
        presence,
        authorKind: AgentAttemptTransport.enumeration({
          value: AgentAttemptTransport.field(node, 'authorKind'),
          values: Object.values(MaterializedViewAuthorKind),
        }),
        projection: AgentAttemptTransport.projection(
          AgentAttemptTransport.field(node, 'projection'),
        ),
        eventHighWaterMark: AgentAttemptTransport.integer(
          AgentAttemptTransport.field(node, 'eventHighWaterMark'),
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
  static decodeParentField(request: AttemptFieldDecode): AgentAttemptParent {
    return AgentAttemptTransport.decodeParent(
      AgentAttemptTransport.field(request.node, request.key),
    );
  }
  static decodeTerminalField(
    request: AttemptFieldDecode,
  ): TaskTerminal<string> {
    return AgentAttemptTransport.decodeTerminalValue(
      AgentAttemptTransport.field(request.node, request.key),
    );
  }
  private static field(
    ...request: readonly [AttemptTransportRecord, string]
  ): AttemptTransportValue {
    const [node, key] = request;
    const property = UntrustedYamlBoundary.property({ record: node, key });
    if (property.presence === UntrustedYamlPropertyPresence.Absent)
      throw new AgentAttemptDecodeError();
    return property.value;
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
type AttemptTransportValue = UntrustedYamlNode;
type AttemptEnumDecode<T extends string> = {
  readonly value: AttemptTransportValue;
  readonly values: readonly T[];
};
type AttemptFieldsDecode = {
  readonly node: AttemptTransportRecord;
  readonly fields: readonly string[];
};
type AttemptFieldDecode = {
  readonly node: AttemptTransportRecord;
  readonly key: string;
};

export type AgentAttemptEventMigrationRequest = PinnedDevBaseEvidence & {
  readonly event: LegacyAgentAttemptEvent;
  readonly featureHeadSha: string;
};

export type AgentAttemptEventsMigrationRequest = PinnedDevBaseEvidence & {
  readonly events: readonly LegacyAgentAttemptEvent[];
  readonly featureHeadSha: string;
};

export class AgentAttemptDecodeError extends Error {
  constructor() {
    super('Invalid agent attempt artifact.');
    this.name = 'AgentAttemptDecodeError';
  }
}
