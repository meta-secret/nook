import { AgentAttemptParentKind } from '../agent-workflow/domain.ts';
import type { AgentAttemptParent } from '../agent-workflow/domain.ts';
import { MAX_AGENT_HIERARCHY_DEPTH } from '../agent-workflow/hierarchy.ts';
import {
  UntrustedYamlPropertyPresence,
  UntrustedYamlBoundary,
} from '../lib/guards.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';
import { ModuleExpertContextAdmission } from './context-selection.ts';
import type { ModuleExpertContextSelection } from './context-selection.ts';
import type { ModuleExpertTaskContextPath } from './catalog.ts';

/** Owns the module expert request decoder registry and its capability transitions. */
export class ModuleExpertRequestDecoder {
  private constructor() {}
  private static readonly MAX_REQUEST_BYTES = 65_536;

  private static readonly MAX_INSTRUCTION_LENGTH = 16_384;

  static decodeModuleExpertInvocationRequest(
    serialized: string,
  ): ValidatedModuleExpertInvocationRequest {
    if (
      Buffer.byteLength(serialized, 'utf8') >
      ModuleExpertRequestDecoder.MAX_REQUEST_BYTES
    ) {
      ModuleExpertRequestDecoder.invalidRequest();
    }
    let node: UntrustedYamlNode;
    try {
      node = UntrustedYamlBoundary.fromHost(JSON.parse(serialized));
    } catch {
      ModuleExpertRequestDecoder.invalidRequest();
    }
    if (!UntrustedYamlBoundary.isRecord(node))
      ModuleExpertRequestDecoder.invalidRequest();
    const requiredKeys = [
      'attempt',
      'depth',
      'expert',
      'instruction',
      'parent',
      'runId',
      'sourceCommit',
      'task',
    ];
    const actualKeys = Object.keys(node).sort();
    const allowedKeys = [...requiredKeys, 'selectedContextPaths'];
    if (
      requiredKeys.some((key) => !actualKeys.includes(key)) ||
      actualKeys.some((key) => !allowedKeys.includes(key))
    ) {
      ModuleExpertRequestDecoder.invalidRequest();
    }
    const runIdProperty: ModuleExpertRequestProperty = {
      record: node,
      key: 'runId',
    };
    const expertProperty: ModuleExpertRequestProperty = {
      record: node,
      key: 'expert',
    };
    const sourceCommitProperty: ModuleExpertRequestProperty = {
      record: node,
      key: 'sourceCommit',
    };
    const taskProperty: ModuleExpertRequestProperty = {
      record: node,
      key: 'task',
    };
    const instructionProperty: ModuleExpertRequestProperty = {
      record: node,
      key: 'instruction',
    };
    const attemptProperty: ModuleExpertRequestProperty = {
      record: node,
      key: 'attempt',
    };
    const depthProperty: ModuleExpertRequestProperty = {
      record: node,
      key: 'depth',
    };
    const parentProperty: ModuleExpertRequestProperty = {
      record: node,
      key: 'parent',
    };
    const selectedContextPathsProperty: ModuleExpertRequestProperty = {
      record: node,
      key: 'selectedContextPaths',
    };
    const runId = ModuleExpertRequestDecoder.requiredString(runIdProperty);
    const expert = ModuleExpertRequestDecoder.requiredString(expertProperty);
    const sourceCommit =
      ModuleExpertRequestDecoder.requiredString(sourceCommitProperty);
    const task = ModuleExpertRequestDecoder.requiredString(taskProperty);
    const instruction =
      ModuleExpertRequestDecoder.requiredString(instructionProperty);
    const attempt = ModuleExpertRequestDecoder.requiredNumber(attemptProperty);
    const depth = ModuleExpertRequestDecoder.requiredNumber(depthProperty);
    const parent = ModuleExpertRequestDecoder.requiredParent(parentProperty);
    const selectedContextPathSelection =
      ModuleExpertRequestDecoder.optionalStringList(
        selectedContextPathsProperty,
      );
    const selectedContextPathValues =
      selectedContextPathSelection.presence ===
      OptionalStringListPresence.Absent
        ? []
        : selectedContextPathSelection.value;
    const contextSelection: ModuleExpertContextSelection = {
      expertName: expert,
      selectedContextPaths: selectedContextPathValues,
    };
    let selectedContextPaths: readonly ModuleExpertTaskContextPath[];
    try {
      selectedContextPaths =
        ModuleExpertContextAdmission.validate(contextSelection);
    } catch {
      ModuleExpertRequestDecoder.invalidRequest();
    }
    const lineageValidation: ParentLineageValidation = {
      task,
      expert,
      attempt,
      depth,
      parent,
    };
    if (
      !ModuleExpertRequestDecoder.safeIdentifier(runId) ||
      !ModuleExpertRequestDecoder.safeIdentifier(expert) ||
      !/^[0-9a-f]{40}$/u.test(sourceCommit) ||
      !ModuleExpertRequestDecoder.safeIdentifier(task) ||
      !ModuleExpertRequestDecoder.validParentLineage(lineageValidation) ||
      instruction.trim() === '' ||
      instruction.length > ModuleExpertRequestDecoder.MAX_INSTRUCTION_LENGTH ||
      ModuleExpertRequestDecoder.containsForbiddenControl(instruction)
    ) {
      ModuleExpertRequestDecoder.invalidRequest();
    }
    return {
      runId,
      expert,
      sourceCommit,
      task,
      attempt,
      depth,
      parent,
      instruction,
      selectedContextPaths,
    };
  }

  static validatedModuleExpertInvocationRequest(
    request: ModuleExpertInvocationRequest,
  ): ValidatedModuleExpertInvocationRequest {
    let serialized: string;
    try {
      const encoded = JSON.stringify(request);
      if (typeof encoded !== 'string')
        ModuleExpertRequestDecoder.invalidRequest();
      serialized = encoded;
    } catch {
      ModuleExpertRequestDecoder.invalidRequest();
    }
    return ModuleExpertRequestDecoder.decodeModuleExpertInvocationRequest(
      serialized,
    );
  }

  private static requiredString(property: ModuleExpertRequestProperty): string {
    const propertyArgs: UntrustedYamlPropertyArgs = {
      record: property.record,
      key: property.key,
    };
    const value = UntrustedYamlBoundary.property(propertyArgs);
    if (
      value.presence === UntrustedYamlPropertyPresence.Absent ||
      typeof value.value !== 'string'
    ) {
      ModuleExpertRequestDecoder.invalidRequest();
    }
    return value.value;
  }

  private static requiredNumber(property: ModuleExpertRequestProperty): number {
    const propertyArgs: UntrustedYamlPropertyArgs = {
      record: property.record,
      key: property.key,
    };
    const value = UntrustedYamlBoundary.property(propertyArgs);
    if (
      value.presence === UntrustedYamlPropertyPresence.Absent ||
      typeof value.value !== 'number'
    ) {
      ModuleExpertRequestDecoder.invalidRequest();
    }
    return value.value;
  }

  private static optionalStringList(
    property: ModuleExpertRequestProperty,
  ): OptionalStringList {
    const propertyArgs: UntrustedYamlPropertyArgs = {
      record: property.record,
      key: property.key,
    };
    const value = UntrustedYamlBoundary.property(propertyArgs);
    if (
      value.presence !== UntrustedYamlPropertyPresence.Absent &&
      (!UntrustedYamlBoundary.isList(value.value) ||
        value.value.some((entry) => typeof entry !== 'string'))
    ) {
      ModuleExpertRequestDecoder.invalidRequest();
    }
    if (value.presence === UntrustedYamlPropertyPresence.Absent) {
      return { presence: OptionalStringListPresence.Absent };
    }
    if (!UntrustedYamlBoundary.isList(value.value))
      ModuleExpertRequestDecoder.invalidRequest();
    return {
      presence: OptionalStringListPresence.Present,
      value: value.value.filter(
        (entry): entry is string => typeof entry === 'string',
      ),
    };
  }

  private static requiredParent(
    property: ModuleExpertRequestProperty,
  ): AgentAttemptParent {
    const propertyArgs: UntrustedYamlPropertyArgs = {
      record: property.record,
      key: property.key,
    };
    const value = UntrustedYamlBoundary.property(propertyArgs);
    if (
      value.presence === UntrustedYamlPropertyPresence.Absent ||
      !UntrustedYamlBoundary.isRecord(value.value)
    ) {
      ModuleExpertRequestDecoder.invalidRequest();
    }
    const kindProperty: ModuleExpertRequestProperty = {
      record: value.value,
      key: 'kind',
    };
    const kind = ModuleExpertRequestDecoder.requiredString(kindProperty);
    if (kind === AgentAttemptParentKind.WorkflowRoot) {
      if (Object.keys(value.value).length !== 1)
        ModuleExpertRequestDecoder.invalidRequest();
      return { kind: AgentAttemptParentKind.WorkflowRoot };
    }
    if (
      kind !== AgentAttemptParentKind.AgentAttempt ||
      JSON.stringify(Object.keys(value.value).sort()) !==
        JSON.stringify(['agent', 'attempt', 'kind', 'task'])
    ) {
      ModuleExpertRequestDecoder.invalidRequest();
    }
    const taskProperty: ModuleExpertRequestProperty = {
      record: value.value,
      key: 'task',
    };
    const agentProperty: ModuleExpertRequestProperty = {
      record: value.value,
      key: 'agent',
    };
    const attemptProperty: ModuleExpertRequestProperty = {
      record: value.value,
      key: 'attempt',
    };
    const task = ModuleExpertRequestDecoder.requiredString(taskProperty);
    const agent = ModuleExpertRequestDecoder.requiredString(agentProperty);
    const attempt = ModuleExpertRequestDecoder.requiredNumber(attemptProperty);
    if (
      !ModuleExpertRequestDecoder.safeIdentifier(task) ||
      !ModuleExpertRequestDecoder.safeIdentifier(agent) ||
      !Number.isSafeInteger(attempt) ||
      attempt < 1
    ) {
      ModuleExpertRequestDecoder.invalidRequest();
    }
    return { kind: AgentAttemptParentKind.AgentAttempt, task, agent, attempt };
  }

  private static validParentLineage(
    validation: ParentLineageValidation,
  ): boolean {
    if (validation.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
      return false;
    }
    return (
      Number.isSafeInteger(validation.attempt) &&
      validation.attempt >= 1 &&
      Number.isSafeInteger(validation.depth) &&
      validation.depth >= 2 &&
      validation.depth <= MAX_AGENT_HIERARCHY_DEPTH &&
      ModuleExpertRequestDecoder.safeIdentifier(validation.parent.task) &&
      ModuleExpertRequestDecoder.safeIdentifier(validation.parent.agent) &&
      Number.isSafeInteger(validation.parent.attempt) &&
      validation.parent.attempt >= 1 &&
      (validation.parent.task !== validation.task ||
        validation.parent.agent !== validation.expert ||
        validation.parent.attempt !== validation.attempt)
    );
  }

  private static safeIdentifier(value: string): boolean {
    return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
  }

  private static containsForbiddenControl(value: string): boolean {
    return Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
      );
    });
  }

  private static invalidRequest(): never {
    throw new Error('Module expert invocation request is invalid.');
  }
}

export type ModuleExpertInvocationRequest = {
  readonly runId: string;
  readonly expert: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly attempt: number;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly instruction: string;
  readonly selectedContextPaths?: readonly ModuleExpertTaskContextPath[];
};

export type ValidatedModuleExpertInvocationRequest = Omit<
  ModuleExpertInvocationRequest,
  'selectedContextPaths'
> & {
  readonly selectedContextPaths: readonly ModuleExpertTaskContextPath[];
};

type ModuleExpertRequestProperty = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
};

enum OptionalStringListPresence {
  Absent = 'absent',
  Present = 'present',
}

type OptionalStringList =
  | { readonly presence: OptionalStringListPresence.Absent }
  | {
      readonly presence: OptionalStringListPresence.Present;
      readonly value: readonly string[];
    };

type ParentLineageValidation = {
  readonly task: string;
  readonly expert: string;
  readonly attempt: number;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
};
