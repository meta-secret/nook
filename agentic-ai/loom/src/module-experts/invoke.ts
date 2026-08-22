import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AgentReasoningEffort,
  AgentWorkspacePolicy,
  WorkflowExecutorKind,
  WorkflowResultKind,
} from '../agent-workflow/domain.ts';
import type {
  AgentProfile,
  AgentTaskExecution,
  WorkflowTaskOutput,
} from '../agent-workflow/domain.ts';
import type { RuntimeActivityObservation } from '../agent-workflow/events.ts';
import type {
  AgentExecutionInvocation,
  AgentTaskRuntime,
} from '../agent-workflow/runtime.ts';
import {
  UntrustedYamlPropertyPresence,
  isRecord,
  untrustedYamlProperty,
} from '../lib/guards.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';
import { auditModuleExperts } from './audit.ts';
import type { AuditModuleExpertsArgs } from './audit.ts';
import {
  MODULE_EXPERT_AGENT_INSTRUCTIONS,
  MODULE_EXPERT_CATALOG,
} from './catalog.ts';
import type { ModuleExpertProfile } from './catalog.ts';

const MAX_REQUEST_BYTES = 65_536;
const MAX_INSTRUCTION_LENGTH = 16_384;
const MAX_ACTIVITY_COUNT = 256;
const MAX_AGENT_DEFINITION_BYTES = 65_536;

export type ModuleExpertInvocationRequest = {
  readonly expert: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly instruction: string;
};

export type ModuleExpertInvocationResult = {
  readonly expert: string;
  readonly agentDefinitionPath: string;
  readonly agentDefinitionSha256: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly threadId: string;
  readonly activities: readonly RuntimeActivityObservation[];
  readonly output: WorkflowTaskOutput;
};

export type InvokeModuleExpertArgs = {
  readonly repoRoot: string;
  readonly request: ModuleExpertInvocationRequest;
  readonly runtime: AgentTaskRuntime<string, string>;
  readonly signal: AbortSignal;
};

type ModuleExpertRequestProperty = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
};

type ModuleExpertPromptContext = {
  readonly profile: ModuleExpertProfile;
  readonly instruction: string;
};

export function decodeModuleExpertInvocationRequest(
  serialized: string,
): ModuleExpertInvocationRequest {
  if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST_BYTES) {
    invalidRequest();
  }
  let node: UntrustedYamlNode;
  try {
    node = JSON.parse(serialized) as UntrustedYamlNode;
  } catch {
    invalidRequest();
  }
  if (!isRecord(node)) {
    invalidRequest();
  }
  const expectedKeys = ['expert', 'instruction', 'sourceCommit', 'task'];
  const actualKeys = Object.keys(node).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    invalidRequest();
  }
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
  const expert = requiredString(expertProperty);
  const sourceCommit = requiredString(sourceCommitProperty);
  const task = requiredString(taskProperty);
  const instruction = requiredString(instructionProperty);
  if (
    !safeIdentifier(expert) ||
    !/^[0-9a-f]{40}$/u.test(sourceCommit) ||
    !safeIdentifier(task) ||
    instruction.trim() === '' ||
    instruction.length > MAX_INSTRUCTION_LENGTH ||
    containsForbiddenControl(instruction)
  ) {
    invalidRequest();
  }
  return { expert, sourceCommit, task, instruction };
}

export async function invokeModuleExpert(
  args: InvokeModuleExpertArgs,
): Promise<ModuleExpertInvocationResult> {
  const profile = MODULE_EXPERT_CATALOG.find(
    (candidate) => candidate.name === args.request.expert,
  );
  if (!profile) {
    throw new Error('Requested module expert is not registered.');
  }
  const auditArgs: AuditModuleExpertsArgs = { repoRoot: args.repoRoot };
  const audit = auditModuleExperts(auditArgs);
  if (!audit.auditOk) {
    throw new Error('Module expert catalog validation failed.');
  }
  const definitionPath = join(args.repoRoot, profile.agentDefinitionPath);
  const definition = readFileSync(definitionPath, 'utf8');
  if (Buffer.byteLength(definition, 'utf8') > MAX_AGENT_DEFINITION_BYTES) {
    throw new Error('Module expert agent definition exceeds its size bound.');
  }
  const activities: RuntimeActivityObservation[] = [];
  const agentProfile: AgentProfile<string> = {
    name: profile.name,
    instructionPrefix: MODULE_EXPERT_AGENT_INSTRUCTIONS,
    workspacePolicy: AgentWorkspacePolicy.ReadOnly,
    reasoningEffort: AgentReasoningEffort.High,
  };
  const promptContext: ModuleExpertPromptContext = {
    profile,
    instruction: args.request.instruction,
  };
  const execution: AgentTaskExecution<string> = {
    kind: WorkflowExecutorKind.Agent,
    agent: profile.name,
    instruction: moduleExpertInstruction(promptContext),
    resultKind: WorkflowResultKind.CortexEvidence,
  };
  const invocation: AgentExecutionInvocation<string, string> = {
    task: args.request.task,
    attempt: 1,
    sourceCommit: args.request.sourceCommit,
    runId: `module-expert-${args.request.task}`,
    workingDirectory: args.repoRoot,
    upstreamOutputs: [],
    signal: args.signal,
    observe: async (observation: RuntimeActivityObservation) => {
      if (activities.length >= MAX_ACTIVITY_COUNT) {
        throw new Error('Module expert runtime activity limit exceeded.');
      }
      activities[activities.length] = observation;
    },
    execution,
    agentProfile,
  };
  const completion = await args.runtime.executeAgent(invocation);
  return {
    expert: profile.name,
    agentDefinitionPath: profile.agentDefinitionPath,
    agentDefinitionSha256: sha256(definition),
    sourceCommit: args.request.sourceCommit,
    task: args.request.task,
    threadId: completion.threadId,
    activities,
    output: completion.output,
  };
}

function moduleExpertInstruction(context: ModuleExpertPromptContext): string {
  const profile = context.profile;
  return [
    `Assigned module expert: ${profile.name}`,
    `Description: ${profile.description}`,
    `Module roots: ${JSON.stringify(profile.moduleRoots)}`,
    `Additional scope: ${JSON.stringify(profile.scopePaths)}`,
    `Generated scope: ${JSON.stringify(profile.generatedScopePaths.map((scope) => scope.path))}`,
    `Excluded paths: ${JSON.stringify(profile.excludedPaths)}`,
    `Public entry points: ${JSON.stringify(profile.publicEntryPoints)}`,
    `Authority paths: ${JSON.stringify(profile.authorityPaths)}`,
    `Skill paths: ${JSON.stringify(profile.skillPaths)}`,
    `Focused validation selectors: ${JSON.stringify(profile.validationSelectors)}`,
    `Requested analysis:\n${context.instruction}`,
  ].join('\n\n');
}

function requiredString(property: ModuleExpertRequestProperty): string {
  const propertyArgs: UntrustedYamlPropertyArgs = {
    record: property.record,
    key: property.key,
  };
  const value = untrustedYamlProperty(propertyArgs);
  if (
    value.presence === UntrustedYamlPropertyPresence.Absent ||
    typeof value.value !== 'string'
  ) {
    invalidRequest();
  }
  return value.value;
}

function safeIdentifier(value: string): boolean {
  return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}

function containsForbiddenControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
    );
  });
}

function invalidRequest(): never {
  throw new Error('Module expert invocation request is invalid.');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
