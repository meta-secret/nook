import { createTwoFilesPatch } from 'diff';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  UntrustedYamlPropertyPresence,
  untrustedYamlProperty,
  type UntrustedYamlNode,
  isRecord,
} from '../lib/guards.ts';
import { findRepoRoot } from '../lib/repo.ts';
import {
  AgentStatsOperation,
  PrLandOperation,
  RequestFamily,
} from './enums.ts';
import { stringifyYaml } from './yaml.ts';

import type { UntrustedYamlPropertyArgs } from '../lib/guards.ts';
export enum BlueprintOperationMarker {
  FamilyRoot = 'familyRoot',
}

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

type BlueprintRef = {
  readonly blueprintPath: string;
  readonly family: RequestFamily;
  readonly operation:
    AgentStatsOperation | PrLandOperation | BlueprintOperationMarker.FamilyRoot;
};

const DEFAULT_BLUEPRINT: BlueprintRef = {
  family: RequestFamily.PrePush,
  operation: BlueprintOperationMarker.FamilyRoot,
  blueprintPath: 'agentic-ai/loom/params/pre-push/default.yaml',
};

const BLUEPRINTS: readonly BlueprintRef[] = [
  DEFAULT_BLUEPRINT,
  {
    family: RequestFamily.ToolsList,
    operation: BlueprintOperationMarker.FamilyRoot,
    blueprintPath: 'agentic-ai/loom/params/tools-list/default.yaml',
  },
  {
    family: RequestFamily.CortexAudit,
    operation: BlueprintOperationMarker.FamilyRoot,
    blueprintPath: 'agentic-ai/loom/params/cortex-audit/default.yaml',
  },
  {
    family: RequestFamily.SkillScaffold,
    operation: BlueprintOperationMarker.FamilyRoot,
    blueprintPath: 'agentic-ai/loom/params/skill-scaffold/request.example.yaml',
  },
  {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Assemble,
    blueprintPath: 'agentic-ai/loom/params/agent-stats/assemble.example.yaml',
  },
  {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Validate,
    blueprintPath: 'agentic-ai/loom/params/agent-stats/validate.example.yaml',
  },
  {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Publish,
    blueprintPath: 'agentic-ai/loom/params/agent-stats/publish.example.yaml',
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.Status,
    blueprintPath: 'agentic-ai/loom/params/pr-land/status.example.yaml',
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.Validate,
    blueprintPath: 'agentic-ai/loom/params/pr-land/validate.example.yaml',
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.Ready,
    blueprintPath: 'agentic-ai/loom/params/pr-land/ready.example.yaml',
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.MergeCheck,
    blueprintPath: 'agentic-ai/loom/params/pr-land/merge-check.example.yaml',
  },
  {
    family: RequestFamily.ToolsCall,
    operation: BlueprintOperationMarker.FamilyRoot,
    blueprintPath: 'agentic-ai/loom/params/tools-call/request.example.yaml',
  },
  {
    family: RequestFamily.DependencyPopularity,
    operation: BlueprintOperationMarker.FamilyRoot,
    blueprintPath: 'agentic-ai/loom/params/dependency-popularity/default.yaml',
  },
];

export type ExplainSyntaxFailureArgs = {
  readonly receivedYaml: string;
  readonly parseMessage: string;
};

export function explainSyntaxFailure(
  args: ExplainSyntaxFailureArgs,
): BlueprintExplanation {
  const { receivedYaml, parseMessage } = args;

  const blueprint = loadBlueprint(DEFAULT_BLUEPRINT.blueprintPath);
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
  const blueprint = loadBlueprint(selected.blueprintPath);
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

function selectBlueprint(received: UntrustedYamlNode): BlueprintRef {
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
    const operationKeys = Object.keys(payloadProperty.value);
    const match = BLUEPRINTS.find(
      (entry) =>
        entry.family === family &&
        operationKeys.includes(String(entry.operation)),
    );
    if (match) {
      return match;
    }
  }
  const familyMatch = BLUEPRINTS.find((entry) => entry.family === family);
  if (familyMatch) {
    return familyMatch;
  }
  return DEFAULT_BLUEPRINT;
}

export type LoadedBlueprint = {
  readonly blueprintPath: string;
  readonly blueprintYaml: string;
};

export function loadBlueprint(blueprintPath: string): LoadedBlueprint {
  const root = findRepoRoot();
  const absolute = path.join(root, blueprintPath);
  return {
    blueprintPath,
    blueprintYaml: readFileSync(absolute, 'utf8'),
  };
}
