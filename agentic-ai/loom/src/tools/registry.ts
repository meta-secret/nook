import {
  AGENT_STATS_ASSEMBLE_INPUT_SCHEMA,
  AGENT_STATS_FILE_INPUT_SCHEMA,
} from '../codec/args/agent-stats.ts';
import { CORTEX_AUDIT_INPUT_SCHEMA } from '../codec/args/cortex-audit.ts';
import { PRE_PUSH_INPUT_SCHEMA } from '../codec/args/pre-push.ts';
import {
  PR_LAND_PR_INPUT_SCHEMA,
  PR_LAND_VALIDATE_INPUT_SCHEMA,
} from '../codec/args/pr-land.ts';
import { SKILL_SCAFFOLD_INPUT_SCHEMA } from '../codec/args/skill-scaffold.ts';
import { TOOLS_LIST_INPUT_SCHEMA } from '../codec/args/tools-list.ts';
import { RequestKind } from '../codec/enums.ts';
import { listRequestKinds, type LoomRequest } from '../codec/request.ts';
import {
  runAgentStatsAssemble,
  runAgentStatsPublish,
  runAgentStatsValidate,
} from '../commands/agent-stats.ts';
import { runCortexAudit } from '../commands/cortex-audit.ts';
import {
  runPrLandMergeCheck,
  runPrLandReady,
  runPrLandStatus,
  runPrLandValidate,
} from '../commands/pr-land.ts';
import { runPrePush } from '../commands/pre-push.ts';
import { runSkillScaffold } from '../commands/skill-scaffold.ts';
import { err, type Result } from '../result.ts';

export type JsonSchema = Readonly<Record<string, unknown>>;

export type DiscoverableRequest = {
  readonly requestKind: RequestKind;
  readonly description: string;
  readonly exampleRequest: string;
  readonly inputSchema: JsonSchema;
};

const DISCOVERABLE: readonly DiscoverableRequest[] = [
  {
    requestKind: RequestKind.ToolsList,
    description: 'List Loom domain request kinds and schemas.',
    exampleRequest: 'agentic-ai/loom/params/tools-list/default.yaml',
    inputSchema: TOOLS_LIST_INPUT_SCHEMA,
  },
  {
    requestKind: RequestKind.PrePush,
    description: 'Host-apply task format and enforce the UI demo contract.',
    exampleRequest: 'agentic-ai/loom/params/pre-push/default.yaml',
    inputSchema: PRE_PUSH_INPUT_SCHEMA,
  },
  {
    requestKind: RequestKind.CortexAudit,
    description: 'Audit .cortex links and dynamic-skill index sync.',
    exampleRequest: 'agentic-ai/loom/params/cortex-audit/default.yaml',
    inputSchema: CORTEX_AUDIT_INPUT_SCHEMA,
  },
  {
    requestKind: RequestKind.SkillScaffold,
    description:
      'Create a dynamic-skill card and optional executable wrappers.',
    exampleRequest:
      'agentic-ai/loom/params/skill-scaffold/request.example.yaml',
    inputSchema: SKILL_SCAFFOLD_INPUT_SCHEMA,
  },
  {
    requestKind: RequestKind.AgentStatsAssemble,
    description: 'Assemble AI-agent stats YAML for a PR.',
    exampleRequest: 'agentic-ai/loom/params/agent-stats/assemble.example.yaml',
    inputSchema: AGENT_STATS_ASSEMBLE_INPUT_SCHEMA,
  },
  {
    requestKind: RequestKind.AgentStatsValidate,
    description: 'Validate an AI-agent stats YAML file.',
    exampleRequest: 'agentic-ai/loom/params/agent-stats/validate.example.yaml',
    inputSchema: AGENT_STATS_FILE_INPUT_SCHEMA,
  },
  {
    requestKind: RequestKind.AgentStatsPublish,
    description: 'Publish an AI-agent stats YAML file to Workbench.',
    exampleRequest: 'agentic-ai/loom/params/agent-stats/publish.example.yaml',
    inputSchema: AGENT_STATS_FILE_INPUT_SCHEMA,
  },
  {
    requestKind: RequestKind.PrLandStatus,
    description: 'Show PR status via gh.',
    exampleRequest: 'agentic-ai/loom/params/pr-land/status.example.yaml',
    inputSchema: PR_LAND_PR_INPUT_SCHEMA,
  },
  {
    requestKind: RequestKind.PrLandValidate,
    description: 'Run prePush then task pr:validate for a PR.',
    exampleRequest: 'agentic-ai/loom/params/pr-land/validate.example.yaml',
    inputSchema: PR_LAND_VALIDATE_INPUT_SCHEMA,
  },
  {
    requestKind: RequestKind.PrLandReady,
    description: 'Run task pr:ready for a PR.',
    exampleRequest: 'agentic-ai/loom/params/pr-land/ready.example.yaml',
    inputSchema: PR_LAND_PR_INPUT_SCHEMA,
  },
  {
    requestKind: RequestKind.PrLandMergeCheck,
    description: 'Summarize merge readiness without merging.',
    exampleRequest: 'agentic-ai/loom/params/pr-land/merge-check.example.yaml',
    inputSchema: PR_LAND_PR_INPUT_SCHEMA,
  },
];

export function listDiscoverableRequests(): readonly DiscoverableRequest[] {
  return DISCOVERABLE;
}

export function listAllRequestKinds(): readonly RequestKind[] {
  return listRequestKinds();
}

export async function executeRequest(
  request: LoomRequest,
): Promise<Result<unknown>> {
  switch (request.kind) {
    case RequestKind.PrePush:
      return runPrePush(request.prePush);
    case RequestKind.CortexAudit:
      return runCortexAudit(request.cortexAudit);
    case RequestKind.SkillScaffold:
      return runSkillScaffold(request.skillScaffold);
    case RequestKind.AgentStatsAssemble:
      return runAgentStatsAssemble(request.agentStatsAssemble);
    case RequestKind.AgentStatsValidate:
      return runAgentStatsValidate(request.agentStatsValidate);
    case RequestKind.AgentStatsPublish:
      return runAgentStatsPublish(request.agentStatsPublish);
    case RequestKind.PrLandStatus:
      return runPrLandStatus(request.prLandStatus);
    case RequestKind.PrLandValidate:
      return runPrLandValidate(request.prLandValidate);
    case RequestKind.PrLandReady:
      return runPrLandReady(request.prLandReady);
    case RequestKind.PrLandMergeCheck:
      return runPrLandMergeCheck(request.prLandMergeCheck);
    case RequestKind.ToolsList:
    case RequestKind.ToolsCall:
      return err(`${request.kind} is handled by the dispatcher`);
  }
}
