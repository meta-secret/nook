import {
  MaterializedViewAuthorKind,
  TaskTerminalKind,
  TaskProcessingKind,
  WorkflowResultKind,
} from './domain.ts';
import type {
  CompletedTaskTerminal,
  ProjectionReference,
  TaskProcessingReference,
  TaskTerminal,
  WorkflowTaskOutput,
} from './domain.ts';
import type { WorkflowJournal } from './journal.ts';

type NonCompletedTaskTerminal<TTask extends string> = Exclude<
  TaskTerminal<TTask>,
  CompletedTaskTerminal<TTask>
>;

export function terminalFailureOutput<TTask extends string>(
  terminal: NonCompletedTaskTerminal<TTask>,
): WorkflowTaskOutput {
  const materializedViewMarkdown = [
    '# Terminal task view',
    '',
    `Status: ${terminal.kind}`,
    '',
    terminal.summary,
    '',
    'This read model was produced by Loom because no completed agent-authored view was available.',
  ].join('\n');
  return {
    resultKind: WorkflowResultKind.LoomLeafEvidence,
    summary: terminal.summary,
    materializedViewMarkdown,
    findings: [],
    notesForParent: [
      `Treat task ${terminal.task} as ${terminal.kind} during aggregation.`,
    ],
    artifacts: [],
  };
}

export type WorkflowTaskProcessingInput<TTask extends string> = {
  readonly journal: WorkflowJournal<TTask>;
  readonly terminal: TaskTerminal<TTask>;
  readonly result: ProjectionReference;
};

export async function projectWorkflowTaskProcessing<TTask extends string>(
  input: WorkflowTaskProcessingInput<TTask>,
): Promise<TaskProcessingReference> {
  const markdown =
    input.terminal.kind === TaskTerminalKind.Completed
      ? input.terminal.output.materializedViewMarkdown
      : terminalFailureOutput(input.terminal).materializedViewMarkdown;
  const viewInput = {
    task: input.terminal.task,
    attempt: input.terminal.attempt,
    markdown,
    authorKind:
      input.terminal.kind === TaskTerminalKind.Completed
        ? MaterializedViewAuthorKind.LoomLeaf
        : MaterializedViewAuthorKind.LoomRuntime,
  } as const;
  const view = await input.journal.projectTaskView(viewInput);
  return { kind: TaskProcessingKind.WorkflowTask, result: input.result, view };
}
