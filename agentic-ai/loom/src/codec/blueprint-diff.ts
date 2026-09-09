import { createTwoFilesPatch } from 'diff';
import {
  UntrustedYamlPropertyPresence,
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from '../lib/guards.ts';
import {
  ExampleCatalogPresence,
  type ExampleCatalogEntry,
  type ExampleCatalogLookup,
  type FindExampleCatalogEntryArgs,
  LoomRequestExamples,
} from './example-documents.ts';
import { LoomFailureCode, LoomFailure } from '../loom-failure.ts';

import type { LoomFailureDetailArgs } from '../loom-failure.ts';
import {
  AgentStatsOperation,
  PrLandOperation,
  RequestFamily,
} from './enums.ts';
import { YamlDocument } from './yaml.ts';

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

/** Owns the request blueprint comparison registry and its capability transitions. */
export class RequestBlueprintComparison {
  private constructor() {}
  private static readonly DEFAULT_BLUEPRINT =
    RequestBlueprintComparison.fallbackCatalogEntry();

  private static fallbackCatalogEntry(): ExampleCatalogEntry {
    const lookup = LoomRequestExamples.familyRootCatalogEntry(
      RequestFamily.PrePush,
    );
    if (lookup.presence === ExampleCatalogPresence.Present) {
      return lookup.entry;
    }
    const loomFailureDetailArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.ValidationFailed,
      text: 'missing prePush example catalog entry',
    };
    LoomFailure.detail(loomFailureDetailArgs);
  }

  static loadExampleBlueprint(entry: ExampleCatalogEntry): LoadedBlueprint {
    return {
      blueprintPath: LoomRequestExamples.blueprintIdentity(entry),
      blueprintYaml: LoomRequestExamples.exampleDocumentYaml(entry.document),
    };
  }

  static explainSyntaxFailure(
    args: ExplainSyntaxFailureArgs,
  ): BlueprintExplanation {
    const { receivedYaml, parseMessage } = args;

    const blueprint = RequestBlueprintComparison.loadExampleBlueprint(
      RequestBlueprintComparison.DEFAULT_BLUEPRINT,
    );
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
      unifiedDiff:
        RequestBlueprintComparison.yamlUnifiedDiff(yamlUnifiedDiffArgs2),
      parseMessage,
    };
  }

  static explainAgainstBlueprint(
    received: UntrustedYamlNode,
  ): BlueprintExplanation {
    const selected = RequestBlueprintComparison.selectBlueprint(received);
    const blueprint = RequestBlueprintComparison.loadExampleBlueprint(selected);
    const receivedYaml = YamlDocument.stringify(received);
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
      unifiedDiff:
        RequestBlueprintComparison.yamlUnifiedDiff(yamlUnifiedDiffArgs),
    };
  }

  private static yamlUnifiedDiff(args: YamlUnifiedDiffArgs): string {
    const { blueprintPath, blueprintYaml, receivedYaml } = args;

    return createTwoFilesPatch(
      blueprintPath,
      'received.yaml',
      RequestBlueprintComparison.normalizeYamlText(blueprintYaml),
      RequestBlueprintComparison.normalizeYamlText(receivedYaml),
    );
  }

  private static normalizeYamlText(text: string): string {
    return text.endsWith('\n') ? text : `${text}\n`;
  }

  private static selectBlueprint(
    received: UntrustedYamlNode,
  ): ExampleCatalogEntry {
    if (!UntrustedYamlBoundary.isRecord(received)) {
      return RequestBlueprintComparison.DEFAULT_BLUEPRINT;
    }
    const roots = Object.keys(received);
    const familyKey = roots.find((key) =>
      Object.values(RequestFamily).includes(key as RequestFamily),
    );
    if (typeof familyKey !== 'string') {
      return RequestBlueprintComparison.DEFAULT_BLUEPRINT;
    }
    const family = familyKey as RequestFamily;
    const payloadPropertyArgs: UntrustedYamlPropertyArgs = {
      record: received,
      key: family,
    };
    const payloadProperty = UntrustedYamlBoundary.property(payloadPropertyArgs);
    if (
      (family === RequestFamily.AgentStats ||
        family === RequestFamily.PrLand) &&
      payloadProperty.presence === UntrustedYamlPropertyPresence.Present &&
      UntrustedYamlBoundary.isRecord(payloadProperty.value)
    ) {
      const nestedOperationEntryArgs: NestedOperationEntryArgs = {
        family,
        operationKeys: Object.keys(payloadProperty.value),
      };
      const nestedMatch = RequestBlueprintComparison.nestedOperationEntry(
        nestedOperationEntryArgs,
      );
      if (nestedMatch.presence === ExampleCatalogPresence.Present) {
        return nestedMatch.entry;
      }
    }
    const familyMatch = LoomRequestExamples.familyRootCatalogEntry(family);
    if (familyMatch.presence === ExampleCatalogPresence.Present) {
      return familyMatch.entry;
    }
    return RequestBlueprintComparison.DEFAULT_BLUEPRINT;
  }

  private static nestedOperationEntry(
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
      const match = LoomRequestExamples.findExampleCatalogEntry(
        findExampleCatalogEntryArgs,
      );
      if (match.presence === ExampleCatalogPresence.Present) {
        return match;
      }
    }
    return { presence: ExampleCatalogPresence.Absent };
  }
}

export type LoadedBlueprint = {
  readonly blueprintPath: string;
  readonly blueprintYaml: string;
};

export type ExplainSyntaxFailureArgs = {
  readonly receivedYaml: string;
  readonly parseMessage: string;
};

type YamlUnifiedDiffArgs = {
  readonly blueprintPath: string;
  readonly blueprintYaml: string;
  readonly receivedYaml: string;
};

type NestedOperationEntryArgs = {
  readonly family: RequestFamily.AgentStats | RequestFamily.PrLand;
  readonly operationKeys: readonly string[];
};
