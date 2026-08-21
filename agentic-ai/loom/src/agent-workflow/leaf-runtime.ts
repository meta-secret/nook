import { runCortexAuditFromDirectory } from '../commands/cortex-audit.ts';
import type { CortexAuditReport } from '../commands/cortex-audit.ts';
import type { RunCortexAuditFromDirectoryArgs } from '../commands/cortex-audit.ts';
import type { CortexAuditRequest } from '../codec/args/cortex-audit.ts';
import { runCommand } from '../lib/run.ts';
import type { RunCommandArgs } from '../lib/run.ts';
import {
  LoomLeafKind,
  TaskTerminalKind,
  WorkflowArtifactKind,
  WorkflowExecutorKind,
  WorkflowFindingSeverity,
  WorkflowResultKind,
} from './domain.ts';
import { TaskTeardownKind, UnconfirmedTaskTeardownError } from './runtime.ts';
import type {
  CompletedTaskTerminal,
  StaticTaskExecution,
  TaskTerminal,
  WorkflowFinding,
  WorkflowTaskOutput,
} from './domain.ts';
import type {
  AgentTaskRuntime,
  WorkflowTaskInvocation,
  WorkflowTaskAttempt,
  WorkflowTaskRuntime,
} from './runtime.ts';
import type { TaskStopRequest } from './runtime.ts';
import { MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH } from './structured-result-codec.ts';

export class LocalWorkflowTaskRuntime<
  TTask extends string,
  TAgent extends string,
> implements WorkflowTaskRuntime<TTask, TAgent> {
  readonly agentRuntime: AgentTaskRuntime<TTask, TAgent>;

  constructor(agentRuntime: AgentTaskRuntime<TTask, TAgent>) {
    this.agentRuntime = agentRuntime;
  }

  start(
    invocation: WorkflowTaskInvocation<TTask, TAgent>,
  ): WorkflowTaskAttempt<TTask> {
    const completion = this.execute(invocation);
    return {
      completion,
      stop: async (request: TaskStopRequest) => {
        let timeoutHandle: ReturnType<typeof setTimeout> | false = false;
        const deadline = new Promise<false>((resolve) => {
          timeoutHandle = setTimeout(
            () => resolve(false),
            request.hardDeadlineMs,
          );
        });
        const settled = await Promise.race([
          completion.then(
            () => true,
            () => true,
          ),
          deadline,
        ]);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (!settled) throw new UnconfirmedTaskTeardownError(invocation.task);
        return { kind: TaskTeardownKind.Confirmed };
      },
    };
  }

  private async execute(
    invocation: WorkflowTaskInvocation<TTask, TAgent>,
  ): Promise<TaskTerminal<TTask>> {
    if (
      invocation.execution.kind === WorkflowExecutorKind.Agent &&
      'agentProfile' in invocation
    ) {
      const agentInvocation = {
        ...invocation,
        execution: invocation.execution,
      };
      const completion = await this.agentRuntime.executeAgent(agentInvocation);
      const terminal: CompletedTaskTerminal<TTask> = {
        kind: TaskTerminalKind.Completed,
        task: invocation.task,
        attempt: invocation.attempt,
        threadId: completion.threadId,
        output: completion.output,
      };
      return terminal;
    }
    return executeLeaf(invocation);
  }
}

async function executeLeaf<TTask extends string, TAgent extends string>(
  invocation: WorkflowTaskInvocation<TTask, TAgent>,
): Promise<TaskTerminal<TTask>> {
  const execution: StaticTaskExecution<TAgent> = invocation.execution;
  if (execution.kind !== WorkflowExecutorKind.LoomLeaf) {
    throw new Error('Agent execution reached the Loom leaf adapter.');
  }
  if (execution.leaf === LoomLeafKind.VerifyGitBaseline) {
    const commandInput: RunCommandArgs = {
      command: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd: invocation.workingDirectory,
    };
    const commandOutput = runCommand(commandInput);
    const actualCommit = commandOutput.stdout.trim();
    if (
      commandOutput.exitCode !== 0 ||
      actualCommit !== invocation.sourceCommit
    ) {
      throw new Error(
        `Workflow baseline mismatch: expected ${invocation.sourceCommit}, received ${actualCommit}.`,
      );
    }
    const statusInput: RunCommandArgs = {
      command: 'git',
      args: ['status', '--porcelain', '--untracked-files=normal'],
      cwd: invocation.workingDirectory,
    };
    const statusOutput = runCommand(statusInput);
    if (statusOutput.exitCode !== 0 || statusOutput.stdout.trim().length > 0) {
      throw new Error('Workflow baseline must have a clean working tree.');
    }
    const baselineOutput = leafEvidenceOutput(
      `Verified source commit ${actualCommit}.`,
    );
    return completedLeafTerminal([invocation, baselineOutput]);
  }
  const cortexAuditInput: CortexAuditRequest = {
    includeDensityLint: execution.includeDensityLint,
  };
  const cortexAuditArgs: RunCortexAuditFromDirectoryArgs = {
    request: cortexAuditInput,
    startDirectory: invocation.workingDirectory,
  };
  const report = await runCortexAuditFromDirectory(cortexAuditArgs);
  const cortexAuditOutput = mechanicalCortexAuditOutput(report);
  return completedLeafTerminal([invocation, cortexAuditOutput]);
}

type LeafCompletionValues<
  TTask extends string,
  TAgent extends string,
> = readonly [WorkflowTaskInvocation<TTask, TAgent>, WorkflowTaskOutput];

function completedLeafTerminal<TTask extends string, TAgent extends string>(
  values: LeafCompletionValues<TTask, TAgent>,
): CompletedTaskTerminal<TTask> {
  const invocation = values[0];
  return {
    kind: TaskTerminalKind.Completed,
    task: invocation.task,
    attempt: invocation.attempt,
    threadId: 'loom-leaf',
    output: values[1],
  };
}

function leafEvidenceOutput(summary: string): WorkflowTaskOutput {
  const output: WorkflowTaskOutput = {
    resultKind: WorkflowResultKind.LoomLeafEvidence,
    summary,
    materializedViewMarkdown: `# Loom leaf evidence\n\n${summary}`,
    findings: [],
    notesForParent: [],
    artifacts: [
      {
        kind: WorkflowArtifactKind.Report,
        location: 'events.jsonl',
        description: 'Parent-owned workflow journal evidence.',
      },
    ],
  };
  return output;
}

export function mechanicalCortexAuditOutput(
  report: CortexAuditReport,
): WorkflowTaskOutput {
  const findings: WorkflowFinding[] = [];

  for (const brokenLink of report.brokenLinks) {
    const finding: WorkflowFinding = {
      severity: WorkflowFindingSeverity.Error,
      title: 'Broken Cortex link',
      summary: `${brokenLink.file}:${brokenLink.line} references a missing target.`,
      evidence: [
        `${brokenLink.file}:${brokenLink.line} -> ${brokenLink.target}`,
      ],
      affectedPaths: [brokenLink.file],
    };
    findings.push(finding);
  }
  for (const skill of report.missingFromIndex) {
    const finding: WorkflowFinding = {
      severity: WorkflowFindingSeverity.Error,
      title: 'Dynamic skill missing from index',
      summary: `${skill} is not registered in the dynamic-skill index.`,
      evidence: [`.cortex/dynamic-skills/index.md does not list ${skill}.`],
      affectedPaths: [
        '.cortex/dynamic-skills/index.md',
        `.cortex/dynamic-skills/${skill}`,
      ],
    };
    findings.push(finding);
  }
  for (const skill of report.orphanIndexRows) {
    const finding: WorkflowFinding = {
      severity: WorkflowFindingSeverity.Error,
      title: 'Orphan dynamic-skill index row',
      summary: `${skill} is indexed but its durable skill card is absent.`,
      evidence: [`.cortex/dynamic-skills/index.md references ${skill}.`],
      affectedPaths: ['.cortex/dynamic-skills/index.md'],
    };
    findings.push(finding);
  }
  for (const skill of report.missingExecutableSkills) {
    const executablePath = `.agents/skills/${skill}/SKILL.md`;
    const finding: WorkflowFinding = {
      severity: WorkflowFindingSeverity.Error,
      title: 'Missing executable dynamic-skill wrapper',
      summary: `${skill} has no executable skill wrapper.`,
      evidence: [`Expected executable wrapper at ${executablePath}.`],
      affectedPaths: ['.cortex/dynamic-skills/index.md', executablePath],
    };
    findings.push(finding);
  }
  for (const densityFinding of report.densityFindings) {
    const finding: WorkflowFinding = {
      severity: WorkflowFindingSeverity.Warning,
      title: 'Dense Cortex prose',
      summary: `${densityFinding.file}:${densityFinding.line} ${densityFinding.reason}.`,
      evidence: [
        `${densityFinding.file}:${densityFinding.line}: ${densityFinding.excerpt}`,
      ],
      affectedPaths: [densityFinding.file],
    };
    findings.push(finding);
  }
  for (const structureFinding of report.structureFindings) {
    const finding: WorkflowFinding = {
      severity: WorkflowFindingSeverity.Error,
      title: 'Invalid Cortex document navigation',
      summary: `${structureFinding.file}:${structureFinding.line} ${structureFinding.message}`,
      evidence: [
        `${structureFinding.code}: ${structureFinding.file}:${structureFinding.line}`,
      ],
      affectedPaths: [structureFinding.file],
    };
    findings.push(finding);
  }
  for (const articleFinding of report.articleStructureFindings) {
    const finding: WorkflowFinding = {
      severity: WorkflowFindingSeverity.Error,
      title: 'Invalid Cortex article structure',
      summary: `${articleFinding.file}:${articleFinding.line} ${articleFinding.message}`,
      evidence: [
        `${articleFinding.code}: ${articleFinding.file}:${articleFinding.line}`,
      ],
      affectedPaths: [articleFinding.file],
    };
    findings.push(finding);
  }

  const summary = report.auditOk
    ? 'Mechanical Cortex audit passed.'
    : `Mechanical Cortex audit found ${findings.length} inconsistencies.`;
  const output = leafEvidenceOutput(summary);
  const evidence = findings.flatMap((finding) =>
    finding.evidence.map((entry) => `- ${finding.title}: ${entry}`),
  );
  const completeMaterializedViewMarkdown = [
    '# Mechanical Cortex audit',
    '',
    summary,
    '',
    '## Evidence',
    '',
    ...(evidence.length > 0 ? evidence : ['- No actionable findings.']),
  ].join('\n');
  const materializedViewMarkdown = boundedLoomMaterializedView(
    completeMaterializedViewMarkdown,
  );
  return { ...output, materializedViewMarkdown, findings };
}

function boundedLoomMaterializedView(markdown: string): string {
  if (markdown.length <= MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH) {
    return markdown;
  }
  const truncationNotice = [
    '',
    '',
    '## Truncation',
    '',
    '- Additional mechanical evidence was omitted from this bounded read model. The typed findings remain available in the task result projection.',
  ].join('\n');
  const retainedLength =
    MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH - truncationNotice.length;
  return `${markdown.slice(0, retainedLength).trimEnd()}${truncationNotice}`;
}
