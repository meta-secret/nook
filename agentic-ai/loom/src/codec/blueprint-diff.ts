import { createTwoFilesPatch } from 'diff';
import {
  UntrustedYamlPropertyPresence,
  untrustedYamlProperty,
  type UntrustedYamlNode,
  isRecord,
} from '../lib/guards.ts';
import {
  ExampleCatalogPresence,
  blueprintIdentity,
  exampleDocumentYaml,
  familyRootCatalogEntry,
  findExampleCatalogEntry,
  type ExampleCatalogEntry,
  type ExampleCatalogLookup,
  type FindExampleCatalogEntryArgs,
} from './example-documents.ts';
import { LoomFailureCode, loomFailureDetail } from '../loom-failure.ts';

import type { LoomFailureDetailArgs } from '../loom-failure.ts';
import {
  AgentStatsOperation,
  PrLandOperation,
  RequestFamily,
} from './enums.ts';
import { stringifyYaml } from './yaml.ts';

import type { UntrustedYamlPropertyArgs } from '../lib/guards.ts';

export { ExampleOperationMarker as BlueprintOperationMarker } from './example-documents.ts';

export enum BlueprintExplanationKind {
  Structural = 'structural',
  Syntax = 'syntax',
}

export type BlueprintExplanation =
  | {
      readonly kind: BlueprintExplanationKind.Structural;
      readonly blueprintPath: string;
      readonly blueprintYaml: string;
      readonly receivedYaml: string;
      readonly unifiedDiff: string;
    }
  | {
      readonly kind: BlueprintExplanationKind.Syntax;
      readonly blueprintPath: string;
      readonly blueprintYaml: string;
      readonly receivedYaml: string;
      readonly unifiedDiff: string;
      readonly parseMessage: string;
    };

function fallbackCatalogEntry(): ExampleCatalogEntry {
  const lookup = familyRootCatalogEntry(RequestFamily.PrePush);
  if (lookup.presence === ExampleCatalogPresence.Present) {
    return lookup.entry;
  }
  const loomFailureDetailArgs: LoomFailureDetailArgs = {
    code: LoomFailureCode.ValidationFailed,
    text: 'missing prePush example catalog entry',
  };
  loomFailureDetail(loomFailureDetailArgs);
}

const DEFAULT_BLUEPRINT = fallbackCatalogEntry();

export type LoadedBlueprint = {
  readonly blueprintPath: string;
  readonly blueprintYaml: string;
};

export function loadExampleBlueprint(
  entry: ExampleCatalogEntry,
): LoadedBlueprint {
  return {
    blueprintPath: blueprintIdentity(entry),
    blueprintYaml: exampleDocumentYaml(entry.document),
  };
}

export type ExplainSyntaxFailureArgs = {
  readonly receivedYaml: string;
  readonly parseMessage: string;
};

export function explainSyntaxFailure(
  args: ExplainSyntaxFailureArgs,
): BlueprintExplanation {
  const { receivedYaml, parseMessage } = args;

  const blueprint = loadExampleBlueprint(DEFAULT_BLUEPRINT);
  const yamlUnifiedDiffArgs2 = {
    blueprintPath: blueprint.blueprintPath,
    blueprintYaml: blueprint.blueprintYaml,
    receivedYaml,
  };
  return {
    kind: BlueprintExplanationKind.Syntax,
    blueprintPath: blueprint.blueprintPath,
    blueprintYaml: blueprint.blueprintYaml,
    receivedYaml,
    unifiedDiff: yamlUnifiedDiff(yamlUnifiedDiffArgs2),
    parseMessage,
  };
}

export function explainAgainstBlueprint(
  received: UntrustedYamlNode,
): BlueprintExplanation {
  const selected = selectBlueprint(received);
  const blueprint = loadExampleBlueprint(selected);
  const receivedYaml = stringifyYaml(received);
  const yamlUnifiedDiffArgs = {
    blueprintPath: blueprint.blueprintPath,
    blueprintYaml: blueprint.blueprintYaml,
    receivedYaml,
  };
  return {
    kind: BlueprintExplanationKind.Structural,
    blueprintPath: blueprint.blueprintPath,
    blueprintYaml: blueprint.blueprintYaml,
    receivedYaml,
    unifiedDiff: yamlUnifiedDiff(yamlUnifiedDiffArgs),
  };
}

type YamlUnifiedDiffArgs = {
  readonly blueprintPath: string;
  readonly blueprintYaml: string;
  readonly receivedYaml: string;
};

function yamlUnifiedDiff(args: YamlUnifiedDiffArgs): string {
  const { blueprintPath, blueprintYaml, receivedYaml } = args;

  return createTwoFilesPatch(
    blueprintPath,
    'received.yaml',
    normalizeYamlText(blueprintYaml),
    normalizeYamlText(receivedYaml),
  );
}

function normalizeYamlText(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function selectBlueprint(received: UntrustedYamlNode): ExampleCatalogEntry {
  if (!isRecord(received)) {
    return DEFAULT_BLUEPRINT;
  }
  const roots = Object.keys(received);
  const familyKey = roots.find((key) =>
    Object.values(RequestFamily).includes(key as RequestFamily),
  );
  if (typeof familyKey !== 'string') {
    return DEFAULT_BLUEPRINT;
  }
  const family = familyKey as RequestFamily;
  const payloadPropertyArgs: UntrustedYamlPropertyArgs = {
    record: received,
    key: family,
  };
  const payloadProperty = untrustedYamlProperty(payloadPropertyArgs);
  if (
    (family === RequestFamily.AgentStats || family === RequestFamily.PrLand) &&
    payloadProperty.presence === UntrustedYamlPropertyPresence.Present &&
    isRecord(payloadProperty.value)
  ) {
    const nestedOperationEntryArgs: NestedOperationEntryArgs = {
      family,
      operationKeys: Object.keys(payloadProperty.value),
    };
    const nestedMatch = nestedOperationEntry(nestedOperationEntryArgs);
    if (nestedMatch.presence === ExampleCatalogPresence.Present) {
      return nestedMatch.entry;
    }
  }
  const familyMatch = familyRootCatalogEntry(family);
  if (familyMatch.presence === ExampleCatalogPresence.Present) {
    return familyMatch.entry;
  }
  return DEFAULT_BLUEPRINT;
}

type NestedOperationEntryArgs = {
  readonly family: RequestFamily.AgentStats | RequestFamily.PrLand;
  readonly operationKeys: readonly string[];
};

function nestedOperationEntry(
  args: NestedOperationEntryArgs,
): ExampleCatalogLookup {
  const { family, operationKeys } = args;
  const operations =
    family === RequestFamily.AgentStats
      ? Object.values(AgentStatsOperation)
      : Object.values(PrLandOperation);
  for (const operation of operations) {
    if (!operationKeys.includes(operation)) {
      continue;
    }
    const findExampleCatalogEntryArgs: FindExampleCatalogEntryArgs = {
      family,
      operation,
    };
    const match = findExampleCatalogEntry(findExampleCatalogEntryArgs);
    if (match.presence === ExampleCatalogPresence.Present) {
      return match;
    }
  }
  return { presence: ExampleCatalogPresence.Absent };
}
