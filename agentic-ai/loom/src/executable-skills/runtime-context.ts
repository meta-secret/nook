import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ExecutableSkillClosureEntryRole } from './domain.ts';
import type { ExecutableSkillClosurePlan } from './domain.ts';
import { isExecutableSkillClosurePlanSealed } from './closure.ts';
import {
  throwExecutableSkillRuntimeFailure,
  type ThrowExecutableSkillRuntimeFailureRequest,
} from './runtime-failure.ts';

export type MaterializedExecutableSkillContext = {
  readonly closureSha256: string;
  readonly directory: string;
  readonly dispose: () => Promise<void>;
  readonly runnerContainerPath: string;
};

export type MaterializeExecutableSkillContextRequest = {
  readonly closurePlan: ExecutableSkillClosurePlan;
  readonly deadlineExpiresAt: number;
  readonly signal: AbortSignal | false;
};

export type ExecutableSkillContextDependencies = {
  readonly isClosurePlanSealed: (plan: ExecutableSkillClosurePlan) => boolean;
};

export type MaterializeExecutableSkillContextWithDependenciesRequest = {
  readonly dependencies: ExecutableSkillContextDependencies;
  readonly request: MaterializeExecutableSkillContextRequest;
};

const removeTreeOptions = { force: true, recursive: true } as const;
const imageDirectoryOptions = { mode: 0o755, recursive: true } as const;
const imageFileOptions = {
  encoding: 'utf8',
  flag: 'wx',
  mode: 0o444,
} as const;
const CONTAINER_CONTEXT_ROOT = '/opt/nook-skill';
const CANONICAL_CONTEXT_TIME = new Date(0);

export async function materializeExecutableSkillContext(
  request: MaterializeExecutableSkillContextRequest,
): Promise<MaterializedExecutableSkillContext> {
  const dependencies: ExecutableSkillContextDependencies = {
    isClosurePlanSealed: isExecutableSkillClosurePlanSealed,
  };
  const execution: MaterializeExecutableSkillContextWithDependenciesRequest = {
    dependencies,
    request,
  };
  return await materializeExecutableSkillContextWithDependencies(execution);
}

export async function materializeExecutableSkillContextWithDependencies(
  execution: MaterializeExecutableSkillContextWithDependenciesRequest,
): Promise<MaterializedExecutableSkillContext> {
  try {
    return await materializeExecutableSkillContextAfterAdmission(execution);
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error
          ? error
          : 'Executable skill context materialization failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
}

async function materializeExecutableSkillContextAfterAdmission(
  execution: MaterializeExecutableSkillContextWithDependenciesRequest,
): Promise<MaterializedExecutableSkillContext> {
  const request = execution.request;
  assertContextActive(request);
  if (!execution.dependencies.isClosurePlanSealed(request.closurePlan)) {
    throw new Error('Executable skill closure authority is invalid.');
  }
  const executionEntries = request.closurePlan.entries.filter(
    (entry) => entry.role === ExecutableSkillClosureEntryRole.ExecutionSource,
  );
  if (executionEntries.length === 0) {
    throw new Error('Executable skill execution closure is empty.');
  }
  const runner = executionEntries.find(
    (entry) => entry.relativePath === request.closurePlan.runnerRelativePath,
  );
  if (!runner) {
    throw new Error('Executable skill runner is absent from its closure.');
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'nook-skill-runtime-'));
  const contextDirectories = new Set<string>();
  try {
    for (const entry of executionEntries) {
      assertContextActive(request);
      const assertionRequest: AssertExecutionEntryRequest = {
        content: entry.content,
        expectedSha256: entry.contentSha256,
        relativePath: entry.relativePath,
      };
      assertExecutionEntry(assertionRequest);
      const destination = path.join(directory, entry.relativePath);
      const destinationDirectory = path.dirname(destination);
      await mkdir(destinationDirectory, imageDirectoryOptions);
      const directoryRequest: CollectContextDirectoriesRequest = {
        contextRoot: directory,
        destinationDirectory,
        directories: contextDirectories,
      };
      collectContextDirectories(directoryRequest);
      await writeFile(destination, entry.content, imageFileOptions);
      await chmod(destination, 0o444);
      await utimes(destination, CANONICAL_CONTEXT_TIME, CANONICAL_CONTEXT_TIME);
      assertContextActive(request);
    }
    for (const contextDirectory of [...contextDirectories].sort().reverse()) {
      await chmod(contextDirectory, 0o755);
      await utimes(
        contextDirectory,
        CANONICAL_CONTEXT_TIME,
        CANONICAL_CONTEXT_TIME,
      );
      assertContextActive(request);
    }
    await utimes(directory, CANONICAL_CONTEXT_TIME, CANONICAL_CONTEXT_TIME);
    const context: MaterializedExecutableSkillContext = {
      closureSha256: request.closurePlan.closureSha256,
      directory,
      dispose: () => rm(directory, removeTreeOptions),
      runnerContainerPath: path.posix.join(
        CONTAINER_CONTEXT_ROOT,
        request.closurePlan.runnerRelativePath,
      ),
    };
    return Object.freeze(context);
  } catch (error) {
    await rm(directory, removeTreeOptions);
    throw error;
  }
}

type CollectContextDirectoriesRequest = {
  readonly contextRoot: string;
  readonly destinationDirectory: string;
  readonly directories: Set<string>;
};

function collectContextDirectories(
  request: CollectContextDirectoriesRequest,
): void {
  let current = request.destinationDirectory;
  while (current !== request.contextRoot) {
    request.directories.add(current);
    const parent = path.dirname(current);
    if (parent === current || !current.startsWith(`${request.contextRoot}/`)) {
      throw new Error('Executable skill context directory escaped its root.');
    }
    current = parent;
  }
}

function assertContextActive(
  request: MaterializeExecutableSkillContextRequest,
): void {
  if (request.signal !== false && request.signal.aborted) {
    throw new Error('Executable skill context materialization was aborted.');
  }
  if (Date.now() >= request.deadlineExpiresAt) {
    throw new Error(
      'Executable skill context materialization deadline expired.',
    );
  }
}

type AssertExecutionEntryRequest = {
  readonly content: string;
  readonly expectedSha256: string;
  readonly relativePath: string;
};

function assertExecutionEntry(request: AssertExecutionEntryRequest): void {
  const relativePath = request.relativePath;
  const normalized = path.posix.normalize(relativePath);
  if (
    relativePath.length === 0 ||
    normalized !== relativePath ||
    path.posix.isAbsolute(relativePath) ||
    relativePath.startsWith('../')
  ) {
    throw new Error('Executable skill closure path is unsafe.');
  }
  const actualSha256 = createHash('sha256')
    .update(request.content)
    .digest('hex');
  if (actualSha256 !== request.expectedSha256) {
    throw new Error('Executable skill closure content identity changed.');
  }
}
