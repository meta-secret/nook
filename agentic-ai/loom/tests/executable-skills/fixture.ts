import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ExecutableSkillExecutionKind } from '../../src/executable-skills/domain.ts';
import {
  buildExecutableSkillClosureCandidate,
  type PlanExecutableSkillClosureRequest,
} from '../../src/executable-skills/closure.ts';
import type { SealedSourceAnalysisDockerEnvironment } from '../../src/executable-skills/source-analysis-docker.ts';
import type { RunExecutableSkillSourceAnalysisRequest } from '../../src/executable-skills/source-analysis-runtime.ts';
import { analyzeExecutableSkillSource } from '../../src/executable-skills/source-policy.ts';
import type {
  ExecutableSkillClosurePlan,
  ExecutableSkillManifest,
  RegisteredExecutableSkill,
} from '../../src/executable-skills/domain.ts';

const skillLimits = {
  requestBytes: 1024,
  resultBytes: 1024,
  timeoutMs: 1000,
};
const skillManifestValue: ExecutableSkillManifest = {
  schemaVersion: 1,
  id: 'fixture',
  executionKind: ExecutableSkillExecutionKind.DockerReadOnly,
  requestKind: 'fixture-request-v1',
  resultKind: 'fixture-result-v1',
  policyPaths: Object.freeze(['.cortex/architecture/fixture.md']),
  limits: Object.freeze(skillLimits),
};
const skillManifest = Object.freeze(skillManifestValue);

const fixtureRegistrationValue: RegisteredExecutableSkill = {
  skillId: 'fixture',
  manifest: skillManifest,
  manifestPath: '.agents/skills/fixture/executable-skill.json',
  runnerPath: '.agents/skills/fixture/src/runner.ts',
};
export const FIXTURE_REGISTRATION = Object.freeze(fixtureRegistrationValue);

const fixtureDockerEnvironment: SealedSourceAnalysisDockerEnvironment = {
  daemonId: '12345678-1234-1234-1234-123456789abc',
  endpoint: 'unix:///fixture/docker.sock',
};
export const FIXTURE_DOCKER_ENVIRONMENT = Object.freeze(
  fixtureDockerEnvironment,
);

export async function planExecutableSkillClosure(
  request: PlanExecutableSkillClosureRequest,
): Promise<ExecutableSkillClosurePlan> {
  const dependencies = {
    analyzeSource: async (
      analysisRequest: RunExecutableSkillSourceAnalysisRequest,
    ) => analyzeExecutableSkillSource(analysisRequest),
  };
  const execution = { dependencies, request };
  return await buildExecutableSkillClosureCandidate(execution);
}

export type ExecutableSkillFixture = {
  readonly dispose: () => Promise<void>;
  readonly repositoryRoot: string;
};

export type CreateExecutableSkillFixtureRequest = {
  readonly runnerSource?: string;
  readonly supportSource?: string;
};

type WriteFixtureFileRequest = {
  readonly content: string;
  readonly relativePath: string;
  readonly repositoryRoot: string;
};
type FixturePathRequest = Pick<
  WriteFixtureFileRequest,
  'relativePath' | 'repositoryRoot'
>;
const removeOptions = { force: true, recursive: true } as const;
const mkdirOptions = { recursive: true } as const;

export async function createExecutableSkillFixture(
  request: CreateExecutableSkillFixtureRequest,
): Promise<ExecutableSkillFixture> {
  const repositoryRoot = await mkdtemp(
    path.join(tmpdir(), 'nook-skill-registry-test-'),
  );
  const files = new Map<string, string>([
    ['.cortex/architecture/fixture.md', '# Fixture\n'],
    ['.agents/skills/package.json', '{"dependencies":{}}\n'],
    ['.agents/skills/bun.lock', 'lockfileVersion = 1\n'],
    [
      FIXTURE_REGISTRATION.manifestPath,
      `${JSON.stringify(FIXTURE_REGISTRATION.manifest)}\n`,
    ],
    [
      FIXTURE_REGISTRATION.runnerPath,
      request.runnerSource ??
        "import { value } from './support.ts';\nBun.write(Bun.stdout, String(value));\n",
    ],
    [
      '.agents/skills/fixture/src/support.ts',
      request.supportSource ?? 'export const value = 1;\n',
    ],
  ]);
  for (const [relativePath, content] of files) {
    const writeRequest: WriteFixtureFileRequest = {
      content,
      relativePath,
      repositoryRoot,
    };
    await writeFixtureFile(writeRequest);
  }
  const initRequest: RunGitRequest = {
    arguments: ['init', '--quiet'],
    repositoryRoot,
  };
  runGit(initRequest);
  const addRequest: RunGitRequest = { arguments: ['add', '.'], repositoryRoot };
  runGit(addRequest);
  return {
    repositoryRoot,
    dispose: () => rm(repositoryRoot, removeOptions),
  };
}

export function writeFixtureTree(repositoryRoot: string): string {
  const request: RunGitRequest = {
    arguments: ['write-tree'],
    repositoryRoot,
  };
  return runGit(request).trim();
}

export function stageFixturePath(request: FixturePathRequest): void {
  const gitRequest: RunGitRequest = {
    arguments: ['add', '--', request.relativePath],
    repositoryRoot: request.repositoryRoot,
  };
  runGit(gitRequest);
}

export function stageAllFixtureFiles(repositoryRoot: string): void {
  const request: RunGitRequest = {
    arguments: ['add', '.'],
    repositoryRoot,
  };
  runGit(request);
}

export function createFixtureFifo(request: FixturePathRequest): void {
  const fifoPath = path.join(request.repositoryRoot, request.relativePath);
  const gitRequest: RunGitRequest = {
    arguments: [fifoPath],
    repositoryRoot: request.repositoryRoot,
  };
  const commandRequest: RunCommandRequest = {
    ...gitRequest,
    executable: 'mkfifo',
  };
  runCommand(commandRequest);
}

export async function deleteFixturePath(
  request: FixturePathRequest,
): Promise<void> {
  await unlink(path.join(request.repositoryRoot, request.relativePath));
  const gitRequest: RunGitRequest = {
    arguments: ['add', '--update', '--', request.relativePath],
    repositoryRoot: request.repositoryRoot,
  };
  runGit(gitRequest);
}

export async function writeFixtureFile(
  request: WriteFixtureFileRequest,
): Promise<void> {
  const absolutePath = path.join(request.repositoryRoot, request.relativePath);
  await mkdir(path.dirname(absolutePath), mkdirOptions);
  await writeFile(absolutePath, request.content, 'utf8');
}

type RunGitRequest = {
  readonly arguments: readonly string[];
  readonly repositoryRoot: string;
};

function runGit(request: RunGitRequest): string {
  const commandRequest: RunCommandRequest = {
    ...request,
    executable: 'git',
  };
  return runCommand(commandRequest);
}

type RunCommandRequest = RunGitRequest & {
  readonly executable: string;
};

function runCommand(request: RunCommandRequest): string {
  const options = {
    cwd: request.repositoryRoot,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin' },
    stderr: 'pipe',
    stdout: 'pipe',
  } as const;
  const result = Bun.spawnSync(
    [request.executable, ...request.arguments],
    options,
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString();
}
