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
  loom-agent-workflow cortex-full-garbage-collection --baseline <40-char-sha>
  loom-agent-workflow cortex-full-garbage-collection --baseline <40-char-sha> --plan

The graph is compiled TypeScript. This command does not accept YAML, JSON, graph
fragments, arbitrary prompts, or generated nodes.
`;

type AgentWorkflowCommandLine = {
  readonly workflow: StaticAgentWorkflowName;
  readonly baseline: string;
  readonly planOnly: boolean;
};

type AgentWorkflowPlan = {
  readonly workflow: StaticAgentWorkflowName;
  readonly version: string;
  readonly entry: string;
  readonly tasks: readonly string[];
  readonly joins: readonly string[];
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
    const plan: AgentWorkflowPlan = {
      workflow: workflow.name,
      version: workflow.version,
      entry: workflow.entry,
      tasks: workflow.taskNames,
      joins: workflow.joinNames,
    };
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
    workingDirectory: process.cwd(),
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

function parseCommandLine(
  argv: readonly string[],
): AgentWorkflowCommandLine | false {
  if (argv.length !== 3 && argv.length !== 4) {
    return false;
  }
  const workflowToken = argv[0];
  if (!workflowToken || !isStaticAgentWorkflowName(workflowToken)) {
    return false;
  }
  const baselineFlagIndex = argv.indexOf('--baseline');
  const baseline = argv[baselineFlagIndex + 1];
  if (
    baselineFlagIndex !== 1 ||
    !baseline ||
    !/^[0-9a-f]{40}$/.test(baseline)
  ) {
    return false;
  }
  if (argv.length === 4 && argv[3] !== '--plan') {
    return false;
  }
  return {
    workflow: workflowToken,
    baseline,
    planOnly: argv.includes('--plan'),
  };
}

const exitCode = await main();
process.exit(exitCode);
