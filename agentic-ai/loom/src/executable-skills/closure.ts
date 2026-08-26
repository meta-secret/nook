import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { ExecutableSkillClosureEntryRole } from './domain.ts';
import type {
  ExecutableSkillClosureEntry,
  ExecutableSkillClosurePlan,
  RegisteredExecutableSkill,
} from './domain.ts';
import { decodeExecutableSkillManifest } from './manifest-codec.ts';
import { sameExecutableSkillManifest } from './registration.ts';
import {
  runExecutableSkillSourceAnalysis,
  type RunExecutableSkillSourceAnalysisRequest,
} from './source-analysis-runtime.ts';
import type { SealedSourceAnalysisDockerEnvironment } from './source-analysis-docker.ts';
import type { ExecutableSkillSourceAnalysis } from './source-policy.ts';
import {
  isRecord,
  untrustedYamlProperty,
  UntrustedYamlPropertyPresence,
  type UntrustedYamlNode,
} from '../lib/guards.ts';

export type ExecutableSkillClosureAuditFailureRequest = {
  readonly causeMessage: string;
  readonly relativePath: string;
};

export class ExecutableSkillClosureAuditError extends Error {
  readonly relativePath: string;

  constructor(request: ExecutableSkillClosureAuditFailureRequest) {
    super(
      `Executable skill source ${request.relativePath} failed capability audit: ${request.causeMessage}`,
    );
    this.name = 'ExecutableSkillClosureAuditError';
    this.relativePath = request.relativePath;
  }
}

export type PlanExecutableSkillClosureRequest = {
  readonly definition: RegisteredExecutableSkill;
  readonly deadlineExpiresAt: number;
  readonly dockerEnvironment: SealedSourceAnalysisDockerEnvironment;
  readonly repositoryRoot: string;
  readonly signal: AbortSignal | false;
  readonly sourceTree: string;
};

export type ExecutableSkillSourceAnalyzer = (
  request: RunExecutableSkillSourceAnalysisRequest,
) => Promise<ExecutableSkillSourceAnalysis>;

type ExecutableSkillClosureDependencies = {
  readonly analyzeSource: ExecutableSkillSourceAnalyzer;
};

type PlanExecutableSkillClosureWithDependenciesRequest = {
  readonly dependencies: ExecutableSkillClosureDependencies;
  readonly request: PlanExecutableSkillClosureRequest;
};

export type ExecutableSkillClosureCandidate = {
  readonly closureSha256: string;
  readonly entries: readonly ExecutableSkillClosureEntry[];
  readonly runnerRelativePath: string;
  readonly sourceTree: string;
};

type ReadTreeFileRequest = {
  readonly relativePath: string;
  readonly repositoryRoot: string;
  readonly sourceTree: string;
};

const PACKAGE_PATH = '.agents/skills/package.json';
const LOCK_PATH = '.agents/skills/bun.lock';
const TREE_HASH = /^[0-9a-f]{40}$/u;
const sealedClosurePlans = new WeakSet<ExecutableSkillClosurePlan>();
const executableSkillClosureLimits = {
  bytes: 8 * 1024 * 1024,
  edges: 64,
  files: 32,
};
export const EXECUTABLE_SKILL_CLOSURE_LIMITS = Object.freeze(
  executableSkillClosureLimits,
);

export async function planExecutableSkillClosure(
  request: PlanExecutableSkillClosureRequest,
): Promise<ExecutableSkillClosurePlan> {
  const dependencies: ExecutableSkillClosureDependencies = {
    analyzeSource: runExecutableSkillSourceAnalysis,
  };
  const execution: PlanExecutableSkillClosureWithDependenciesRequest = {
    dependencies,
    request,
  };
  const candidate = await buildExecutableSkillClosureCandidate(execution);
  const planValue: ExecutableSkillClosurePlan = { ...candidate };
  const plan = Object.freeze(planValue);
  sealedClosurePlans.add(plan);
  return plan;
}

export async function buildExecutableSkillClosureCandidate(
  execution: PlanExecutableSkillClosureWithDependenciesRequest,
): Promise<ExecutableSkillClosureCandidate> {
  const request = execution.request;
  try {
    return await planExecutableSkillClosureInternal(execution);
  } catch (error) {
    const failureRequest: ClosureAuditErrorRequest = {
      error: error instanceof Error ? error : '',
      relativePath: request.definition.runnerPath,
    };
    throw closureAuditError(failureRequest);
  }
}

export function isExecutableSkillClosurePlanSealed(
  plan: ExecutableSkillClosurePlan,
): boolean {
  return sealedClosurePlans.has(plan);
}

async function planExecutableSkillClosureInternal(
  execution: PlanExecutableSkillClosureWithDependenciesRequest,
): Promise<ExecutableSkillClosureCandidate> {
  const request = execution.request;
  assertClosureActive(request);
  if (!TREE_HASH.test(request.sourceTree)) {
    throw new Error('Executable skill source tree is invalid.');
  }
  const sourceTree = request.sourceTree;
  const pending = [request.definition.runnerPath];
  const sources = new Map<string, string>();
  let aggregateBytes = 0;
  let importEdges = 0;
  while (pending.length > 0) {
    assertClosureActive(request);
    const relativePath = pending.pop();
    if (typeof relativePath !== 'string' || sources.has(relativePath)) continue;
    const sourcePathRequest: AssertSkillSourcePathRequest = {
      relativePath,
      repositoryRoot: request.repositoryRoot,
      skillId: request.definition.skillId,
    };
    assertSkillSourcePath(sourcePathRequest);
    const treeFileRequest: ReadTreeFileRequest = {
      relativePath,
      repositoryRoot: request.repositoryRoot,
      sourceTree,
    };
    const closureFileRequest: ReadClosureFileRequest = {
      ...treeFileRequest,
      deadlineExpiresAt: request.deadlineExpiresAt,
      signal: request.signal,
    };
    let source: string;
    try {
      source = await readTreeFile(closureFileRequest);
      const worktreeRequest: AssertWorktreeMatchesRequest = {
        ...closureFileRequest,
        indexed: source,
      };
      await assertWorktreeMatches(worktreeRequest);
    } catch (error) {
      const failureRequest: ClosureAuditErrorRequest = {
        error: error instanceof Error ? error : '',
        relativePath,
      };
      throw closureAuditError(failureRequest);
    }
    try {
      assertClosureFileCount(sources.size + 1);
      const sourceBytesRequest: BoundedClosureBytesRequest = {
        current: aggregateBytes,
        content: source,
      };
      aggregateBytes = boundedClosureBytes(sourceBytesRequest);
    } catch (error) {
      const failureRequest: ClosureAuditErrorRequest = {
        error: error instanceof Error ? error : '',
        relativePath,
      };
      throw closureAuditError(failureRequest);
    }
    sources.set(relativePath, source);
    const sourceAnalysisRequest: RunExecutableSkillSourceAnalysisRequest = {
      deadlineExpiresAt: request.deadlineExpiresAt,
      dockerEnvironment: request.dockerEnvironment,
      relativePath,
      signal: request.signal,
      source,
    };
    let analysis: ExecutableSkillSourceAnalysis;
    try {
      analysis = await execution.dependencies.analyzeSource(
        sourceAnalysisRequest,
      );
    } catch (error) {
      const failureRequest: ExecutableSkillClosureAuditFailureRequest = {
        causeMessage: error instanceof Error ? error.message : '',
        relativePath,
      };
      throw new ExecutableSkillClosureAuditError(failureRequest);
    }
    const imports = analysis.moduleSpecifiers;
    for (const specifier of imports) {
      try {
        importEdges += 1;
        if (importEdges > EXECUTABLE_SKILL_CLOSURE_LIMITS.edges) {
          throw new Error(
            'Executable skill closure exceeds its import edge limit.',
          );
        }
        if (!specifier.startsWith('.')) continue;
        const importRequest: ResolveLocalImportRequest = {
          importer: relativePath,
          specifier,
        };
        const importedPath = resolveLocalImport(importRequest);
        const importedPathRequest: AssertSkillSourcePathRequest = {
          relativePath: importedPath,
          repositoryRoot: request.repositoryRoot,
          skillId: request.definition.skillId,
        };
        assertSkillSourcePath(importedPathRequest);
        pending.push(importedPath);
      } catch (error) {
        const failureRequest: ClosureAuditErrorRequest = {
          error: error instanceof Error ? error : '',
          relativePath,
        };
        throw closureAuditError(failureRequest);
      }
    }
  }
  const packageRequest: ReadTreeFileRequest = {
    relativePath: PACKAGE_PATH,
    repositoryRoot: request.repositoryRoot,
    sourceTree,
  };
  const packageFileRequest: ReadClosureFileRequest = {
    ...packageRequest,
    deadlineExpiresAt: request.deadlineExpiresAt,
    signal: request.signal,
  };
  const packageText = await readClosureMetadata(packageFileRequest);
  const lockRequest: ReadTreeFileRequest = {
    relativePath: LOCK_PATH,
    repositoryRoot: request.repositoryRoot,
    sourceTree,
  };
  const lockFileRequest: ReadClosureFileRequest = {
    ...lockRequest,
    deadlineExpiresAt: request.deadlineExpiresAt,
    signal: request.signal,
  };
  const lockText = await readClosureMetadata(lockFileRequest);
  const manifestRequest: ReadTreeFileRequest = {
    relativePath: request.definition.manifestPath,
    repositoryRoot: request.repositoryRoot,
    sourceTree,
  };
  const manifestFileRequest: ReadClosureFileRequest = {
    ...manifestRequest,
    deadlineExpiresAt: request.deadlineExpiresAt,
    signal: request.signal,
  };
  const manifestText = await readClosureMetadata(manifestFileRequest);
  const policyContents = new Map<string, string>();
  for (const relativePath of request.definition.manifest.policyPaths) {
    const policyRequest: ReadClosureFileRequest = {
      deadlineExpiresAt: request.deadlineExpiresAt,
      relativePath,
      repositoryRoot: request.repositoryRoot,
      signal: request.signal,
      sourceTree,
    };
    policyContents.set(relativePath, await readClosureMetadata(policyRequest));
  }
  try {
    assertClosureFileCount(sources.size + 3 + policyContents.size);
  } catch (error) {
    const failureRequest: ClosureAuditErrorRequest = {
      error: error instanceof Error ? error : '',
      relativePath: request.definition.runnerPath,
    };
    throw closureAuditError(failureRequest);
  }
  try {
    const packageBytesRequest: BoundedClosureBytesRequest = {
      current: aggregateBytes,
      content: packageText,
    };
    aggregateBytes = boundedClosureBytes(packageBytesRequest);
  } catch (error) {
    const failureRequest: ClosureAuditErrorRequest = {
      error: error instanceof Error ? error : '',
      relativePath: PACKAGE_PATH,
    };
    throw closureAuditError(failureRequest);
  }
  try {
    const lockBytesRequest: BoundedClosureBytesRequest = {
      current: aggregateBytes,
      content: lockText,
    };
    aggregateBytes = boundedClosureBytes(lockBytesRequest);
  } catch (error) {
    const failureRequest: ClosureAuditErrorRequest = {
      error: error instanceof Error ? error : '',
      relativePath: LOCK_PATH,
    };
    throw closureAuditError(failureRequest);
  }
  try {
    const manifestBytesRequest: BoundedClosureBytesRequest = {
      current: aggregateBytes,
      content: manifestText,
    };
    aggregateBytes = boundedClosureBytes(manifestBytesRequest);
    for (const content of policyContents.values()) {
      const policyBytesRequest: BoundedClosureBytesRequest = {
        current: aggregateBytes,
        content,
      };
      aggregateBytes = boundedClosureBytes(policyBytesRequest);
    }
  } catch (error) {
    const failureRequest: ClosureAuditErrorRequest = {
      error: error instanceof Error ? error : '',
      relativePath: request.definition.manifestPath,
    };
    throw closureAuditError(failureRequest);
  }
  try {
    const frozenManifest = decodeExecutableSkillManifest(manifestText);
    const manifestComparisonRequest = {
      left: frozenManifest,
      right: request.definition.manifest,
    };
    if (!sameExecutableSkillManifest(manifestComparisonRequest)) {
      throw new Error(
        'Executable skill frozen manifest differs from its static registration.',
      );
    }
  } catch (error) {
    const failureRequest: ClosureAuditErrorRequest = {
      error: error instanceof Error ? error : '',
      relativePath: request.definition.manifestPath,
    };
    throw closureAuditError(failureRequest);
  }
  try {
    assertNoDeclaredRuntimePackages(packageText);
  } catch (error) {
    const failureRequest: ClosureAuditErrorRequest = {
      error: error instanceof Error ? error : '',
      relativePath: PACKAGE_PATH,
    };
    throw closureAuditError(failureRequest);
  }
  const entryInputs = new Map<string, ClosureEntryInput>();
  for (const [relativePath, content] of sources) {
    const sourceEntry: ClosureEntryInput = {
      content,
      relativePath,
      role: ExecutableSkillClosureEntryRole.ExecutionSource,
    };
    entryInputs.set(relativePath, sourceEntry);
  }
  const packageEntry: ClosureEntryInput = {
    content: packageText,
    relativePath: PACKAGE_PATH,
    role: ExecutableSkillClosureEntryRole.PackageProvenance,
  };
  entryInputs.set(PACKAGE_PATH, packageEntry);
  const lockEntry: ClosureEntryInput = {
    content: lockText,
    relativePath: LOCK_PATH,
    role: ExecutableSkillClosureEntryRole.LockProvenance,
  };
  entryInputs.set(LOCK_PATH, lockEntry);
  const manifestEntry: ClosureEntryInput = {
    content: manifestText,
    relativePath: request.definition.manifestPath,
    role: ExecutableSkillClosureEntryRole.ManifestProvenance,
  };
  entryInputs.set(request.definition.manifestPath, manifestEntry);
  for (const [relativePath, content] of policyContents) {
    const policyEntry: ClosureEntryInput = {
      content,
      relativePath,
      role: ExecutableSkillClosureEntryRole.PolicyProvenance,
    };
    entryInputs.set(relativePath, policyEntry);
  }
  const entries: ExecutableSkillClosureEntry[] = [];
  for (const relativePath of [...entryInputs.keys()].sort()) {
    const entryInput = entryInputs.get(relativePath);
    if (entryInput) entries.push(closureEntry(entryInput));
  }
  const frozenEntries = Object.freeze(entries);
  const digestRequest: ClosureDigestRequest = {
    entries: frozenEntries,
    runnerRelativePath: request.definition.runnerPath,
  };
  assertClosureActive(request);
  const plan: ExecutableSkillClosurePlan = {
    closureSha256: closureDigest(digestRequest),
    entries: frozenEntries,
    runnerRelativePath: request.definition.runnerPath,
    sourceTree,
  };
  return Object.freeze(plan);
}

type ReadClosureFileRequest = ReadTreeFileRequest & ClosureActivity;

async function readClosureMetadata(
  request: ReadClosureFileRequest,
): Promise<string> {
  try {
    const content = await readTreeFile(request);
    const worktreeRequest: AssertWorktreeMatchesRequest = {
      ...request,
      indexed: content,
    };
    await assertWorktreeMatches(worktreeRequest);
    return content;
  } catch (error) {
    const failureRequest: ClosureAuditErrorRequest = {
      error: error instanceof Error ? error : '',
      relativePath: request.relativePath,
    };
    throw closureAuditError(failureRequest);
  }
}

type ClosureAuditErrorRequest = {
  readonly error: Error | string;
  readonly relativePath: string;
};

function closureAuditError(
  request: ClosureAuditErrorRequest,
): ExecutableSkillClosureAuditError {
  if (request.error instanceof ExecutableSkillClosureAuditError) {
    return request.error;
  }
  const failureRequest: ExecutableSkillClosureAuditFailureRequest = {
    causeMessage:
      request.error instanceof Error ? request.error.message : request.error,
    relativePath: request.relativePath,
  };
  return new ExecutableSkillClosureAuditError(failureRequest);
}

async function readTreeFile(request: ReadClosureFileRequest): Promise<string> {
  await assertFrozenRegularFile(request);
  const gitRequest: RunClosureGitRequest = {
    arguments: ['show', `${request.sourceTree}:${request.relativePath}`],
    deadlineExpiresAt: request.deadlineExpiresAt,
    maximumBytes: EXECUTABLE_SKILL_CLOSURE_LIMITS.bytes + 1,
    repositoryRoot: request.repositoryRoot,
    signal: request.signal,
  };
  try {
    return await runClosureGit(gitRequest);
  } catch {
    assertClosureActive(request);
    throw new Error(
      `Executable skill closure file is absent from the frozen index: ${request.relativePath}`,
    );
  }
}

async function assertFrozenRegularFile(
  request: ReadClosureFileRequest,
): Promise<void> {
  const gitRequest: RunClosureGitRequest = {
    arguments: [
      'ls-tree',
      '-z',
      '--full-tree',
      request.sourceTree,
      '--',
      request.relativePath,
    ],
    deadlineExpiresAt: request.deadlineExpiresAt,
    maximumBytes: 32 * 1024,
    repositoryRoot: request.repositoryRoot,
    signal: request.signal,
  };
  const entry = await runClosureGit(gitRequest);
  const separator = entry.indexOf('\t');
  const metadata = entry.slice(0, separator);
  const entryPath = entry.slice(separator + 1, -1);
  if (
    separator < 0 ||
    !entry.endsWith('\0') ||
    !/^100644 blob [0-9a-f]{40}$/u.test(metadata) ||
    entryPath !== request.relativePath
  ) {
    throw new Error(
      `Executable skill closure file must have frozen 100644 mode: ${request.relativePath}`,
    );
  }
  assertClosureActive(request);
}

type AssertWorktreeMatchesRequest = ReadClosureFileRequest & {
  readonly indexed: string;
};

async function assertWorktreeMatches(
  request: AssertWorktreeMatchesRequest,
): Promise<void> {
  assertClosureActive(request);
  const absolutePath = path.join(request.repositoryRoot, request.relativePath);
  let handle: FileHandle | false = false;
  let worktreeMatches = false;
  try {
    const canonicalRoot = await realpath(request.repositoryRoot);
    const expectedPath = path.join(canonicalRoot, request.relativePath);
    const canonicalPath = await realpath(absolutePath);
    if (canonicalPath !== expectedPath) {
      throw new Error('Executable skill closure path traverses a symlink.');
    }
    const flags =
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    handle = await open(absolutePath, flags);
    const stat = await handle.stat();
    if ((await realpath(absolutePath)) !== expectedPath) {
      throw new Error('Executable skill closure path traverses a symlink.');
    }
    assertClosureActive(request);
    if (stat.isFile() && stat.size <= EXECUTABLE_SKILL_CLOSURE_LIMITS.bytes) {
      const indexedBytes = Buffer.byteLength(request.indexed, 'utf8');
      const maximumBytes = Math.min(
        indexedBytes + 1,
        EXECUTABLE_SKILL_CLOSURE_LIMITS.bytes + 1,
      );
      const readRequest: ReadWorktreeDescriptorRequest = {
        handle,
        lifecycle: request,
        maximumBytes,
      };
      worktreeMatches = (await readWorktreeDescriptor(readRequest)).equals(
        Buffer.from(request.indexed, 'utf8'),
      );
    }
  } catch {
    assertClosureActive(request);
  } finally {
    if (handle !== false) await handle.close();
  }
  if (!worktreeMatches) {
    throw new Error(
      `Executable skill closure has worktree/index drift: ${request.relativePath}`,
    );
  }
}

type ReadWorktreeDescriptorRequest = {
  readonly handle: FileHandle;
  readonly lifecycle: ClosureActivity;
  readonly maximumBytes: number;
};

async function readWorktreeDescriptor(
  request: ReadWorktreeDescriptorRequest,
): Promise<Buffer> {
  const content = Buffer.alloc(request.maximumBytes);
  let offset = 0;
  while (offset < content.byteLength) {
    assertClosureActive(request.lifecycle);
    const readResult = await request.handle.read(
      content,
      offset,
      content.byteLength - offset,
      offset,
    );
    assertClosureActive(request.lifecycle);
    if (readResult.bytesRead === 0) break;
    offset += readResult.bytesRead;
  }
  return content.subarray(0, offset);
}

function assertClosureFileCount(count: number): void {
  if (count > EXECUTABLE_SKILL_CLOSURE_LIMITS.files) {
    throw new Error('Executable skill closure exceeds its file count limit.');
  }
}

type BoundedClosureBytesRequest = {
  readonly content: string;
  readonly current: number;
};

function boundedClosureBytes(request: BoundedClosureBytesRequest): number {
  const total = request.current + Buffer.byteLength(request.content, 'utf8');
  if (total > EXECUTABLE_SKILL_CLOSURE_LIMITS.bytes) {
    throw new Error(
      'Executable skill closure exceeds its aggregate byte limit.',
    );
  }
  return total;
}

type ClosureActivity = {
  readonly deadlineExpiresAt: number;
  readonly signal: AbortSignal | false;
};

function assertClosureActive(request: ClosureActivity): void {
  if (request.signal !== false && request.signal.aborted) {
    throw new Error('Executable skill lifecycle was cancelled.');
  }
  if (Date.now() >= request.deadlineExpiresAt) {
    throw new Error('Executable skill closure lifecycle deadline expired.');
  }
}

type RunClosureGitRequest = ClosureActivity & {
  readonly arguments: readonly string[];
  readonly maximumBytes: number;
  readonly repositoryRoot: string;
};

type ClosureInterruption = {
  readonly interrupted: string;
};

type ClosureInterruptionWait = {
  readonly dispose: () => void;
  readonly promise: Promise<ClosureInterruption>;
};

async function runClosureGit(request: RunClosureGitRequest): Promise<string> {
  assertClosureActive(request);
  const options = {
    cwd: request.repositoryRoot,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin' },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  } as const;
  const subprocess = Bun.spawn(['git', ...request.arguments], options);
  const outputRequest: ReadGitStreamRequest = {
    maximumBytes: request.maximumBytes,
    stream: subprocess.stdout,
  };
  const errorRequest: ReadGitStreamRequest = {
    maximumBytes: 32 * 1024,
    stream: subprocess.stderr,
  };
  const output = readGitStream(outputRequest);
  const error = readGitStream(errorRequest);
  const completion = subprocess.exited.then((exitCode) => ({ exitCode }));
  const interruption = waitForClosureInterruption(request);
  const streamFailure = Promise.race([
    waitForClosureStreamFailure(output),
    waitForClosureStreamFailure(error),
  ]);
  try {
    const first = await Promise.race([
      completion,
      interruption.promise,
      streamFailure,
    ]);
    if (first instanceof Error) {
      subprocess.kill(9);
      await subprocess.exited;
      await Promise.allSettled([output, error]);
      throw first;
    }
    if ('interrupted' in first) {
      subprocess.kill(9);
      await subprocess.exited;
      await Promise.allSettled([output, error]);
      throw new Error(first.interrupted);
    }
    const stdout = await output;
    const stderr = await error;
    if (first.exitCode !== 0) {
      throw new Error(stderr || 'Executable skill Git traversal failed.');
    }
    return stdout;
  } finally {
    interruption.dispose();
    if (typeof subprocess.exitCode !== 'number') subprocess.kill(9);
    await subprocess.exited;
  }
}

async function waitForClosureStreamFailure(
  stream: Promise<string>,
): Promise<Error> {
  try {
    await stream;
    return await new Promise<Error>(() => false);
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error('Executable skill Git traversal stream failed.');
  }
}

function waitForClosureInterruption(
  request: ClosureActivity,
): ClosureInterruptionWait {
  let abortListener: (() => void) | false = false;
  let timer: ReturnType<typeof setTimeout> | false = false;
  const promise = new Promise<ClosureInterruption>((resolve) => {
    const remaining = Math.max(0, request.deadlineExpiresAt - Date.now());
    timer = setTimeout(() => {
      const interruption: ClosureInterruption = {
        interrupted: 'Executable skill closure lifecycle deadline expired.',
      };
      resolve(interruption);
    }, remaining);
    if (request.signal !== false) {
      if (request.signal.aborted) {
        const interruption: ClosureInterruption = {
          interrupted: 'Executable skill lifecycle was cancelled.',
        };
        resolve(interruption);
        return;
      }
      abortListener = () => {
        const interruption: ClosureInterruption = {
          interrupted: 'Executable skill lifecycle was cancelled.',
        };
        resolve(interruption);
      };
      request.signal.addEventListener('abort', abortListener);
    }
  });
  return {
    promise,
    dispose: () => {
      if (timer !== false) clearTimeout(timer);
      if (request.signal !== false && abortListener !== false) {
        request.signal.removeEventListener('abort', abortListener);
      }
    },
  };
}

type ReadGitStreamRequest = {
  readonly maximumBytes: number;
  readonly stream: ReadableStream<Uint8Array>;
};

async function readGitStream(request: ReadGitStreamRequest): Promise<string> {
  const reader = request.stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > request.maximumBytes) {
        await reader.cancel();
        throw new Error(
          'Executable skill Git traversal output exceeded its bound.',
        );
      }
      chunks.push(chunk.value);
    }
    const output = Buffer.concat(chunks);
    if (!isUtf8(output)) {
      throw new Error('Executable skill Git traversal output is not UTF-8.');
    }
    return output.toString('utf8');
  } finally {
    reader.releaseLock();
  }
}

type AssertSkillSourcePathRequest = {
  readonly relativePath: string;
  readonly repositoryRoot: string;
  readonly skillId: string;
};

function assertSkillSourcePath(request: AssertSkillSourcePathRequest): void {
  const expectedRoot = `.agents/skills/${request.skillId}/`;
  if (
    !request.relativePath.startsWith(expectedRoot) ||
    !request.relativePath.endsWith('.ts') ||
    request.relativePath
      .split('/')
      .some((part) => part === '.' || part === '..')
  ) {
    throw new Error('Executable skill local import escapes its package.');
  }
}

type ResolveLocalImportRequest = {
  readonly importer: string;
  readonly specifier: string;
};

function resolveLocalImport(request: ResolveLocalImportRequest): string {
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(request.importer), request.specifier),
  );
  return resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
}

function assertNoDeclaredRuntimePackages(packageText: string): void {
  const transport = JSON.parse(packageText) as UntrustedYamlNode;
  if (!isRecord(transport)) {
    throw new Error('Executable skill package root must be an exact object.');
  }
  const allowedKeys = new Set([
    'dependencies',
    'devDependencies',
    'name',
    'packageManager',
    'private',
    'scripts',
    'type',
    'version',
  ]);
  const unexpectedKey = Object.keys(transport).find(
    (key) => !allowedKeys.has(key),
  );
  if (unexpectedKey) {
    throw new Error(
      `Executable skill package forbids authority field: ${unexpectedKey}`,
    );
  }
  const propertyRequest = { record: transport, key: 'dependencies' };
  const dependencies = untrustedYamlProperty(propertyRequest);
  if (dependencies.presence === UntrustedYamlPropertyPresence.Present) {
    if (!isRecord(dependencies.value)) {
      throw new Error(
        'Executable skill package dependencies must be an exact object.',
      );
    }
    if (Object.keys(dependencies.value).length > 0) {
      throw new Error(
        'Executable skill forbids declared external runtime packages.',
      );
    }
  }
  assertSafeDevelopmentPackages(transport);
  assertSafePackageScripts(transport);
}

type ExecutableSkillPackageTransport = Readonly<
  Record<string, UntrustedYamlNode>
>;

function assertSafeDevelopmentPackages(
  transport: ExecutableSkillPackageTransport,
): void {
  const propertyRequest = { record: transport, key: 'devDependencies' };
  const development = untrustedYamlProperty(propertyRequest);
  if (development.presence === UntrustedYamlPropertyPresence.Absent) return;
  if (!isRecord(development.value)) {
    throw new Error(
      'Executable skill devDependencies must be an exact object.',
    );
  }
  const allowed = new Set([
    '@eslint/js',
    '@types/bun',
    'eslint',
    'prettier',
    'typescript',
    'typescript-eslint',
  ]);
  for (const [name, version] of Object.entries(development.value)) {
    if (
      !allowed.has(name) ||
      typeof version !== 'string' ||
      !/^\d+\.\d+\.\d+$/u.test(version)
    ) {
      throw new Error(
        `Executable skill package forbids development package: ${name}`,
      );
    }
  }
}

function assertSafePackageScripts(
  transport: ExecutableSkillPackageTransport,
): void {
  const propertyRequest = { record: transport, key: 'scripts' };
  const scripts = untrustedYamlProperty(propertyRequest);
  if (scripts.presence === UntrustedYamlPropertyPresence.Absent) return;
  if (!isRecord(scripts.value)) {
    throw new Error(
      'Executable skill package scripts must be an exact object.',
    );
  }
  const lifecycleNames = new Set([
    'install',
    'postinstall',
    'preinstall',
    'prepare',
    'prepack',
    'postpack',
  ]);
  for (const [name, command] of Object.entries(scripts.value)) {
    if (lifecycleNames.has(name) || typeof command !== 'string') {
      throw new Error(
        `Executable skill package forbids lifecycle script: ${name}`,
      );
    }
  }
}

type ClosureEntryInput = Omit<ExecutableSkillClosureEntry, 'contentSha256'>;

function closureEntry(entry: ClosureEntryInput): ExecutableSkillClosureEntry {
  const frozenEntry: ExecutableSkillClosureEntry = {
    ...entry,
    contentSha256: createHash('sha256').update(entry.content).digest('hex'),
  };
  return Object.freeze(frozenEntry);
}

type ClosureDigestRequest = {
  readonly entries: readonly ExecutableSkillClosureEntry[];
  readonly runnerRelativePath: string;
};

function closureDigest(request: ClosureDigestRequest): string {
  const hash = createHash('sha256');
  hash.update('nook-executable-skill-closure-v1\0');
  hash.update(request.runnerRelativePath);
  hash.update('\n');
  for (const entry of request.entries) {
    hash.update(entry.role);
    hash.update('\0');
    hash.update(entry.relativePath);
    hash.update('\0');
    hash.update(entry.contentSha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}
