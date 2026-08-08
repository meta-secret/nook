import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isRecord } from '../lib/guards.ts';
import { findRepoRoot } from '../lib/repo.ts';
import {
  AgentStatsOperation,
  PrLandOperation,
  RequestFamily,
} from './enums.ts';
import { isExternalNull } from './external.ts';
import { stringifyYaml } from './yaml.ts';

export enum BlueprintOperationMarker {
  FamilyRoot = 'familyRoot',
}

export enum YamlValueKind {
  Object = 'object',
  Array = 'array',
  String = 'string',
  Number = 'number',
  Boolean = 'boolean',
  Nullish = 'nullish',
  Unknown = 'unknown',
}

export enum BlueprintChangeKind {
  Missing = 'missing',
  Extra = 'extra',
  TypeMismatch = 'typeMismatch',
  SyntaxInvalid = 'syntaxInvalid',
}

export type BlueprintChange =
  | {
      readonly kind: BlueprintChangeKind.Missing;
      readonly path: string;
      readonly expectedKind: YamlValueKind;
    }
  | {
      readonly kind: BlueprintChangeKind.Extra;
      readonly path: string;
      readonly receivedKind: YamlValueKind;
    }
  | {
      readonly kind: BlueprintChangeKind.TypeMismatch;
      readonly path: string;
      readonly expectedKind: YamlValueKind;
      readonly receivedKind: YamlValueKind;
    }
  | {
      readonly kind: BlueprintChangeKind.SyntaxInvalid;
      readonly parseMessage: string;
    };

export type BlueprintExplanation = {
  readonly blueprintPath: string;
  readonly blueprintYaml: string;
  readonly receivedYaml: string;
  readonly changes: readonly BlueprintChange[];
};

type BlueprintRef = {
  readonly blueprintPath: string;
  readonly family: RequestFamily;
  readonly operation:
    | AgentStatsOperation
    | PrLandOperation
    | BlueprintOperationMarker.FamilyRoot;
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
];

export function yamlValueKind(value: unknown): YamlValueKind {
  if (isExternalNull(value)) {
    return YamlValueKind.Nullish;
  }
  if (Array.isArray(value)) {
    return YamlValueKind.Array;
  }
  if (isRecord(value)) {
    return YamlValueKind.Object;
  }
  if (typeof value === 'string') {
    return YamlValueKind.String;
  }
  if (typeof value === 'number') {
    return YamlValueKind.Number;
  }
  if (typeof value === 'boolean') {
    return YamlValueKind.Boolean;
  }
  return YamlValueKind.Unknown;
}

export function explainSyntaxFailure(
  receivedYaml: string,
  parseMessage: string,
): BlueprintExplanation {
  const blueprint = loadBlueprint(DEFAULT_BLUEPRINT.blueprintPath);
  return {
    blueprintPath: blueprint.blueprintPath,
    blueprintYaml: blueprint.blueprintYaml,
    receivedYaml,
    changes: [
      {
        kind: BlueprintChangeKind.SyntaxInvalid,
        parseMessage,
      },
    ],
  };
}

export function explainAgainstBlueprint(
  received: unknown,
): BlueprintExplanation {
  const selected = selectBlueprint(received);
  const blueprint = loadBlueprint(selected.blueprintPath);
  return {
    blueprintPath: blueprint.blueprintPath,
    blueprintYaml: blueprint.blueprintYaml,
    receivedYaml: stringifyYaml(received),
    changes: diffValues(blueprint.blueprintValue, received, ''),
  };
}

function selectBlueprint(received: unknown): BlueprintRef {
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
  const payload = received[family];
  if (
    (family === RequestFamily.AgentStats || family === RequestFamily.PrLand) &&
    isRecord(payload)
  ) {
    const operationKeys = Object.keys(payload);
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

function loadBlueprint(blueprintPath: string): {
  readonly blueprintPath: string;
  readonly blueprintYaml: string;
  readonly blueprintValue: unknown;
} {
  const root = findRepoRoot();
  const absolute = path.join(root, blueprintPath);
  const blueprintYaml = readFileSync(absolute, 'utf8');
  return {
    blueprintPath,
    blueprintYaml,
    blueprintValue: Bun.YAML.parse(blueprintYaml),
  };
}

function diffValues(
  blueprint: unknown,
  received: unknown,
  path: string,
): BlueprintChange[] {
  const expectedKind = yamlValueKind(blueprint);
  const receivedKind = yamlValueKind(received);

  if (receivedKind === YamlValueKind.Nullish && path.length > 0) {
    return [
      {
        kind: BlueprintChangeKind.Missing,
        path,
        expectedKind,
      },
    ];
  }

  if (expectedKind !== receivedKind) {
    return [
      {
        kind: BlueprintChangeKind.TypeMismatch,
        path,
        expectedKind,
        receivedKind,
      },
    ];
  }

  if (!isRecord(blueprint) || !isRecord(received)) {
    return [];
  }

  const changes: BlueprintChange[] = [];
  for (const key of Object.keys(blueprint)) {
    const childPath = path.length === 0 ? key : `${path}.${key}`;
    if (!(key in received)) {
      changes.push({
        kind: BlueprintChangeKind.Missing,
        path: childPath,
        expectedKind: yamlValueKind(blueprint[key]),
      });
      continue;
    }
    changes.push(...diffValues(blueprint[key], received[key], childPath));
  }
  for (const key of Object.keys(received)) {
    if (key in blueprint) {
      continue;
    }
    const childPath = path.length === 0 ? key : `${path}.${key}`;
    changes.push({
      kind: BlueprintChangeKind.Extra,
      path: childPath,
      receivedKind: yamlValueKind(received[key]),
    });
  }
  return changes;
}
