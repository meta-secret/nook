import {
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
} from './domain.ts';
import type {
  AgentAttemptParent,
  ParentAgentAttempt,
  WorkflowRootParent,
} from './domain.ts';
import {
  DELEGATION_PLAN_SCHEMA_VERSION,
  DelegationBarrierPolicy,
  DelegationRunEventKind,
  DelegationPlanContract,
} from './delegation-domain.ts';
import type {
  DelegationAdmissionRequest,
  DelegationAttemptDeclaration,
  DelegationAttemptIdentity,
  DelegationPlan,
  DelegationRunEvent,
  DelegationRunEventMetadata,
  DelegationTerminalBarrier,
} from './delegation-domain.ts';
import {
  UntrustedYamlPropertyPresence,
  UntrustedYamlBoundary,
} from '../lib/guards.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';

/** Owns the delegation journal schema registry and its capability transitions. */
export class DelegationJournalSchema {
  private constructor() {}
  private static readonly PLAN_FIELDS = [
    'schemaVersion',
    'workflow',
    'runId',
    'sourceCommit',
    'rootMaterializer',
    'attempts',
  ] as const;

  private static readonly IDENTITY_FIELDS = [
    'task',
    'agent',
    'attempt',
  ] as const;

  private static readonly DECLARATION_FIELDS = [
    'identity',
    'depth',
    'parent',
    'terminalBarrier',
  ] as const;

  private static readonly ROOT_PARENT_FIELDS = ['kind'] as const;

  private static readonly ATTEMPT_PARENT_FIELDS = [
    'kind',
    'task',
    'agent',
    'attempt',
  ] as const;

  private static readonly BARRIER_FIELDS = ['policy', 'attempts'] as const;

  private static readonly PLAN_EVENT_FIELDS = [
    'kind',
    'runId',
    'sourceCommit',
    'planSha256',
    'sequence',
    'occurredAt',
    'attemptCount',
    'rootMaterializer',
  ] as const;

  private static readonly ADMISSION_EVENT_FIELDS = [
    'kind',
    'runId',
    'sourceCommit',
    'planSha256',
    'sequence',
    'occurredAt',
    'declaration',
  ] as const;

  private static readonly ADMISSION_REQUEST_FIELDS = [
    'runId',
    'sourceCommit',
    'identity',
    'depth',
    'parent',
  ] as const;

  static decodeDelegationPlan(serialized: string): DelegationPlan {
    const transport = UntrustedYamlBoundary.parseJson(serialized);
    const reader = new RecordReader(
      DelegationJournalSchema.requireRecord(transport),
    );
    DelegationJournalSchema.assertExactKeys(reader.record)(
      DelegationJournalSchema.PLAN_FIELDS,
    );
    if (reader.string('schemaVersion') !== DELEGATION_PLAN_SCHEMA_VERSION)
      throw new Error('Delegation plan schema version is unsupported.');
    if (reader.string('workflow') !== DelegatedAgentWorkflowName.AgentWork)
      throw new Error('Delegation plan workflow is unsupported.');
    const plan: DelegationPlan = {
      schemaVersion: DELEGATION_PLAN_SCHEMA_VERSION,
      workflow: DelegatedAgentWorkflowName.AgentWork,
      runId: reader.string('runId'),
      sourceCommit: reader.string('sourceCommit'),
      rootMaterializer: DelegationJournalSchema.decodeIdentity(
        reader.node('rootMaterializer'),
      ),
      attempts: reader
        .array('attempts')
        .map(DelegationJournalSchema.decodeAttemptDeclaration),
    };
    DelegationPlanContract.validateDelegationPlan(plan);
    return plan;
  }

  static decodeDelegationAdmissionRequest(
    serialized: string,
  ): DelegationAdmissionRequest {
    const transport = UntrustedYamlBoundary.parseJson(serialized);
    const reader = new RecordReader(
      DelegationJournalSchema.requireRecord(transport),
    );
    DelegationJournalSchema.assertExactKeys(reader.record)(
      DelegationJournalSchema.ADMISSION_REQUEST_FIELDS,
    );
    return {
      runId: reader.string('runId'),
      sourceCommit: reader.string('sourceCommit'),
      identity: DelegationJournalSchema.decodeIdentity(reader.node('identity')),
      depth: reader.number('depth'),
      parent: DelegationJournalSchema.decodeParent(reader.node('parent')),
    };
  }

  static decodeDelegationRunEvent(serialized: string): DelegationRunEvent {
    const transport = UntrustedYamlBoundary.parseJson(serialized);
    const reader = new RecordReader(
      DelegationJournalSchema.requireRecord(transport),
    );
    const metadata = DelegationJournalSchema.decodeRunEventMetadata(reader);
    const kind = reader.string('kind');
    if (kind === DelegationRunEventKind.PlanDeclared) {
      DelegationJournalSchema.assertExactKeys(reader.record)(
        DelegationJournalSchema.PLAN_EVENT_FIELDS,
      );
      return {
        ...metadata,
        kind: DelegationRunEventKind.PlanDeclared,
        attemptCount: reader.number('attemptCount'),
        rootMaterializer: DelegationJournalSchema.decodeIdentity(
          reader.node('rootMaterializer'),
        ),
      };
    }
    if (kind === DelegationRunEventKind.AttemptAdmitted) {
      DelegationJournalSchema.assertExactKeys(reader.record)(
        DelegationJournalSchema.ADMISSION_EVENT_FIELDS,
      );
      return {
        ...metadata,
        kind: DelegationRunEventKind.AttemptAdmitted,
        declaration: DelegationJournalSchema.decodeAttemptDeclaration(
          reader.node('declaration'),
        ),
      };
    }
    throw new Error('Delegation run event kind is unsupported.');
  }

  private static decodeRunEventMetadata(
    reader: RecordReader,
  ): DelegationRunEventMetadata {
    return {
      runId: reader.string('runId'),
      sourceCommit: reader.string('sourceCommit'),
      planSha256: reader.string('planSha256'),
      sequence: reader.number('sequence'),
      occurredAt: reader.string('occurredAt'),
    };
  }

  private static decodeAttemptDeclaration(
    node: UntrustedYamlNode,
  ): DelegationAttemptDeclaration {
    const reader = new RecordReader(
      DelegationJournalSchema.requireRecord(node),
    );
    DelegationJournalSchema.assertExactKeys(reader.record)(
      DelegationJournalSchema.DECLARATION_FIELDS,
    );
    return {
      identity: DelegationJournalSchema.decodeIdentity(reader.node('identity')),
      depth: reader.number('depth'),
      parent: DelegationJournalSchema.decodeParent(reader.node('parent')),
      terminalBarrier: DelegationJournalSchema.decodeTerminalBarrier(
        reader.node('terminalBarrier'),
      ),
    };
  }

  private static decodeIdentity(
    node: UntrustedYamlNode,
  ): DelegationAttemptIdentity {
    const reader = new RecordReader(
      DelegationJournalSchema.requireRecord(node),
    );
    DelegationJournalSchema.assertExactKeys(reader.record)(
      DelegationJournalSchema.IDENTITY_FIELDS,
    );
    return DelegationJournalSchema.identityFromReader(reader);
  }

  private static identityFromReader(
    reader: RecordReader,
  ): DelegationAttemptIdentity {
    return {
      task: reader.string('task'),
      agent: reader.string('agent'),
      attempt: reader.number('attempt'),
    };
  }

  private static decodeParent(node: UntrustedYamlNode): AgentAttemptParent {
    const reader = new RecordReader(
      DelegationJournalSchema.requireRecord(node),
    );
    const kind = reader.string('kind');
    if (kind === AgentAttemptParentKind.WorkflowRoot) {
      DelegationJournalSchema.assertExactKeys(reader.record)(
        DelegationJournalSchema.ROOT_PARENT_FIELDS,
      );
      const parent: WorkflowRootParent = {
        kind: AgentAttemptParentKind.WorkflowRoot,
      };
      return parent;
    }
    if (kind === AgentAttemptParentKind.AgentAttempt) {
      DelegationJournalSchema.assertExactKeys(reader.record)(
        DelegationJournalSchema.ATTEMPT_PARENT_FIELDS,
      );
      const identity = DelegationJournalSchema.identityFromReader(reader);
      const parent: ParentAgentAttempt = {
        kind: AgentAttemptParentKind.AgentAttempt,
        ...identity,
      };
      return parent;
    }
    throw new Error('Delegation attempt parent kind is unsupported.');
  }

  private static decodeTerminalBarrier(
    node: UntrustedYamlNode,
  ): DelegationTerminalBarrier {
    const reader = new RecordReader(
      DelegationJournalSchema.requireRecord(node),
    );
    DelegationJournalSchema.assertExactKeys(reader.record)(
      DelegationJournalSchema.BARRIER_FIELDS,
    );
    if (reader.string('policy') !== DelegationBarrierPolicy.AllTerminal)
      throw new Error(
        'Delegation terminal barrier must use all-terminal policy.',
      );
    return {
      policy: DelegationBarrierPolicy.AllTerminal,
      attempts: reader
        .array('attempts')
        .map(DelegationJournalSchema.decodeIdentity),
    };
  }

  private static requireRecord(node: UntrustedYamlNode): UntrustedYamlMap {
    if (!UntrustedYamlBoundary.isRecord(node))
      throw new Error('Delegation structured value must be an object.');
    return node;
  }

  private static assertExactKeys(
    record: UntrustedYamlMap,
  ): (expected: readonly string[]) => void {
    return (expected) => {
      const actual = new Set(Object.keys(record));
      if (
        actual.size !== expected.length ||
        expected.some((key) => !actual.has(key))
      )
        throw new Error('Delegation structured value has unsupported fields.');
    };
  }
}

class RecordReader {
  readonly record: UntrustedYamlMap;
  constructor(record: UntrustedYamlMap) {
    this.record = record;
  }
  node(key: string): UntrustedYamlNode {
    const propertyInput: UntrustedYamlPropertyArgs = {
      record: this.record,
      key,
    };
    const property = UntrustedYamlBoundary.property(propertyInput);
    if (property.presence === UntrustedYamlPropertyPresence.Absent)
      throw new Error(`Delegation field is required: ${key}`);
    return property.value;
  }
  string(key: string): string {
    const value = this.node(key);
    if (typeof value !== 'string')
      throw new Error(`Delegation field must be a string: ${key}`);
    return value;
  }
  number(key: string): number {
    const value = this.node(key);
    if (typeof value !== 'number')
      throw new Error(`Delegation field must be a number: ${key}`);
    return value;
  }
  array(key: string): readonly UntrustedYamlNode[] {
    const value = this.node(key);
    if (!UntrustedYamlBoundary.isList(value))
      throw new Error(`Delegation field must be an array: ${key}`);
    return value;
  }
}
