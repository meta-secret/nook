import {
  AGENT_STATS_INPUT_SCHEMA,
  decodeAgentStatsArgs,
} from '../codec/args/agent-stats.ts';
import {
  CORTEX_AUDIT_INPUT_SCHEMA,
  decodeCortexAuditArgs,
} from '../codec/args/cortex-audit.ts';
import {
  PRE_PUSH_INPUT_SCHEMA,
  decodePrePushArgs,
} from '../codec/args/pre-push.ts';
import {
  PR_LAND_INPUT_SCHEMA,
  decodePrLandArgs,
} from '../codec/args/pr-land.ts';
import {
  SKILL_SCAFFOLD_INPUT_SCHEMA,
  decodeSkillScaffoldArgs,
} from '../codec/args/skill-scaffold.ts';
import {
  TOOLS_CALL_INPUT_SCHEMA,
  decodeToolsCallArgs,
} from '../codec/args/tools-call.ts';
import {
  TOOLS_LIST_INPUT_SCHEMA,
  decodeToolsListArgs,
} from '../codec/args/tools-list.ts';
import { ToolName } from '../codec/enums.ts';
import type { DecodeResult } from '../codec/field-error.ts';
import { runAgentStats } from '../commands/agent-stats.ts';
import { runCortexAudit } from '../commands/cortex-audit.ts';
import { runPrLand } from '../commands/pr-land.ts';
import { runPrePush } from '../commands/pre-push.ts';
import { runSkillScaffold } from '../commands/skill-scaffold.ts';
import {
  absent,
  err,
  ok,
  present,
  type Maybe,
  type Result,
} from '../result.ts';

export type JsonSchema = Readonly<Record<string, unknown>>;

export type ToolDefinition = {
  readonly name: ToolName;
  readonly description: string;
  readonly exampleRequest: string;
  readonly inputSchema: JsonSchema;
  readonly decodeArgs: (value: unknown) => DecodeResult<unknown>;
  readonly run: (args: unknown) => Promise<Result<unknown>>;
};

function wrapDecode<T>(
  decode: (value: unknown) => DecodeResult<T>,
): (value: unknown) => DecodeResult<unknown> {
  return (value) => decode(value);
}

const TOOLS: readonly ToolDefinition[] = [
  {
    name: ToolName.ToolsList,
    description: 'List Loom tools with schemas and example request paths.',
    exampleRequest: 'agentic-ai/loom/params/tools-list/default.yaml',
    inputSchema: TOOLS_LIST_INPUT_SCHEMA,
    decodeArgs: wrapDecode(decodeToolsListArgs),
    run: async () => ok({ tools: listDiscoverableTools() }),
  },
  {
    name: ToolName.ToolsCall,
    description: 'Nested tools/call helper with name plus arguments.',
    exampleRequest: 'agentic-ai/loom/params/tools-call/request.example.yaml',
    inputSchema: TOOLS_CALL_INPUT_SCHEMA,
    decodeArgs: wrapDecode(decodeToolsCallArgs),
    run: async () => err('tools-call is handled by the dispatcher'),
  },
  {
    name: ToolName.PrePush,
    description: 'Host-apply task format and enforce the UI demo contract.',
    exampleRequest: 'agentic-ai/loom/params/pre-push/default.yaml',
    inputSchema: PRE_PUSH_INPUT_SCHEMA,
    decodeArgs: wrapDecode(decodePrePushArgs),
    run: async (args) => runPrePush(args as Parameters<typeof runPrePush>[0]),
  },
  {
    name: ToolName.CortexAudit,
    description: 'Audit .cortex links and dynamic-skill index sync.',
    exampleRequest: 'agentic-ai/loom/params/cortex-audit/default.yaml',
    inputSchema: CORTEX_AUDIT_INPUT_SCHEMA,
    decodeArgs: wrapDecode(decodeCortexAuditArgs),
    run: async (args) =>
      runCortexAudit(args as Parameters<typeof runCortexAudit>[0]),
  },
  {
    name: ToolName.SkillScaffold,
    description:
      'Create a dynamic-skill card and optional executable wrappers.',
    exampleRequest:
      'agentic-ai/loom/params/skill-scaffold/request.example.yaml',
    inputSchema: SKILL_SCAFFOLD_INPUT_SCHEMA,
    decodeArgs: wrapDecode(decodeSkillScaffoldArgs),
    run: async (args) =>
      runSkillScaffold(args as Parameters<typeof runSkillScaffold>[0]),
  },
  {
    name: ToolName.AgentStats,
    description: 'Assemble, validate, or publish AI-agent stats YAML.',
    exampleRequest: 'agentic-ai/loom/params/agent-stats/assemble.example.yaml',
    inputSchema: AGENT_STATS_INPUT_SCHEMA,
    decodeArgs: wrapDecode(decodeAgentStatsArgs),
    run: async (args) =>
      runAgentStats(args as Parameters<typeof runAgentStats>[0]),
  },
  {
    name: ToolName.PrLand,
    description: 'PR status, validate, ready, and merge-check helpers.',
    exampleRequest: 'agentic-ai/loom/params/pr-land/request.example.yaml',
    inputSchema: PR_LAND_INPUT_SCHEMA,
    decodeArgs: wrapDecode(decodePrLandArgs),
    run: async (args) => runPrLand(args as Parameters<typeof runPrLand>[0]),
  },
];

export function getTool(name: string): Maybe<ToolDefinition> {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (tool) {
    return present(tool);
  }
  return absent();
}

export function listDiscoverableTools(): readonly {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  exampleRequest: string;
}[] {
  return TOOLS.filter((tool) => tool.name !== ToolName.ToolsCall).map(
    (tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      exampleRequest: tool.exampleRequest,
    }),
  );
}

export function listAllToolNames(): readonly string[] {
  return TOOLS.map((tool) => tool.name);
}
