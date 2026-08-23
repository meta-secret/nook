import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import type { MakeDirectoryOptions, RmOptions } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, setDefaultTimeout, test } from 'bun:test';
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
  TaskStopReason,
  TaskTeardownKind,
  UnconfirmedTaskTeardownError,
} from '../../src/agent-workflow/runtime.ts';
import {
  LocalWorkflowTaskRuntime,
  mechanicalCortexAuditOutput,
} from '../../src/agent-workflow/leaf-runtime.ts';
import { MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH } from '../../src/agent-workflow/structured-result-codec.ts';

const REMOVE_TREE_OPTIONS: RmOptions = { recursive: true, force: true };
const CREATE_TREE_OPTIONS: MakeDirectoryOptions = { recursive: true };
setDefaultTimeout(180_000);
const EXECUTABLE_SKILL_MANIFEST = readFileSync(
  new URL(
    '../../../../.agents/skills/cortex-article-structure/executable-skill.json',
    import.meta.url,
  ),
  'utf8',
);
const EXECUTABLE_SKILLS_ROOT = new URL(
  '../../../../.agents/skills/',
  import.meta.url,
);

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
    executableSkillRegistryFindings: [],
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
    executableSkillRegistryFindings: [],
    auditOk: true,
  };
  const output = mechanicalCortexAuditOutput(report);

  expect(output.findings).toEqual([]);
  expect(output.summary).toBe('Mechanical Cortex audit passed.');
});

test('bounds Loom-authored mechanical materialized views', () => {
  const arrayLength = { length: 2_000 };
  const report: CortexAuditReport = {
    brokenLinks: [],
    missingFromIndex: Array.from(
      arrayLength,
      () => `documents/${'x'.repeat(100)}.md`,
    ),
    orphanIndexRows: [],
    missingExecutableSkills: [],
    densityFindings: [],
    structureFindings: [],
    articleStructureFindings: [],
    executableSkillRegistryFindings: [],
    auditOk: false,
  };
  const output = mechanicalCortexAuditOutput(report);

  expect(output.materializedViewMarkdown.length).toBeLessThanOrEqual(
    MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH,
  );
  expect(output.materializedViewMarkdown).toContain('## Truncation');
  expect(output.materializedViewMarkdown).toContain('`resultArtifact`');
  expect(output.findings).toHaveLength(2_000);
});

test('runs the mechanical audit from the invocation working directory', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'loom-cortex-root-'));
  try {
    const skillsDirectory = join(repositoryRoot, '.cortex', 'dynamic-skills');
    await mkdir(skillsDirectory, CREATE_TREE_OPTIONS);
    const executableSkillDirectory = join(
      repositoryRoot,
      '.agents',
      'skills',
      'cortex-article-structure',
    );
    const executableSkillsRoot = join(repositoryRoot, '.agents', 'skills');
    await mkdir(executableSkillDirectory, CREATE_TREE_OPTIONS);
    await writeFile(
      join(executableSkillDirectory, 'executable-skill.json'),
      EXECUTABLE_SKILL_MANIFEST,
    );
    const copyOptions = { recursive: true } as const;
    await cp(
      new URL('cortex-article-structure/src/', EXECUTABLE_SKILLS_ROOT),
      join(executableSkillDirectory, 'src'),
      copyOptions,
    );
    await cp(
      new URL('package.json', EXECUTABLE_SKILLS_ROOT),
      join(executableSkillsRoot, 'package.json'),
    );
    await cp(
      new URL('bun.lock', EXECUTABLE_SKILLS_ROOT),
      join(executableSkillsRoot, 'bun.lock'),
    );
    await writeFile(
      join(skillsDirectory, 'cortex-article-structure.md'),
      '# Cortex article structure\n',
    );
    await writeFile(
      join(repositoryRoot, '.cortex', 'AGENTS.md'),
      '# Agents\n\n[Missing](missing.md)\n',
    );
    await writeFile(
      join(repositoryRoot, '.cortex', 'knowledge-graph.md'),
      '# Cortex Knowledge Graph\n\n- [Agents](AGENTS.md)\n- [Skills](dynamic-skills/index.md)\n',
    );
    await writeFile(join(skillsDirectory, 'index.md'), '# Skills\n');
    const gitOptions = { cwd: repositoryRoot };
    execFileSync('git', ['init', '--quiet'], gitOptions);
    execFileSync('git', ['add', '.'], gitOptions);

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
    expect(
      terminal.output.findings.some(
        (finding) => finding.title === 'Broken Cortex link',
      ),
    ).toBe(true);
    expect(terminal.output.findings[0]?.title).toBe('Broken Cortex link');
  } finally {
    await rm(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

test('workflow stop waits for active executable-skill teardown', async () => {
  const runnerSource = [
    'export {};',
    'await Bun.stdin.text();',
    'await new Promise<never>(() => {});',
    '',
  ].join('\n');
  const fixtureRequest: CreateWorkflowAuditRepositoryRequest = {
    runnerSource,
  };
  const repositoryRoot = await createWorkflowAuditRepository(fixtureRequest);
  try {
    const runtime = new LocalWorkflowTaskRuntime<string, never>(
      new UnusedAgentRuntime(),
    );
    const abortController = new AbortController();
    const invocation: LoomLeafWorkflowTaskInvocation<string> = {
      task: 'mechanical-cortex-audit-cancellation',
      attempt: 1,
      sourceCommit: '1111111111111111111111111111111111111111',
      runId: 'test-cancellation-run',
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
    const completionSettled = attempt.completion.then(
      () => true,
      () => true,
    );
    const treeOptions = { cwd: repositoryRoot, encoding: 'utf8' } as const;
    const waitRequest: WaitForNewContainerRequest = {
      sourceTree: execFileSync('git', ['write-tree'], treeOptions).trim(),
      timeoutMs: 30_000,
    };
    const containerName = await waitForNewContainer(waitRequest);
    abortController.abort();
    const stopRequest = {
      hardDeadlineMs: 9_000,
      reason: TaskStopReason.WorkflowCancellation,
    } as const;
    const teardown = await attempt.stop(stopRequest);
    expect(teardown.kind).toBe(TaskTeardownKind.Confirmed);
    expect(await completionSettled).toBe(true);
    const inspection = Bun.spawnSync([
      'docker',
      'container',
      'inspect',
      containerName,
    ]);
    expect(inspection.exitCode).not.toBe(0);
  } finally {
    await rm(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

test('workflow stop rejects when Docker cleanup control times out', async () => {
  const fixtureRequest: CreateWorkflowAuditRepositoryRequest = {
    runnerSource: [
      'export {};',
      'await Bun.stdin.text();',
      'await new Promise<never>(() => {});',
      '',
    ].join('\n'),
  };
  const repositoryRoot = await createWorkflowAuditRepository(fixtureRequest);
  const originalDockerHost = Bun.env.DOCKER_HOST ?? false;
  const originalDockerContext = Bun.env.DOCKER_CONTEXT ?? false;
  let containerName: string | false = false;
  let dockerBlackhole: Server | false = false;
  const dockerBlackholeSockets = new Set<Socket>();
  try {
    const runtime = new LocalWorkflowTaskRuntime<string, never>(
      new UnusedAgentRuntime(),
    );
    const abortController = new AbortController();
    const invocation: LoomLeafWorkflowTaskInvocation<string> = {
      task: 'mechanical-cortex-audit-unconfirmed',
      attempt: 1,
      sourceCommit: '1111111111111111111111111111111111111111',
      runId: 'test-unconfirmed-run',
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
    const completionSettled = attempt.completion.then(
      () => true,
      () => true,
    );
    const treeOptions = { cwd: repositoryRoot, encoding: 'utf8' } as const;
    const waitRequest: WaitForNewContainerRequest = {
      sourceTree: execFileSync('git', ['write-tree'], treeOptions).trim(),
      timeoutMs: 30_000,
    };
    containerName = await waitForNewContainer(waitRequest);
    dockerBlackhole = createServer((socket) => {
      dockerBlackholeSockets.add(socket);
      socket.on('close', () => dockerBlackholeSockets.delete(socket));
    });
    const listening = once(dockerBlackhole, 'listening');
    dockerBlackhole.listen(0, '127.0.0.1');
    await listening;
    const blackholeAddress = dockerBlackhole.address();
    if (!blackholeAddress || typeof blackholeAddress === 'string') {
      throw new Error('Docker cleanup blackhole did not bind a TCP port.');
    }
    Bun.env.DOCKER_HOST = `tcp://127.0.0.1:${blackholeAddress.port}`;
    delete Bun.env.DOCKER_CONTEXT;
    const stopStartedAt = Date.now();
    abortController.abort();
    const stopRequest = {
      hardDeadlineMs: 9_000,
      reason: TaskStopReason.WorkflowCancellation,
    } as const;
    await expect(attempt.stop(stopRequest)).rejects.toBeInstanceOf(
      UnconfirmedTaskTeardownError,
    );
    expect(Date.now() - stopStartedAt).toBeLessThan(8_000);
    expect(await completionSettled).toBe(true);
  } finally {
    const hostRestoreRequest: RestoreEnvironmentValueRequest = {
      name: 'DOCKER_HOST',
      value: originalDockerHost,
    };
    restoreEnvironmentValue(hostRestoreRequest);
    const contextRestoreRequest: RestoreEnvironmentValueRequest = {
      name: 'DOCKER_CONTEXT',
      value: originalDockerContext,
    };
    restoreEnvironmentValue(contextRestoreRequest);
    if (dockerBlackhole !== false) {
      for (const socket of dockerBlackholeSockets) socket.destroy();
      dockerBlackhole.close();
    }
    if (containerName !== false) {
      Bun.spawnSync(['docker', 'rm', '--force', containerName]);
    }
    await rm(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

type RestoreEnvironmentValueRequest = {
  readonly name: string;
  readonly value: string | false;
};

function restoreEnvironmentValue(
  request: RestoreEnvironmentValueRequest,
): void {
  if (request.value === false) {
    delete Bun.env[request.name];
    return;
  }
  Bun.env[request.name] = request.value;
}

type CreateWorkflowAuditRepositoryRequest = {
  readonly runnerSource: string;
};

async function createWorkflowAuditRepository(
  request: CreateWorkflowAuditRepositoryRequest,
): Promise<string> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'loom-cortex-stop-'));
  const cortexSkills = join(repositoryRoot, '.cortex', 'dynamic-skills');
  const executableSkillsRoot = join(repositoryRoot, '.agents', 'skills');
  const executableSkill = join(
    executableSkillsRoot,
    'cortex-article-structure',
  );
  await mkdir(cortexSkills, CREATE_TREE_OPTIONS);
  await mkdir(executableSkill, CREATE_TREE_OPTIONS);
  await writeFile(
    join(executableSkill, 'executable-skill.json'),
    EXECUTABLE_SKILL_MANIFEST,
  );
  const copyOptions = { recursive: true } as const;
  await cp(
    new URL('cortex-article-structure/src/', EXECUTABLE_SKILLS_ROOT),
    join(executableSkill, 'src'),
    copyOptions,
  );
  await writeFile(
    join(executableSkill, 'src', 'runner.ts'),
    request.runnerSource,
  );
  await cp(
    new URL('package.json', EXECUTABLE_SKILLS_ROOT),
    join(executableSkillsRoot, 'package.json'),
  );
  await cp(
    new URL('bun.lock', EXECUTABLE_SKILLS_ROOT),
    join(executableSkillsRoot, 'bun.lock'),
  );
  await writeFile(
    join(cortexSkills, 'cortex-article-structure.md'),
    '# Cortex article structure\n',
  );
  await writeFile(join(repositoryRoot, '.cortex', 'AGENTS.md'), '# Agents\n');
  await writeFile(
    join(repositoryRoot, '.cortex', 'knowledge-graph.md'),
    '# Cortex Knowledge Graph\n',
  );
  await writeFile(join(cortexSkills, 'index.md'), '# Skills\n');
  const gitOptions = { cwd: repositoryRoot };
  execFileSync('git', ['init', '--quiet'], gitOptions);
  execFileSync('git', ['add', '.'], gitOptions);
  return repositoryRoot;
}

function executableSkillContainerNames(sourceTree: string): readonly string[] {
  const output = Bun.spawnSync([
    'docker',
    'container',
    'ls',
    '--all',
    '--filter',
    'name=^nook-skill-',
    '--filter',
    `label=nook.executable-skill-source-tree=${sourceTree}`,
    '--format',
    '{{.Names}}',
  ]);
  return output.stdout.toString().trim().split('\n').filter(Boolean);
}

type WaitForNewContainerRequest = {
  readonly sourceTree: string;
  readonly timeoutMs: number;
};

async function waitForNewContainer(
  request: WaitForNewContainerRequest,
): Promise<string> {
  const deadline = Date.now() + request.timeoutMs;
  while (Date.now() < deadline) {
    const [containerName] = executableSkillContainerNames(request.sourceTree);
    if (typeof containerName === 'string') return containerName;
    await Bun.sleep(50);
  }
  throw new Error('Executable skill container did not become observable.');
}
