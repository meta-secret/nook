import { createHash } from 'node:crypto';
import { constants, rmSync } from 'node:fs';
import { mkdir, mkdtemp, open, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RegisteredExecutableSkill } from './domain.ts';
import { decodeExecutableSkillManifest } from './manifest-codec.ts';
import {
  analyzeExecutableSkillSource,
  type AnalyzeExecutableSkillSourceRequest,
} from './source-policy.ts';

export type MaterializedSkillClosure = {
  readonly closureSha256: string;
  readonly contextDirectory: string;
  readonly runnerImagePath: string;
  readonly sourceTree: string;
  readonly dispose: () => void;
};

export type MaterializeSkillClosureRequest = {
  readonly definition: RegisteredExecutableSkill;
  readonly deadlineExpiresAt: number;
  readonly repositoryRoot: string;
  readonly signal: AbortSignal | false;
};

type MaterializeSkillClosureInternalRequest = MaterializeSkillClosureRequest & {
  readonly auditCapabilities: boolean;
};

type ReadTreeFileRequest = {
  readonly relativePath: string;
  readonly repositoryRoot: string;
  readonly sourceTree: string;
};

type PackageTransport = {
  readonly dependencies?: Readonly<Record<string, string>>;
};

const PACKAGE_PATH = '.agents/skills/package.json';
const LOCK_PATH = '.agents/skills/bun.lock';
const TREE_HASH = /^[0-9a-f]{40}$/u;
const DIRECTORY_OPTIONS = { recursive: true } as const;
const REMOVE_OPTIONS = { recursive: true, force: true } as const;
const executableSkillClosureLimits = {
  bytes: 8 * 1024 * 1024,
  edges: 256,
  files: 128,
};
export const EXECUTABLE_SKILL_CLOSURE_LIMITS = Object.freeze(
  executableSkillClosureLimits,
);

export async function materializeSkillClosure(
  request: MaterializeSkillClosureRequest,
): Promise<MaterializedSkillClosure> {
  const internalRequest: MaterializeSkillClosureInternalRequest = {
    ...request,
    auditCapabilities: true,
  };
  return materializeSkillClosureInternal(internalRequest);
}

export async function materializeSkillAcceptanceProbeClosure(
  request: MaterializeSkillClosureRequest,
): Promise<MaterializedSkillClosure> {
  const internalRequest: MaterializeSkillClosureInternalRequest = {
    ...request,
    auditCapabilities: false,
  };
  return materializeSkillClosureInternal(internalRequest);
}

async function materializeSkillClosureInternal(
  request: MaterializeSkillClosureInternalRequest,
): Promise<MaterializedSkillClosure> {
  assertClosureActive(request);
  const sourceTree = await writeIndexTree(request);
  const pending = [request.definition.runnerPath];
  const sources = new Map<string, string>();
  const externalPackages = new Set<string>();
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
    const source = await readTreeFile(closureFileRequest);
    await assertWorktreeMatches(closureFileRequest);
    assertClosureFileCount(sources.size + 1);
    const sourceBytesRequest: BoundedClosureBytesRequest = {
      current: aggregateBytes,
      content: source,
    };
    aggregateBytes = boundedClosureBytes(sourceBytesRequest);
    sources.set(relativePath, source);
    const sourceAnalysisRequest: AnalyzeExecutableSkillSourceRequest = {
      auditCapabilities: request.auditCapabilities,
      relativePath,
      source,
    };
    const analysis = analyzeExecutableSkillSource(sourceAnalysisRequest);
    const imports = analysis.moduleSpecifiers;
    for (const specifier of imports) {
      importEdges += 1;
      if (importEdges > EXECUTABLE_SKILL_CLOSURE_LIMITS.edges) {
        throw new Error(
          'Executable skill closure exceeds its import edge limit.',
        );
      }
      if (!specifier.startsWith('.')) {
        if (!specifier.startsWith('node:')) {
          externalPackages.add(packageName(specifier));
        }
        continue;
      }
      const importRequest: ResolveLocalImportRequest = {
        importer: relativePath,
        specifier,
      };
      pending.push(resolveLocalImport(importRequest));
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
  assertClosureFileCount(sources.size + 3);
  const packageBytesRequest: BoundedClosureBytesRequest = {
    current: aggregateBytes,
    content: packageText,
  };
  aggregateBytes = boundedClosureBytes(packageBytesRequest);
  const lockBytesRequest: BoundedClosureBytesRequest = {
    current: aggregateBytes,
    content: lockText,
  };
  aggregateBytes = boundedClosureBytes(lockBytesRequest);
  const manifestBytesRequest: BoundedClosureBytesRequest = {
    current: aggregateBytes,
    content: manifestText,
  };
  boundedClosureBytes(manifestBytesRequest);
  const frozenManifest = decodeExecutableSkillManifest(manifestText);
  if (
    JSON.stringify(frozenManifest) !==
    JSON.stringify(request.definition.manifest)
  ) {
    throw new Error(
      'Executable skill frozen manifest differs from its static registration.',
    );
  }
  const declaredPackagesRequest: AssertDeclaredPackagesRequest = {
    externalPackages,
    packageText,
  };
  assertDeclaredPackages(declaredPackagesRequest);
  const closureFiles = new Map(sources);
  closureFiles.set(PACKAGE_PATH, packageText);
  closureFiles.set(LOCK_PATH, lockText);
  closureFiles.set(request.definition.manifestPath, manifestText);
  const closureSha256 = closureDigest(closureFiles);
  const contextDirectory = await mkdtemp(
    path.join(tmpdir(), 'nook-skill-closure-'),
  );
  try {
    for (const [relativePath, content] of closureFiles) {
      assertClosureActive(request);
      const contextPath = contextRelativePath(relativePath);
      const absolutePath = path.join(contextDirectory, contextPath);
      await mkdir(path.dirname(absolutePath), DIRECTORY_OPTIONS);
      await writeFile(absolutePath, content, 'utf8');
    }
    const runnerImagePath = `/skills/${contextRelativePath(
      request.definition.runnerPath,
    )}`;
    return {
      closureSha256,
      contextDirectory,
      runnerImagePath,
      sourceTree,
      dispose: () => rmSync(contextDirectory, REMOVE_OPTIONS),
    };
  } catch (error) {
    rmSync(contextDirectory, REMOVE_OPTIONS);
    throw error;
  }
}

async function writeIndexTree(
  request: MaterializeSkillClosureInternalRequest,
): Promise<string> {
  const gitRequest: RunClosureGitRequest = {
    arguments: ['write-tree'],
    deadlineExpiresAt: request.deadlineExpiresAt,
    maximumBytes: 1024,
    repositoryRoot: request.repositoryRoot,
    signal: request.signal,
  };
  const tree = (await runClosureGit(gitRequest)).trim();
  if (!TREE_HASH.test(tree)) {
    throw new Error('Executable skill source tree could not be frozen.');
  }
  return tree;
}

type ReadClosureFileRequest = ReadTreeFileRequest & ClosureActivity;

async function readClosureMetadata(
  request: ReadClosureFileRequest,
): Promise<string> {
  const content = await readTreeFile(request);
  await assertWorktreeMatches(request);
  return content;
}

async function readTreeFile(request: ReadClosureFileRequest): Promise<string> {
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

async function assertWorktreeMatches(
  request: ReadClosureFileRequest,
): Promise<void> {
  const indexed = await readTreeFile(request);
  assertClosureActive(request);
  const absolutePath = path.join(request.repositoryRoot, request.relativePath);
  let handle: FileHandle | false = false;
  let worktreeMatches = false;
  try {
    const flags =
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    handle = await open(absolutePath, flags);
    const stat = await handle.stat();
    assertClosureActive(request);
    if (stat.isFile() && stat.size <= EXECUTABLE_SKILL_CLOSURE_LIMITS.bytes) {
      const indexedBytes = Buffer.byteLength(indexed, 'utf8');
      const maximumBytes = Math.min(
        indexedBytes + 1,
        EXECUTABLE_SKILL_CLOSURE_LIMITS.bytes + 1,
      );
      const readRequest: ReadWorktreeDescriptorRequest = {
        handle,
        lifecycle: request,
        maximumBytes,
      };
      worktreeMatches = (await readWorktreeDescriptor(readRequest)) === indexed;
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
): Promise<string> {
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
  return content.subarray(0, offset).toString('utf8');
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
  try {
    const first = await Promise.race([completion, interruption.promise]);
    if ('interrupted' in first) {
      subprocess.kill(9);
      await subprocess.exited;
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
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = '';
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
      const decodeOptions = { stream: true } as const;
      output += decoder.decode(chunk.value, decodeOptions);
    }
    return output + decoder.decode();
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

function packageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    return specifier.split('/').slice(0, 2).join('/');
  }
  return specifier.split('/')[0] ?? specifier;
}

type AssertDeclaredPackagesRequest = {
  readonly externalPackages: ReadonlySet<string>;
  readonly packageText: string;
};

function assertDeclaredPackages(request: AssertDeclaredPackagesRequest): void {
  const transport = JSON.parse(request.packageText) as PackageTransport;
  const declared = transport.dependencies ?? {};
  for (const packageName of request.externalPackages) {
    if (!Object.hasOwn(declared, packageName)) {
      throw new Error(
        `Executable skill imports an undeclared runtime package: ${packageName}`,
      );
    }
  }
}

function contextRelativePath(relativePath: string): string {
  const prefix = '.agents/skills/';
  if (!relativePath.startsWith(prefix)) {
    throw new Error('Executable skill closure path is outside skills root.');
  }
  return relativePath.slice(prefix.length);
}

type ClosureDigestFiles = ReadonlyMap<string, string>;

function closureDigest(files: ClosureDigestFiles): string {
  const hash = createHash('sha256');
  for (const relativePath of [...files.keys()].sort()) {
    const content = files.get(relativePath);
    if (typeof content !== 'string') continue;
    hash.update(relativePath);
    hash.update('\0');
    hash.update(createHash('sha256').update(content).digest('hex'));
    hash.update('\n');
  }
  return hash.digest('hex');
}
