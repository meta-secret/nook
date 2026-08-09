import {
  AGENT_STATS_ASSEMBLE_INPUT_SCHEMA,
  AGENT_STATS_FILE_INPUT_SCHEMA,
} from '../codec/args/agent-stats.ts';
import { CORTEX_AUDIT_INPUT_SCHEMA } from '../codec/args/cortex-audit.ts';
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
import type { ObjectJsonSchema } from '../codec/json-schema.ts';
import { listRequestFamilies, type LoomRequest } from '../codec/request.ts';
import {
  runAgentStatsAssemble,
  runAgentStatsPublish,
  runAgentStatsValidate,
} from '../commands/agent-stats.ts';
import { runCortexAudit } from '../commands/cortex-audit.ts';
import { runDependencyPopularity } from '../commands/dependency-popularity.ts';
import {
  runPrLandMergeCheck,
  runPrLandReady,
  runPrLandStatus,
  runPrLandValidate,
} from '../commands/pr-land.ts';
import { runPrePush } from '../commands/pre-push.ts';
import { runSkillScaffold } from '../commands/skill-scaffold.ts';
import { asUntrustedYamlNode, type UntrustedYamlNode } from '../lib/guards.ts';
import { LoomFailureCode, loomFailureDetail } from '../loom-failure.ts';

import type { LoomFailureDetailArgs } from '../loom-failure.ts';
export type DiscoverableRequest = {
  readonly family: RequestFamily;
  readonly operation?: AgentStatsOperation | PrLandOperation;
  readonly description: string;
  readonly exampleRequest: string;
  readonly inputSchema: ObjectJsonSchema;
};
const DISCOVERABLE: readonly DiscoverableRequest[] = [
  {
    family: RequestFamily.ToolsList,
    description: 'List Loom domain request kinds and schemas.',
    exampleRequest: 'agentic-ai/loom/params/tools-list/default.yaml',
    inputSchema: TOOLS_LIST_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.PrePush,
    description: 'Host-apply task format and enforce the UI demo contract.',
    exampleRequest: 'agentic-ai/loom/params/pre-push/default.yaml',
    inputSchema: PRE_PUSH_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.CortexAudit,
    description: 'Audit .cortex links and dynamic-skill index sync.',
    exampleRequest: 'agentic-ai/loom/params/cortex-audit/default.yaml',
    inputSchema: CORTEX_AUDIT_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.SkillScaffold,
    description:
      'Create a dynamic-skill card and optional executable wrappers.',
    exampleRequest:
      'agentic-ai/loom/params/skill-scaffold/request.example.yaml',
    inputSchema: SKILL_SCAFFOLD_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Assemble,
    description: 'Assemble AI-agent stats YAML for a PR.',
    exampleRequest: 'agentic-ai/loom/params/agent-stats/assemble.example.yaml',
    inputSchema: AGENT_STATS_ASSEMBLE_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Validate,
    description: 'Validate an AI-agent stats YAML file.',
    exampleRequest: 'agentic-ai/loom/params/agent-stats/validate.example.yaml',
    inputSchema: AGENT_STATS_FILE_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Publish,
    description: 'Publish an AI-agent stats YAML file to Workbench.',
    exampleRequest: 'agentic-ai/loom/params/agent-stats/publish.example.yaml',
    inputSchema: AGENT_STATS_FILE_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.Status,
    description: 'Show PR status via gh.',
    exampleRequest: 'agentic-ai/loom/params/pr-land/status.example.yaml',
    inputSchema: PR_LAND_PR_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.Validate,
    description: 'Run prePush then task pr:validate for a PR.',
    exampleRequest: 'agentic-ai/loom/params/pr-land/validate.example.yaml',
    inputSchema: PR_LAND_VALIDATE_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.Ready,
    description: 'Run task pr:ready for a PR.',
    exampleRequest: 'agentic-ai/loom/params/pr-land/ready.example.yaml',
    inputSchema: PR_LAND_PR_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.MergeCheck,
    description: 'Summarize merge readiness without merging.',
    exampleRequest: 'agentic-ai/loom/params/pr-land/merge-check.example.yaml',
    inputSchema: PR_LAND_PR_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.DependencyPopularity,
    description:
      'Reject low-popularity npm packages and crates.io crates against thresholds.',
    exampleRequest: 'agentic-ai/loom/params/dependency-popularity/default.yaml',
    inputSchema: DEPENDENCY_POPULARITY_INPUT_SCHEMA,
  },
];

export function listDiscoverableRequests(): readonly DiscoverableRequest[] {
  return DISCOVERABLE;
}

export function listAllRequestFamilies(): readonly RequestFamily[] {
  return listRequestFamilies();
}

export async function executeRequest(
  request: LoomRequest,
): Promise<UntrustedYamlNode> {
  switch (request.family) {
    case RequestFamily.PrePush:
      return asUntrustedYamlNode(
        (await runPrePush(request.prePush)) as UntrustedYamlNode,
      );
    case RequestFamily.CortexAudit:
      return asUntrustedYamlNode(
        (await runCortexAudit(request.cortexAudit)) as UntrustedYamlNode,
      );
    case RequestFamily.SkillScaffold:
      return asUntrustedYamlNode(
        (await runSkillScaffold(request.skillScaffold)) as UntrustedYamlNode,
      );
    case RequestFamily.AgentStats: {
      switch (request.operation) {
        case AgentStatsOperation.Assemble:
          return asUntrustedYamlNode(
            (await runAgentStatsAssemble(request.assemble)) as UntrustedYamlNode,
          );
        case AgentStatsOperation.Validate:
          return asUntrustedYamlNode(
            (await runAgentStatsValidate(request.validate)) as UntrustedYamlNode,
          );
        case AgentStatsOperation.Publish:
          return asUntrustedYamlNode(
            (await runAgentStatsPublish(request.publish)) as UntrustedYamlNode,
          );
      }
      break;
    }
    case RequestFamily.PrLand: {
      switch (request.operation) {
        case PrLandOperation.Status:
          return asUntrustedYamlNode(
            (await runPrLandStatus(request.status)) as UntrustedYamlNode,
          );
        case PrLandOperation.Validate:
          return asUntrustedYamlNode(
            (await runPrLandValidate(request.validate)) as UntrustedYamlNode,
          );
        case PrLandOperation.Ready:
          return asUntrustedYamlNode(
            (await runPrLandReady(request.ready)) as UntrustedYamlNode,
          );
        case PrLandOperation.MergeCheck:
          return asUntrustedYamlNode(
            (await runPrLandMergeCheck(request.mergeCheck)) as UntrustedYamlNode,
          );
      }
      break;
    }
    case RequestFamily.DependencyPopularity:
      return asUntrustedYamlNode(
        (await runDependencyPopularity(
          request.dependencyPopularity,
        )) as UntrustedYamlNode,
      );
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
