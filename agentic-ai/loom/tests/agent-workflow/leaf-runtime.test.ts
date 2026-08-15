import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { MakeDirectoryOptions, RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import type { CortexAuditReport } from '../../src/commands/cortex-audit.ts';
import {
  LoomLeafKind,
  TaskTerminalKind,
  WorkflowExecutorKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import type {
  AgentTaskRuntime,
  LoomLeafWorkflowTaskInvocation,
} from '../../src/agent-workflow/runtime.ts';
import {
  LocalWorkflowTaskRuntime,
  mechanicalCortexAuditOutput,
} from '../../src/agent-workflow/leaf-runtime.ts';

const REMOVE_TREE_OPTIONS: RmOptions = { recursive: true, force: true };
const CREATE_TREE_OPTIONS: MakeDirectoryOptions = { recursive: true };

class UnusedAgentRuntime implements AgentTaskRuntime<string, never> {
  executeAgent(): never {
    throw new Error('The leaf-runtime test must not execute an agent.');
  }
}

test('returns mechanical inconsistencies as typed completed evidence', () => {
  const report: CortexAuditReport = {
    brokenLinks: [
      {
        file: '.cortex/workflows/example.md',
        line: 12,
        target: '../missing.md',
      },
    ],
    missingFromIndex: ['unindexed.md'],
    orphanIndexRows: [],
    missingExecutableSkills: ['missing-wrapper'],
    densityFindings: [],
    structureFindings: [],
    articleStructureFindings: [],
    auditOk: false,
  };
  const output = mechanicalCortexAuditOutput(report);

  expect(output.resultKind).toBe(WorkflowResultKind.LoomLeafEvidence);
  expect(output.findings).toHaveLength(3);
  for (const finding of output.findings) {
    expect(finding.evidence.length).toBeGreaterThan(0);
  }
  expect(output.summary).toContain('found 3 inconsistencies');
});

test('allows a clean mechanical report with zero findings', () => {
  const report: CortexAuditReport = {
    brokenLinks: [],
    missingFromIndex: [],
    orphanIndexRows: [],
    missingExecutableSkills: [],
    densityFindings: [],
    structureFindings: [],
    articleStructureFindings: [],
    auditOk: true,
  };
  const output = mechanicalCortexAuditOutput(report);

  expect(output.findings).toEqual([]);
  expect(output.summary).toBe('Mechanical Cortex audit passed.');
});

test('runs the mechanical audit from the invocation working directory', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'loom-cortex-root-'));
  try {
    const skillsDirectory = join(repositoryRoot, '.cortex', 'dynamic-skills');
    await mkdir(skillsDirectory, CREATE_TREE_OPTIONS);
    await writeFile(
      join(repositoryRoot, '.cortex', 'AGENTS.md'),
      '[Missing](missing.md)\n',
    );
    await writeFile(join(skillsDirectory, 'index.md'), '# Skills\n');
    await writeFile(
      join(repositoryRoot, '.cortex', 'document-map-migration.txt'),
      '.cortex/AGENTS.md\n.cortex/dynamic-skills/index.md\n',
    );

    const runtime = new LocalWorkflowTaskRuntime<string, never>(
      new UnusedAgentRuntime(),
    );
    const abortController = new AbortController();
    const invocation: LoomLeafWorkflowTaskInvocation<string> = {
      task: 'mechanical-cortex-audit',
      attempt: 1,
      sourceCommit: '1111111111111111111111111111111111111111',
      runId: 'test-run',
      workingDirectory: repositoryRoot,
      upstreamOutputs: [],
      signal: abortController.signal,
      observe: () => Promise.resolve(),
      execution: {
        kind: WorkflowExecutorKind.LoomLeaf,
        leaf: LoomLeafKind.CortexAudit,
        includeDensityLint: false,
      },
    };
    const attempt = runtime.start(invocation);
    const terminal = await attempt.completion;

    expect(terminal.kind).toBe(TaskTerminalKind.Completed);
    if (terminal.kind !== TaskTerminalKind.Completed) {
      throw new Error('Expected the mechanical Cortex audit to complete.');
    }
    expect(terminal.output.findings).toHaveLength(1);
    expect(terminal.output.findings[0]?.title).toBe('Broken Cortex link');
  } finally {
    await rm(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});
