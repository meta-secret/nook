import type {
  AgentStatsAssembleRequest,
  AgentStatsFileRequest,
} from './args/agent-stats.ts';
import type { CortexAuditRequest } from './args/cortex-audit.ts';
import type { DependencyPopularityRequest } from './args/dependency-popularity.ts';
import type { PrePushRequest } from './args/pre-push.ts';
import type { PrLandPrRequest } from './args/pr-land.ts';
import type { SkillScaffoldRequest } from './args/skill-scaffold.ts';
import type { ToolsListRequest } from './args/tools-list.ts';
import { asUntrustedYamlNode, type UntrustedYamlNode } from '../lib/guards.ts';
import { AGENT_TEMP_DIR_TOKEN } from '../lib/agent-temp-path.ts';
import {
  AgentStatsOperation,
  PrLandOperation,
  RequestFamily,
} from './enums.ts';
import { stringifyYaml } from './yaml.ts';

export enum ExampleOperationMarker {
  FamilyRoot = 'familyRoot',
}

export enum ExampleDispatchKind {
  Defaultable = 'defaultable',
  Parameterized = 'parameterized',
}

export enum DefaultableExamplePresence {
  Present = 'present',
  Absent = 'absent',
}

export type ExampleOperation =
  AgentStatsOperation | PrLandOperation | ExampleOperationMarker.FamilyRoot;

export type PrePushExampleDocument = {
  readonly prePush: PrePushRequest;
};

export type ToolsListExampleDocument = {
  readonly toolsList: ToolsListRequest;
};

export type CortexAuditExampleDocument = {
  readonly cortexAudit: CortexAuditRequest;
};

export type SkillScaffoldExampleDocument = {
  readonly skillScaffold: SkillScaffoldRequest;
};

export type DependencyPopularityExampleDocument = {
  readonly dependencyPopularity: DependencyPopularityRequest;
};

export type AgentStatsAssembleExampleDocument = {
  readonly agentStats: {
    readonly assemble: AgentStatsAssembleRequest;
  };
};

export type AgentStatsValidateExampleDocument = {
  readonly agentStats: {
    readonly validate: AgentStatsFileRequest;
  };
};

export type AgentStatsPublishExampleDocument = {
  readonly agentStats: {
    readonly publish: AgentStatsFileRequest;
  };
};

export type PrLandStatusExampleDocument = {
  readonly prLand: {
    readonly status: PrLandPrRequest;
  };
};

export type PrLandReadyExampleDocument = {
  readonly prLand: {
    readonly ready: PrLandPrRequest;
  };
};

export type PrLandMergeCheckExampleDocument = {
  readonly prLand: {
    readonly mergeCheck: PrLandPrRequest;
  };
};

export type PrLandValidateExamplePayload = {
  readonly prNumber: number;
  readonly runFullE2e: boolean;
};

export type PrLandValidateExampleDocument = {
  readonly prLand: {
    readonly validate: PrLandValidateExamplePayload;
  };
};

export type ToolsCallExampleDocument = {
  readonly toolsCall: PrePushExampleDocument;
};

export type ExampleDocument =
  | PrePushExampleDocument
  | ToolsListExampleDocument
  | CortexAuditExampleDocument
  | SkillScaffoldExampleDocument
  | DependencyPopularityExampleDocument
  | AgentStatsAssembleExampleDocument
  | AgentStatsValidateExampleDocument
  | AgentStatsPublishExampleDocument
  | PrLandStatusExampleDocument
  | PrLandReadyExampleDocument
  | PrLandMergeCheckExampleDocument
  | PrLandValidateExampleDocument
  | ToolsCallExampleDocument;

export type ExampleCatalogEntry = {
  readonly family: RequestFamily;
  readonly operation: ExampleOperation;
  readonly document: ExampleDocument;
  readonly dispatch: ExampleDispatchKind;
};

export const PRE_PUSH_EXAMPLE: PrePushRequest = {
  stageHostUpdates: true,
  fetchOriginMain: true,
};

export const PRE_PUSH_EXAMPLE_DOCUMENT: PrePushExampleDocument = {
  prePush: PRE_PUSH_EXAMPLE,
};

const TOOLS_LIST_EXAMPLE: ToolsListRequest = {};

export const TOOLS_LIST_EXAMPLE_DOCUMENT: ToolsListExampleDocument = {
  toolsList: TOOLS_LIST_EXAMPLE,
};

export const CORTEX_AUDIT_EXAMPLE_DOCUMENT: CortexAuditExampleDocument = {
  cortexAudit: {
    includeDensityLint: false,
  },
};

export const SKILL_SCAFFOLD_EXAMPLE_DOCUMENT: SkillScaffoldExampleDocument = {
  skillScaffold: {
    skillSlug: 'example-skill',
    createExecutableWrappers: false,
  },
};

export const DEPENDENCY_POPULARITY_EXAMPLE_DOCUMENT: DependencyPopularityExampleDocument =
  {
    dependencyPopularity: {
      includeRepositoryManifests: true,
      minNpmWeeklyDownloads: 10000,
      minGitHubStars: 100,
      minCratesIoDownloads: 50000,
      minCratesIoRecentDownloads: 1000,
    },
  };

const AGENT_STATS_ASSEMBLE_EXAMPLE: AgentStatsAssembleRequest = {
  prNumber: 123,
  scratchPath: `${AGENT_TEMP_DIR_TOKEN}/pr-123-scratch.json`,
  outputPath: `${AGENT_TEMP_DIR_TOKEN}/123.yaml`,
  includeTestInventory: false,
};

export const AGENT_STATS_ASSEMBLE_EXAMPLE_DOCUMENT: AgentStatsAssembleExampleDocument =
  {
    agentStats: {
      assemble: AGENT_STATS_ASSEMBLE_EXAMPLE,
    },
  };

const AGENT_STATS_FILE_EXAMPLE: AgentStatsFileRequest = {
  statsFile: `${AGENT_TEMP_DIR_TOKEN}/123.yaml`,
};

export const AGENT_STATS_VALIDATE_EXAMPLE_DOCUMENT: AgentStatsValidateExampleDocument =
  {
    agentStats: {
      validate: AGENT_STATS_FILE_EXAMPLE,
    },
  };

export const AGENT_STATS_PUBLISH_EXAMPLE_DOCUMENT: AgentStatsPublishExampleDocument =
  {
    agentStats: {
      publish: AGENT_STATS_FILE_EXAMPLE,
    },
  };

const PR_LAND_PR_EXAMPLE: PrLandPrRequest = {
  prNumber: 123,
};

export const PR_LAND_STATUS_EXAMPLE_DOCUMENT: PrLandStatusExampleDocument = {
  prLand: {
    status: PR_LAND_PR_EXAMPLE,
  },
};

export const PR_LAND_READY_EXAMPLE_DOCUMENT: PrLandReadyExampleDocument = {
  prLand: {
    ready: PR_LAND_PR_EXAMPLE,
  },
};

export const PR_LAND_MERGE_CHECK_EXAMPLE_DOCUMENT: PrLandMergeCheckExampleDocument =
  {
    prLand: {
      mergeCheck: PR_LAND_PR_EXAMPLE,
    },
  };

export const PR_LAND_VALIDATE_EXAMPLE_DOCUMENT: PrLandValidateExampleDocument =
  {
    prLand: {
      validate: {
        prNumber: 948,
        runFullE2e: false,
      },
    },
  };

export const TOOLS_CALL_EXAMPLE_DOCUMENT: ToolsCallExampleDocument = {
  toolsCall: PRE_PUSH_EXAMPLE_DOCUMENT,
};

export const EXAMPLE_CATALOG: readonly ExampleCatalogEntry[] = [
  {
    family: RequestFamily.PrePush,
    operation: ExampleOperationMarker.FamilyRoot,
    document: PRE_PUSH_EXAMPLE_DOCUMENT,
    dispatch: ExampleDispatchKind.Defaultable,
  },
  {
    family: RequestFamily.ToolsList,
    operation: ExampleOperationMarker.FamilyRoot,
    document: TOOLS_LIST_EXAMPLE_DOCUMENT,
    dispatch: ExampleDispatchKind.Defaultable,
  },
  {
    family: RequestFamily.CortexAudit,
    operation: ExampleOperationMarker.FamilyRoot,
    document: CORTEX_AUDIT_EXAMPLE_DOCUMENT,
    dispatch: ExampleDispatchKind.Defaultable,
  },
  {
    family: RequestFamily.SkillScaffold,
    operation: ExampleOperationMarker.FamilyRoot,
    document: SKILL_SCAFFOLD_EXAMPLE_DOCUMENT,
    dispatch: ExampleDispatchKind.Parameterized,
  },
  {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Assemble,
    document: AGENT_STATS_ASSEMBLE_EXAMPLE_DOCUMENT,
    dispatch: ExampleDispatchKind.Parameterized,
  },
  {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Validate,
    document: AGENT_STATS_VALIDATE_EXAMPLE_DOCUMENT,
    dispatch: ExampleDispatchKind.Parameterized,
  },
  {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Publish,
    document: AGENT_STATS_PUBLISH_EXAMPLE_DOCUMENT,
    dispatch: ExampleDispatchKind.Parameterized,
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.Status,
    document: PR_LAND_STATUS_EXAMPLE_DOCUMENT,
    dispatch: ExampleDispatchKind.Parameterized,
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.Validate,
    document: PR_LAND_VALIDATE_EXAMPLE_DOCUMENT,
    dispatch: ExampleDispatchKind.Parameterized,
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.Ready,
    document: PR_LAND_READY_EXAMPLE_DOCUMENT,
    dispatch: ExampleDispatchKind.Parameterized,
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.MergeCheck,
    document: PR_LAND_MERGE_CHECK_EXAMPLE_DOCUMENT,
    dispatch: ExampleDispatchKind.Parameterized,
  },
  {
    family: RequestFamily.ToolsCall,
    operation: ExampleOperationMarker.FamilyRoot,
    document: TOOLS_CALL_EXAMPLE_DOCUMENT,
    dispatch: ExampleDispatchKind.Parameterized,
  },
  {
    family: RequestFamily.DependencyPopularity,
    operation: ExampleOperationMarker.FamilyRoot,
    document: DEPENDENCY_POPULARITY_EXAMPLE_DOCUMENT,
    dispatch: ExampleDispatchKind.Defaultable,
  },
];

export function exampleDocumentNode(
  document: ExampleDocument,
): UntrustedYamlNode {
  return asUntrustedYamlNode(document as UntrustedYamlNode);
}

export function exampleDocumentYaml(document: ExampleDocument): string {
  return stringifyYaml(exampleDocumentNode(document));
}

export function blueprintIdentity(entry: ExampleCatalogEntry): string {
  if (entry.operation === ExampleOperationMarker.FamilyRoot) {
    return entry.family;
  }
  return `${entry.family}.${entry.operation}`;
}

export type FindExampleCatalogEntryArgs = {
  readonly family: RequestFamily;
  readonly operation: ExampleOperation;
};

export enum ExampleCatalogPresence {
  Present = 'present',
  Absent = 'absent',
}

export type ExampleCatalogLookup =
  | {
      readonly presence: ExampleCatalogPresence.Present;
      readonly entry: ExampleCatalogEntry;
    }
  | { readonly presence: ExampleCatalogPresence.Absent };

export function findExampleCatalogEntry(
  args: FindExampleCatalogEntryArgs,
): ExampleCatalogLookup {
  for (const entry of EXAMPLE_CATALOG) {
    if (entry.family === args.family && entry.operation === args.operation) {
      return { presence: ExampleCatalogPresence.Present, entry };
    }
  }
  return { presence: ExampleCatalogPresence.Absent };
}

export function familyRootCatalogEntry(
  family: RequestFamily,
): ExampleCatalogLookup {
  const findExampleCatalogEntryArgs: FindExampleCatalogEntryArgs = {
    family,
    operation: ExampleOperationMarker.FamilyRoot,
  };
  return findExampleCatalogEntry(findExampleCatalogEntryArgs);
}

export type LookupDefaultableExampleArgs = {
  readonly family: string;
};

export type DefaultableExampleLookup =
  | {
      readonly presence: DefaultableExamplePresence.Present;
      readonly entry: ExampleCatalogEntry;
    }
  | { readonly presence: DefaultableExamplePresence.Absent };

export function lookupDefaultableExample(
  args: LookupDefaultableExampleArgs,
): DefaultableExampleLookup {
  for (const entry of EXAMPLE_CATALOG) {
    if (
      entry.family === args.family &&
      entry.operation === ExampleOperationMarker.FamilyRoot &&
      entry.dispatch === ExampleDispatchKind.Defaultable
    ) {
      return { presence: DefaultableExamplePresence.Present, entry };
    }
  }
  return { presence: DefaultableExamplePresence.Absent };
}

export const TOOLS_LIST_INVOKE = 'task loom:tools-list';
