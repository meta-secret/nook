#!/usr/bin/env bun
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  STATIC_AGENT_WORKFLOW_CATALOG,
  isStaticAgentWorkflowName,
} from './catalog.ts';
import { CodexSdkAgentRuntime } from './codex-runtime.ts';
import type {
  CortexAuditAgent,
  CortexAuditJoin,
  CortexAuditTask,
} from './cortex-workflow.ts';
import { CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW } from './cortex-workflow.ts';
import { StaticAgentWorkflowName } from './domain.ts';
import type { WorkflowRunTerminal } from './domain.ts';
import { WorkflowJournal } from './journal.ts';
import type { WorkflowJournalConfiguration } from './journal.ts';
import { LocalWorkflowTaskRuntime } from './leaf-runtime.ts';
import { runStaticWorkflow } from './scheduler.ts';
import type { StaticWorkflowRunConfiguration } from './scheduler.ts';
import {
  validateStaticAgentWorkflow,
  WorkflowValidationStatus,
} from './validation.ts';

const HELP = `Loom static agent workflows

Usage:
  loom-agent-workflow cortex-full-garbage-collection --baseline <40-char-sha> --working-directory <repo-root>
  loom-agent-workflow cortex-full-garbage-collection --baseline <40-char-sha> --working-directory <repo-root> --plan

The graph is compiled TypeScript. This command does not accept YAML, JSON, graph
fragments, arbitrary prompts, or generated nodes.
`;

export type AgentWorkflowCommandLine = {
  readonly workflow: StaticAgentWorkflowName;
  readonly baseline: string;
  readonly workingDirectory: string;
  readonly planOnly: boolean;
};

type AgentWorkflowPlanTask =
  (typeof CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks)[CortexAuditTask];
type AgentWorkflowPlanAgent =
  (typeof CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.agents)[CortexAuditAgent];
type AgentWorkflowPlanJoin =
  (typeof CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.joins)[CortexAuditJoin];

type AgentWorkflowTaskTransition = {
  readonly source: CortexAuditTask;
  readonly outcome: 'completed' | 'failed';
  readonly target: AgentWorkflowPlanTask['completed'];
};

type AgentWorkflowJoinTransition = {
  readonly source: CortexAuditJoin;
  readonly target: AgentWorkflowPlanJoin['completed'];
};

type AgentWorkflowConnectivity = {
  readonly validationStatus: WorkflowValidationStatus.Valid;
  readonly taskTransitions: readonly AgentWorkflowTaskTransition[];
  readonly joinTransitions: readonly AgentWorkflowJoinTransition[];
};

export type AgentWorkflowPlan = {
  readonly workflow: StaticAgentWorkflowName;
  readonly version: string;
  readonly entry: string;
  readonly agents: readonly AgentWorkflowPlanAgent[];
  readonly tasks: readonly AgentWorkflowPlanTask[];
  readonly joins: readonly AgentWorkflowPlanJoin[];
  readonly connectivity: AgentWorkflowConnectivity;
};

async function main(): Promise<number> {
  const commandLine = parseCommandLine(process.argv.slice(2));
  if (!commandLine) {
    console.error(HELP);
    return 2;
  }
  const workflow = STATIC_AGENT_WORKFLOW_CATALOG[commandLine.workflow];
  const validation = validateStaticAgentWorkflow(workflow);
  if (validation.status === WorkflowValidationStatus.Invalid) {
    console.error(JSON.stringify(validation));
    return 2;
  }
  if (commandLine.planOnly) {
    const plan = buildAgentWorkflowPlan(workflow);
    console.log(JSON.stringify(plan));
    return 0;
  }

  const runId = randomUUID();
  const now = (): string => new Date().toISOString();
  const journalConfiguration: WorkflowJournalConfiguration = {
    runRoot: resolve(tmpdir(), 'nook-loom-runs'),
    identity: {
      runId,
      workflow: workflow.name,
      workflowVersion: workflow.version,
      sourceCommit: commandLine.baseline,
    },
    now,
  };
  const journal = new WorkflowJournal<CortexAuditTask>(journalConfiguration);
  const agentRuntime = new CodexSdkAgentRuntime<
    CortexAuditTask,
    CortexAuditAgent
  >();
  const runtime = new LocalWorkflowTaskRuntime(agentRuntime);
  const abortController = new AbortController();
  const abortWorkflow = (): void => abortController.abort();
  process.on('SIGINT', abortWorkflow);
  process.on('SIGTERM', abortWorkflow);
  const runConfiguration: StaticWorkflowRunConfiguration<
    CortexAuditTask,
    CortexAuditAgent,
    CortexAuditJoin
  > = {
    workflow,
    runtime,
    journal,
    runId,
    sourceCommit: commandLine.baseline,
    workingDirectory: commandLine.workingDirectory,
    maxConcurrency: 4,
    signal: abortController.signal,
    now,
  };
  let terminal: WorkflowRunTerminal<CortexAuditTask>;
  try {
    terminal = await runStaticWorkflow(runConfiguration);
  } finally {
    process.off('SIGINT', abortWorkflow);
    process.off('SIGTERM', abortWorkflow);
  }
  console.log(JSON.stringify(terminal));
  return terminal.kind === 'completed' ? 0 : 1;
}

export function parseCommandLine(
  argv: readonly string[],
): AgentWorkflowCommandLine | false {
  if (argv.length !== 5 && argv.length !== 6) {
    return false;
  }
  const workflowToken = argv[0];
  if (!workflowToken || !isStaticAgentWorkflowName(workflowToken)) {
    return false;
  }
  const baselineFlagIndex = argv.indexOf('--baseline');
  const baseline = argv[baselineFlagIndex + 1];
  const workingDirectoryFlagIndex = argv.indexOf('--working-directory');
  const workingDirectory = argv[workingDirectoryFlagIndex + 1];
  if (
    baselineFlagIndex !== 1 ||
    !baseline ||
    !/^[0-9a-f]{40}$/.test(baseline) ||
    workingDirectoryFlagIndex !== 3 ||
    !workingDirectory
  ) {
    return false;
  }
  if (argv.length === 6 && argv[5] !== '--plan') {
    return false;
  }
  return {
    workflow: workflowToken,
    baseline,
    workingDirectory: resolve(workingDirectory),
    planOnly: argv.includes('--plan'),
  };
}

export function buildAgentWorkflowPlan(
  workflow: typeof CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
): AgentWorkflowPlan {
  const validation = validateStaticAgentWorkflow(workflow);
  if (validation.status === WorkflowValidationStatus.Invalid) {
    throw new Error('Cannot render an invalid static agent workflow plan.');
  }
  const taskTransitions: AgentWorkflowTaskTransition[] = [];
  for (const taskName of workflow.taskNames) {
    const task = workflow.tasks[taskName];
    const completedTransition: AgentWorkflowTaskTransition = {
      source: taskName,
      outcome: 'completed',
      target: task.completed,
    };
    const failedTransition: AgentWorkflowTaskTransition = {
      source: taskName,
      outcome: 'failed',
      target: task.failed,
    };
    taskTransitions.push(completedTransition, failedTransition);
  }
  const joinTransitions: AgentWorkflowJoinTransition[] = [];
  for (const joinName of workflow.joinNames) {
    const join = workflow.joins[joinName];
    const transition: AgentWorkflowJoinTransition = {
      source: joinName,
      target: join.completed,
    };
    joinTransitions.push(transition);
  }
  return {
    workflow: workflow.name,
    version: workflow.version,
    entry: workflow.entry,
    agents: workflow.agentNames.map((name) => workflow.agents[name]),
    tasks: workflow.taskNames.map((name) => workflow.tasks[name]),
    joins: workflow.joinNames.map((name) => workflow.joins[name]),
    connectivity: {
      validationStatus: validation.status,
      taskTransitions,
      joinTransitions,
    },
  };
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
