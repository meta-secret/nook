import {
  AGENT_STATS_ASSEMBLE_INPUT_SCHEMA,
  AGENT_STATS_FILE_INPUT_SCHEMA,
} from '../codec/args/agent-stats.ts';
import { CORTEX_AUDIT_INPUT_SCHEMA } from '../codec/args/cortex-audit.ts';
import { CORTEX_SESSION_CLEAN_INPUT_SCHEMA } from '../codec/args/cortex-session-clean.ts';
import { DEPENDENCY_POPULARITY_INPUT_SCHEMA } from '../codec/args/dependency-popularity.ts';
import { PRE_PUSH_INPUT_SCHEMA } from '../codec/args/pre-push.ts';
import {
  PR_LAND_PR_INPUT_SCHEMA,
  PR_LAND_VALIDATE_INPUT_SCHEMA,
} from '../codec/args/pr-land.ts';
import { SKILL_SCAFFOLD_INPUT_SCHEMA } from '../codec/args/skill-scaffold.ts';
import { TOOLS_LIST_INPUT_SCHEMA } from '../codec/args/tools-list.ts';
import {
  AgentStatsOperation,
  PrLandOperation,
  RequestFamily,
} from '../codec/enums.ts';
import {
  ExampleCatalogPresence,
  ExampleOperationMarker,
  exampleDocumentYaml,
  findExampleCatalogEntry,
  type FindExampleCatalogEntryArgs,
} from '../codec/example-documents.ts';
import type { ObjectJsonSchema } from '../codec/json-schema.ts';
import { listRequestFamilies, type LoomRequest } from '../codec/request.ts';
import {
  runAgentStatsAssemble,
  runAgentStatsPublish,
  runAgentStatsValidate,
  type AgentStatsReport,
} from '../commands/agent-stats.ts';
import {
  runCortexAudit,
  type CortexAuditReport,
} from '../commands/cortex-audit.ts';
import {
  runCortexSessionClean,
  type CortexSessionCleanReport,
} from '../commands/cortex-session-clean.ts';
import {
  runDependencyPopularity,
  type DependencyPopularityReport,
} from '../commands/dependency-popularity.ts';
import {
  runPrLandMergeCheck,
  runPrLandReady,
  runPrLandStatus,
  runPrLandValidate,
  type PrLandReport,
} from '../commands/pr-land.ts';
import { runPrePush, type PrePushReport } from '../commands/pre-push.ts';
import {
  runSkillScaffold,
  type SkillScaffoldReport,
} from '../commands/skill-scaffold.ts';
import { LoomFailureCode, loomFailureDetail } from '../loom-failure.ts';
import {
  AGENT_TEMP_DIR_TOKEN,
  resolveAgentTempPath,
} from '../lib/agent-temp-path.ts';
import { findRepoRoot } from '../lib/repo.ts';

import type { LoomFailureDetailArgs } from '../loom-failure.ts';
import type { ResolveAgentTempPathRequest } from '../lib/agent-temp-path.ts';
export type DiscoverableRequest = {
  readonly family: RequestFamily;
  readonly operation?: AgentStatsOperation | PrLandOperation;
  readonly description: string;
  readonly exampleRequest: string;
  readonly exampleYaml: string;
  readonly resolvedExampleYaml: string;
  readonly inputSchema: ObjectJsonSchema;
};

export type LoomCommandResult =
  | PrePushReport
  | CortexAuditReport
  | CortexSessionCleanReport
  | SkillScaffoldReport
  | AgentStatsReport
  | PrLandReport
  | DependencyPopularityReport;
type DiscoverableRequestDefinition = Omit<
  DiscoverableRequest,
  'exampleYaml' | 'resolvedExampleYaml'
>;

const DISCOVERABLE_DEFINITIONS: readonly DiscoverableRequestDefinition[] = [
  {
    family: RequestFamily.ToolsList,
    description: 'List Loom domain request kinds and schemas.',
    exampleRequest: 'task loom:tools-list',
    inputSchema: TOOLS_LIST_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.PrePush,
    description: 'Host-apply task format and enforce the UI demo contract.',
    exampleRequest: 'task loom:pre-push',
    inputSchema: PRE_PUSH_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.CortexAudit,
    description: 'Audit .cortex links and dynamic-skill index sync.',
    exampleRequest: 'task loom:cortex-audit',
    inputSchema: CORTEX_AUDIT_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.CortexSessionClean,
    description: 'Assert that temporary Cortex session memory is absent.',
    exampleRequest: 'task loom:cortex-session-clean',
    inputSchema: CORTEX_SESSION_CLEAN_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.SkillScaffold,
    description:
      'Create a dynamic-skill card and optional executable wrappers.',
    exampleRequest: 'task loom:skill-scaffold CONFIG=<request.yaml>',
    inputSchema: SKILL_SCAFFOLD_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Assemble,
    description: 'Assemble AI-agent stats YAML for a PR.',
    exampleRequest: 'task loom:agent-stats CONFIG=<request.yaml>',
    inputSchema: AGENT_STATS_ASSEMBLE_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Validate,
    description: 'Validate an AI-agent stats YAML file.',
    exampleRequest: 'task loom:agent-stats CONFIG=<request.yaml>',
    inputSchema: AGENT_STATS_FILE_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Publish,
    description: 'Publish an AI-agent stats YAML file to Workbench.',
    exampleRequest: 'task loom:agent-stats CONFIG=<request.yaml>',
    inputSchema: AGENT_STATS_FILE_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.Status,
    description: 'Show PR status via gh.',
    exampleRequest: 'task loom:pr-land CONFIG=<request.yaml>',
    inputSchema: PR_LAND_PR_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.Validate,
    description: 'Run prePush then task pr:validate for a PR.',
    exampleRequest: 'task loom:pr-land CONFIG=<request.yaml>',
    inputSchema: PR_LAND_VALIDATE_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.Ready,
    description: 'Run task pr:ready for a PR.',
    exampleRequest: 'task loom:pr-land CONFIG=<request.yaml>',
    inputSchema: PR_LAND_PR_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.MergeCheck,
    description: 'Summarize merge readiness without merging.',
    exampleRequest: 'task loom:pr-land CONFIG=<request.yaml>',
    inputSchema: PR_LAND_PR_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.DependencyPopularity,
    description:
      'Reject low-popularity npm packages and crates.io crates against thresholds.',
    exampleRequest: 'task loom:dependency-popularity',
    inputSchema: DEPENDENCY_POPULARITY_INPUT_SCHEMA,
  },
];

export function listDiscoverableRequests(): readonly DiscoverableRequest[] {
  const repoRoot = findRepoRoot();
  const agentTempPathRequest: ResolveAgentTempPathRequest = {
    repoRoot,
    authoredPath: AGENT_TEMP_DIR_TOKEN,
  };
  const agentTempDirectory = resolveAgentTempPath(agentTempPathRequest);

  return DISCOVERABLE_DEFINITIONS.map((definition) => {
    const exampleYaml = exampleYamlForDefinition(definition);
    if (!exampleYaml.includes(AGENT_TEMP_DIR_TOKEN)) {
      return { ...definition, exampleYaml, resolvedExampleYaml: exampleYaml };
    }
    return {
      ...definition,
      exampleYaml,
      resolvedExampleYaml: exampleYaml.replaceAll(
        AGENT_TEMP_DIR_TOKEN,
        agentTempDirectory,
      ),
    };
  });
}

function exampleYamlForDefinition(
  definition: DiscoverableRequestDefinition,
): string {
  const operation = definition.operation;
  const findExampleCatalogEntryArgs: FindExampleCatalogEntryArgs =
    typeof operation === 'string'
      ? { family: definition.family, operation }
      : {
          family: definition.family,
          operation: ExampleOperationMarker.FamilyRoot,
        };
  const lookup = findExampleCatalogEntry(findExampleCatalogEntryArgs);
  if (lookup.presence === ExampleCatalogPresence.Present) {
    return exampleDocumentYaml(lookup.entry.document);
  }
  const loomFailureDetailArgs: LoomFailureDetailArgs = {
    code: LoomFailureCode.ValidationFailed,
    text: `missing example catalog entry for ${definition.family}`,
  };
  loomFailureDetail(loomFailureDetailArgs);
}

export function listAllRequestFamilies(): readonly RequestFamily[] {
  return listRequestFamilies();
}

export async function executeRequest(
  request: LoomRequest,
): Promise<LoomCommandResult> {
  switch (request.family) {
    case RequestFamily.PrePush:
      return runPrePush(request.prePush);
    case RequestFamily.CortexAudit:
      return runCortexAudit(request.cortexAudit);
    case RequestFamily.CortexSessionClean:
      return runCortexSessionClean(request.cortexSessionClean);
    case RequestFamily.SkillScaffold:
      return runSkillScaffold(request.skillScaffold);
    case RequestFamily.AgentStats: {
      switch (request.operation) {
        case AgentStatsOperation.Assemble:
          return runAgentStatsAssemble(request.assemble);
        case AgentStatsOperation.Validate:
          return runAgentStatsValidate(request.validate);
        case AgentStatsOperation.Publish:
          return runAgentStatsPublish(request.publish);
      }
      break;
    }
    case RequestFamily.PrLand: {
      switch (request.operation) {
        case PrLandOperation.Status:
          return runPrLandStatus(request.status);
        case PrLandOperation.Validate:
          return runPrLandValidate(request.validate);
        case PrLandOperation.Ready:
          return runPrLandReady(request.ready);
        case PrLandOperation.MergeCheck:
          return runPrLandMergeCheck(request.mergeCheck);
      }
      break;
    }
    case RequestFamily.DependencyPopularity:
      return runDependencyPopularity(request.dependencyPopularity);
    case RequestFamily.ToolsList:
    case RequestFamily.ToolsCall: {
      const loomFailureDetailArgs: LoomFailureDetailArgs = {
        code: LoomFailureCode.ValidationFailed,
        text: `${request.family} is handled by the dispatcher`,
      };
      loomFailureDetail(loomFailureDetailArgs);
    }
  }
}
