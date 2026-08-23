import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import {
  ExecutableSkillExecutionKind,
  ExecutableSkillHostResultContract,
  ExecutableSkillRegistryFindingCode,
} from './domain.ts';
import type {
  AuditExecutableSkillRegistryRequest,
  ExecutableSkillManifest,
  ExecutableSkillRegistryFinding,
  RegisteredExecutableSkill,
} from './domain.ts';
import {
  CORTEX_ARTICLE_RESULT_KIND,
  decodeCortexArticleResult,
} from './cortex-article-transport.ts';
import { materializeSkillClosure } from './closure.ts';
import { decodeExecutableSkillManifest } from './manifest-codec.ts';

const CORTEX_ARTICLE_POLICY =
  '.cortex/dynamic-skills/cortex-article-structure.md';
const GIT_TREE_HASH = /^[0-9a-f]{40}$/u;
const EXECUTABLE_MANIFEST_PATH =
  /^\.agents\/skills\/[a-z0-9][a-z0-9-]*\/executable-skill\.json$/u;
const MAXIMUM_EXECUTABLE_SKILL_MANIFESTS = 32;
const cortexArticleLimits = {
  requestBytes: 4 * 1024 * 1024,
  resultBytes: 1024 * 1024,
  timeoutMs: 120000,
};
const cortexArticleManifest: ExecutableSkillManifest = {
  schemaVersion: 1,
  id: 'cortex-article-structure',
  executionKind: ExecutableSkillExecutionKind.DockerReadOnly,
  requestKind: 'cortex-article-structure-audit-v1',
  resultKind: 'cortex-article-structure-findings-v1',
  policyPaths: Object.freeze([CORTEX_ARTICLE_POLICY]),
  limits: Object.freeze(cortexArticleLimits),
};
const CORTEX_ARTICLE_MANIFEST = Object.freeze(cortexArticleManifest);
const executableSkillEntries: readonly RegisteredExecutableSkill[] = [
  {
    skillId: 'cortex-article-structure',
    manifest: CORTEX_ARTICLE_MANIFEST,
    manifestPath:
      '.agents/skills/cortex-article-structure/executable-skill.json',
    resultContract: ExecutableSkillHostResultContract.CortexArticleStructureV1,
    runnerPath: '.agents/skills/cortex-article-structure/src/runner.ts',
  },
] as const;

export const MAXIMUM_REGISTERED_EXECUTABLE_SKILL_TIMEOUT_MS = Math.max(
  ...executableSkillEntries.map((entry) => entry.manifest.limits.timeoutMs),
);

export const EXECUTABLE_SKILL_REGISTRY: ReadonlyMap<
  string,
  RegisteredExecutableSkill
> = createExecutableSkillRegistry(executableSkillEntries);

export enum ExecutableSkillRegistryInspectionKind {
  Invalid = 'invalid',
  Verified = 'verified',
}

export type AuditedExecutableSkillRegistry = {
  readonly auditId: string;
};

export type ExecutableSkillRegistryInspection =
  | {
      readonly kind: ExecutableSkillRegistryInspectionKind.Invalid;
      readonly findings: readonly ExecutableSkillRegistryFinding[];
    }
  | {
      readonly kind: ExecutableSkillRegistryInspectionKind.Verified;
      readonly authority: AuditedExecutableSkillRegistry;
      readonly findings: readonly [];
    };

type AuditedExecutableSkillRegistryBinding = {
  readonly repositoryRoot: string;
  readonly sourceTree: string;
};

const auditedRegistryBindings = new WeakMap<
  AuditedExecutableSkillRegistry,
  AuditedExecutableSkillRegistryBinding
>();

export async function inspectExecutableSkillRegistry(
  request: AuditExecutableSkillRegistryRequest,
): Promise<ExecutableSkillRegistryInspection> {
  let repositoryRoot: string;
  try {
    repositoryRoot = await canonicalRepositoryRoot(request);
  } catch {
    assertRegistryActive(request);
    const finding: ExecutableSkillRegistryFinding = {
      code: ExecutableSkillRegistryFindingCode.UnsafeFile,
      skillId: 'registry',
      message: 'Executable skill repository root is not canonical.',
    };
    return {
      kind: ExecutableSkillRegistryInspectionKind.Invalid,
      findings: [finding],
    };
  }
  const auditRequest: AuditExecutableSkillRegistryRequest = {
    ...request,
    repositoryRoot,
  };
  const audit = await auditExecutableSkillRegistryCanonical(auditRequest);
  if (audit.findings.length > 0) {
    return {
      kind: ExecutableSkillRegistryInspectionKind.Invalid,
      findings: audit.findings,
    };
  }
  const authorityValue: AuditedExecutableSkillRegistry = {
    auditId: randomUUID(),
  };
  const authority = Object.freeze(authorityValue);
  const bindingValue: AuditedExecutableSkillRegistryBinding = {
    repositoryRoot,
    sourceTree: audit.sourceTree,
  };
  const binding = Object.freeze(bindingValue);
  auditedRegistryBindings.set(authority, binding);
  return {
    kind: ExecutableSkillRegistryInspectionKind.Verified,
    authority,
    findings: [],
  };
}

async function canonicalRepositoryRoot(
  request: AuditExecutableSkillRegistryRequest,
): Promise<string> {
  assertRegistryActive(request);
  const canonical = await realpath(request.repositoryRoot);
  const gitRequest: RunRegistryGitRequest = {
    arguments: ['rev-parse', '--show-toplevel'],
    deadlineExpiresAt: request.deadlineExpiresAt,
    repositoryRoot: canonical,
    signal: request.signal,
  };
  const discovered = await realpath((await runRegistryGit(gitRequest)).trim());
  if (canonical !== discovered) {
    throw new Error('Executable skill repository root must be canonical.');
  }
  return canonical;
}

export type ResolveAuditedExecutableSkillRepositoryRequest = {
  readonly authority: AuditedExecutableSkillRegistry;
  readonly deadlineExpiresAt: number;
  readonly signal: AbortSignal | false;
};

export type ResolvedAuditedExecutableSkillRepository = {
  readonly repositoryRoot: string;
  readonly sourceTree: string;
};

export async function resolveAuditedExecutableSkillRepository(
  request: ResolveAuditedExecutableSkillRepositoryRequest,
): Promise<ResolvedAuditedExecutableSkillRepository> {
  const binding = auditedRegistryBindings.get(request.authority);
  if (!binding) {
    throw new Error('Executable skill registry authority is invalid.');
  }
  const treeRequest: AuditExecutableSkillRegistryRequest = {
    deadlineExpiresAt: request.deadlineExpiresAt,
    repositoryRoot: binding.repositoryRoot,
    signal: request.signal,
  };
  if ((await writeFrozenRegistryTree(treeRequest)) !== binding.sourceTree) {
    throw new Error(
      'Executable skill registry source tree changed after authorization.',
    );
  }
  return binding;
}

export type ValidateRegisteredExecutableSkillResultRequest = {
  readonly registration: RegisteredExecutableSkill;
  readonly serializedResult: string;
};

export function validateRegisteredExecutableSkillResult(
  request: ValidateRegisteredExecutableSkillResultRequest,
): void {
  switch (request.registration.resultContract) {
    case ExecutableSkillHostResultContract.CortexArticleStructureV1: {
      if (
        request.registration.manifest.resultKind !== CORTEX_ARTICLE_RESULT_KIND
      ) {
        throw new Error('Executable skill host result contract kind mismatch.');
      }
      decodeCortexArticleResult(request.serializedResult);
      return;
    }
    default:
      throw new Error('Executable skill host result contract is unsupported.');
  }
}

export async function auditExecutableSkillRegistry(
  request: AuditExecutableSkillRegistryRequest,
): Promise<readonly ExecutableSkillRegistryFinding[]> {
  try {
    const repositoryRoot = await canonicalRepositoryRoot(request);
    const canonicalRequest: AuditExecutableSkillRegistryRequest = {
      ...request,
      repositoryRoot,
    };
    return (await auditExecutableSkillRegistryCanonical(canonicalRequest))
      .findings;
  } catch {
    assertRegistryActive(request);
    return [unsafeRegistryRootFinding()];
  }
}

async function auditExecutableSkillRegistryCanonical(
  request: AuditExecutableSkillRegistryRequest,
): Promise<ExecutableSkillRegistryAudit> {
  assertRegistryActive(request);
  const discovery = await discoverManifestPaths(request);
  const manifestPaths = discovery.manifestPaths;
  const driftRequest: WorktreeManifestDriftRequest = {
    ...request,
    frozenManifestPaths: manifestPaths,
    sourceTree: discovery.sourceTree,
  };
  const findings = await worktreeManifestDriftFindings(driftRequest);
  const discoveredIds = new Set<string>();
  for (const manifestPath of manifestPaths) {
    assertRegistryActive(request);
    const segments = manifestPath.split('/');
    const skillId = segments.at(-2);
    if (typeof skillId !== 'string') continue;
    discoveredIds.add(skillId);
    const registration = EXECUTABLE_SKILL_REGISTRY.get(skillId);
    if (!registration) {
      const finding: ExecutableSkillRegistryFinding = {
        code: ExecutableSkillRegistryFindingCode.MissingRegistration,
        skillId,
        message: 'Executable skill manifest has no static registration.',
      };
      findings.push(finding);
      continue;
    }
    if (registration.manifestPath !== manifestPath) {
      const finding: ExecutableSkillRegistryFinding = {
        code: ExecutableSkillRegistryFindingCode.InvalidManifest,
        skillId,
        message: 'Executable skill manifest path differs from registration.',
      };
      findings.push(finding);
      continue;
    }
    const registrationRequest: AuditRegistrationRequest = {
      registration,
      sourceTree: discovery.sourceTree,
      ...request,
    };
    findings.push(...(await auditRegistration(registrationRequest)));
  }
  for (const skillId of EXECUTABLE_SKILL_REGISTRY.keys()) {
    if (discoveredIds.has(skillId)) continue;
    const finding: ExecutableSkillRegistryFinding = {
      code: ExecutableSkillRegistryFindingCode.UnexpectedRegistration,
      skillId,
      message: 'Registered executable skill has no manifest.',
    };
    findings.push(finding);
  }
  return {
    findings,
    sourceTree: discovery.sourceTree,
  };
}

type ExecutableSkillRegistryAudit = {
  readonly findings: ExecutableSkillRegistryFinding[];
  readonly sourceTree: string;
};

type AuditRegistrationRequest = AuditExecutableSkillRegistryRequest & {
  readonly registration: RegisteredExecutableSkill;
  readonly sourceTree: string;
};

async function auditRegistration(
  request: AuditRegistrationRequest,
): Promise<readonly ExecutableSkillRegistryFinding[]> {
  const manifestGitRequest: RunRegistryGitRequest = {
    arguments: [
      'show',
      `${request.sourceTree}:${request.registration.manifestPath}`,
    ],
    deadlineExpiresAt: request.deadlineExpiresAt,
    repositoryRoot: request.repositoryRoot,
    signal: request.signal,
  };
  try {
    const manifest = decodeExecutableSkillManifest(
      await runRegistryGit(manifestGitRequest),
    );
    if (
      JSON.stringify(manifest) !== JSON.stringify(request.registration.manifest)
    ) {
      throw new Error('Executable skill manifest registration drift.');
    }
  } catch {
    assertRegistryActive(request);
    const finding: ExecutableSkillRegistryFinding = {
      code: ExecutableSkillRegistryFindingCode.InvalidManifest,
      skillId: request.registration.skillId,
      message: 'Executable skill staged manifest is invalid or drifted.',
    };
    return [finding];
  }
  for (const policyPath of request.registration.manifest.policyPaths) {
    const boundRequest: AuditBoundFileRequest = {
      ...request,
      relativePath: policyPath,
      skillId: request.registration.skillId,
    };
    if (!(await isBoundFileSafe(boundRequest))) {
      return [unsafeBoundFileFinding(boundRequest)];
    }
  }
  const closureRequest = {
    deadlineExpiresAt: request.deadlineExpiresAt,
    definition: request.registration,
    repositoryRoot: request.repositoryRoot,
    signal: request.signal,
    sourceTree: request.sourceTree,
  };
  try {
    const closure = await materializeSkillClosure(closureRequest);
    closure.dispose();
    return [];
  } catch (error) {
    assertRegistryActive(request);
    const message = error instanceof Error ? error.message : '';
    const code = message.includes('forbid')
      ? ExecutableSkillRegistryFindingCode.UnsafeCapability
      : message.includes('manifest') ||
          message.includes(request.registration.manifestPath)
        ? ExecutableSkillRegistryFindingCode.InvalidManifest
        : ExecutableSkillRegistryFindingCode.UnsafeFile;
    const finding: ExecutableSkillRegistryFinding = {
      code,
      skillId: request.registration.skillId,
      message: `Executable skill closure audit failed: ${message}`,
    };
    return [finding];
  }
}

async function discoverManifestPaths(
  request: AuditExecutableSkillRegistryRequest,
): Promise<FrozenManifestDiscovery> {
  const sourceTree = await writeFrozenRegistryTree(request);
  const listTreeRequest: RunRegistryGitRequest = {
    arguments: [
      'ls-tree',
      '-r',
      '--name-only',
      '-z',
      sourceTree,
      '--',
      '.agents/skills',
    ],
    deadlineExpiresAt: request.deadlineExpiresAt,
    repositoryRoot: request.repositoryRoot,
    signal: request.signal,
  };
  const treePaths = (await runRegistryGit(listTreeRequest)).split('\0');
  const manifestPaths = treePaths.filter((candidate) =>
    EXECUTABLE_MANIFEST_PATH.test(candidate),
  );
  if (manifestPaths.length > MAXIMUM_EXECUTABLE_SKILL_MANIFESTS) {
    throw new Error('Executable skill manifest count exceeds its bound.');
  }
  return {
    sourceTree,
    manifestPaths: manifestPaths.sort(),
  };
}

async function writeFrozenRegistryTree(
  request: AuditExecutableSkillRegistryRequest,
): Promise<string> {
  const writeTreeRequest: RunRegistryGitRequest = {
    arguments: ['write-tree'],
    deadlineExpiresAt: request.deadlineExpiresAt,
    repositoryRoot: request.repositoryRoot,
    signal: request.signal,
  };
  const sourceTree = (await runRegistryGit(writeTreeRequest)).trim();
  if (!GIT_TREE_HASH.test(sourceTree)) {
    throw new Error(
      'Executable skill manifest index tree could not be frozen.',
    );
  }
  return sourceTree;
}

type FrozenManifestDiscovery = {
  readonly sourceTree: string;
  readonly manifestPaths: readonly string[];
};

type WorktreeManifestDriftRequest = AuditExecutableSkillRegistryRequest & {
  readonly frozenManifestPaths: readonly string[];
  readonly sourceTree: string;
};

async function worktreeManifestDriftFindings(
  request: WorktreeManifestDriftRequest,
): Promise<ExecutableSkillRegistryFinding[]> {
  const frozenPaths = new Set(request.frozenManifestPaths);
  const candidatePaths = new Set([
    ...request.frozenManifestPaths,
    ...[...EXECUTABLE_SKILL_REGISTRY.values()].map(
      (registration) => registration.manifestPath,
    ),
  ]);
  const driftedPaths = new Set<string>();
  for (const manifestPath of candidatePaths) {
    assertRegistryActive(request);
    if (!frozenPaths.has(manifestPath)) {
      const worktreeRequest: ManifestWorktreePathRequest = {
        ...request,
        manifestPath,
      };
      if (await manifestExistsInWorktree(worktreeRequest)) {
        driftedPaths.add(manifestPath);
      }
      continue;
    }
    const contentRequest: ManifestContentDriftRequest = {
      ...request,
      manifestPath,
    };
    if (await manifestContentDrifted(contentRequest)) {
      driftedPaths.add(manifestPath);
    }
  }
  return [...driftedPaths].sort().map((manifestPath) => ({
    code: ExecutableSkillRegistryFindingCode.WorktreeDrift,
    skillId: manifestPath.split('/').at(-2) ?? 'registry',
    message: `Executable skill manifest differs between the frozen index and worktree: ${manifestPath}`,
  }));
}

type ManifestWorktreePathRequest = AuditExecutableSkillRegistryRequest & {
  readonly manifestPath: string;
};

type ManifestContentDriftRequest = ManifestWorktreePathRequest & {
  readonly sourceTree: string;
};

async function manifestExistsInWorktree(
  request: ManifestWorktreePathRequest,
): Promise<boolean> {
  try {
    const absolutePath = path.join(
      request.repositoryRoot,
      request.manifestPath,
    );
    await lstat(absolutePath);
    assertRegistryActive(request);
    return true;
  } catch {
    assertRegistryActive(request);
    return false;
  }
}

async function manifestContentDrifted(
  request: ManifestContentDriftRequest,
): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | false = false;
  try {
    assertRegistryActive(request);
    const absolutePath = path.join(
      request.repositoryRoot,
      request.manifestPath,
    );
    const flags =
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    handle = await open(absolutePath, flags);
    const stat = await handle.stat();
    assertRegistryActive(request);
    if (!stat.isFile() || stat.size > 16 * 1024) {
      return true;
    }
    const gitRequest: RunRegistryGitRequest = {
      arguments: ['show', `${request.sourceTree}:${request.manifestPath}`],
      deadlineExpiresAt: request.deadlineExpiresAt,
      repositoryRoot: request.repositoryRoot,
      signal: request.signal,
    };
    const frozenContent = await runRegistryGit(gitRequest);
    const descriptorRequest: ReadManifestDescriptorRequest = {
      handle,
      lifecycle: request,
    };
    const worktreeContent = await readManifestDescriptor(descriptorRequest);
    assertRegistryActive(request);
    return frozenContent !== worktreeContent;
  } catch {
    assertRegistryActive(request);
    return true;
  } finally {
    if (handle !== false) await handle.close();
  }
}

type ReadManifestDescriptorRequest = {
  readonly handle: FileHandle;
  readonly lifecycle: AuditExecutableSkillRegistryRequest;
};

async function readManifestDescriptor(
  request: ReadManifestDescriptorRequest,
): Promise<string> {
  const maximumBytes = 16 * 1024;
  const content = Buffer.alloc(maximumBytes + 1);
  let offset = 0;
  while (offset < content.byteLength) {
    assertRegistryActive(request.lifecycle);
    const readResult = await request.handle.read(
      content,
      offset,
      content.byteLength - offset,
      offset,
    );
    assertRegistryActive(request.lifecycle);
    if (readResult.bytesRead === 0) break;
    offset += readResult.bytesRead;
  }
  if (offset > maximumBytes) {
    throw new Error('Executable skill worktree manifest exceeds its bound.');
  }
  return content.subarray(0, offset).toString('utf8');
}

type AuditBoundFileRequest = AuditExecutableSkillRegistryRequest & {
  readonly relativePath: string;
  readonly skillId: string;
};

async function isBoundFileSafe(
  request: AuditBoundFileRequest,
): Promise<boolean> {
  try {
    assertRegistryActive(request);
    const absolutePath = path.join(
      request.repositoryRoot,
      request.relativePath,
    );
    const resolvedRoot = `${await realpath(request.repositoryRoot)}${path.sep}`;
    const resolvedPath = await realpath(absolutePath);
    const stat = await lstat(absolutePath);
    if (
      !resolvedPath.startsWith(resolvedRoot) ||
      stat.isSymbolicLink() ||
      !stat.isFile()
    ) {
      return false;
    }
    const gitRequest: RunRegistryGitRequest = {
      arguments: ['ls-files', '--error-unmatch', '--', request.relativePath],
      deadlineExpiresAt: request.deadlineExpiresAt,
      repositoryRoot: request.repositoryRoot,
      signal: request.signal,
    };
    return (await runRegistryGit(gitRequest)).trim() === request.relativePath;
  } catch {
    assertRegistryActive(request);
    return false;
  }
}

function unsafeBoundFileFinding(
  request: AuditBoundFileRequest,
): ExecutableSkillRegistryFinding {
  return {
    code: ExecutableSkillRegistryFindingCode.UnsafeFile,
    skillId: request.skillId,
    message: `Executable skill policy is not a tracked regular file: ${request.relativePath}`,
  };
}

function unsafeRegistryRootFinding(): ExecutableSkillRegistryFinding {
  return {
    code: ExecutableSkillRegistryFindingCode.UnsafeFile,
    skillId: 'registry',
    message: 'Executable skill repository root is unsafe or audit expired.',
  };
}

function assertRegistryActive(
  request: AuditExecutableSkillRegistryRequest,
): void {
  if (request.signal !== false && request.signal.aborted) {
    throw new Error('Executable skill registry audit was cancelled.');
  }
  if (Date.now() >= request.deadlineExpiresAt) {
    throw new Error('Executable skill registry audit deadline expired.');
  }
}

type RunRegistryGitRequest = AuditExecutableSkillRegistryRequest & {
  readonly arguments: readonly string[];
};

async function runRegistryGit(request: RunRegistryGitRequest): Promise<string> {
  assertRegistryActive(request);
  const options = {
    cwd: request.repositoryRoot,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin' },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  } as const;
  const subprocess = Bun.spawn(['git', ...request.arguments], options);
  const output = readRegistryStream(subprocess.stdout);
  const errors = readRegistryStream(subprocess.stderr);
  const interruption = waitForRegistryInterruption(request);
  try {
    const completion = subprocess.exited.then((exitCode) => ({ exitCode }));
    const first = await Promise.race([completion, interruption.promise]);
    if (first === 'interrupted') {
      subprocess.kill(9);
      await subprocess.exited;
      await Promise.allSettled([output, errors]);
      throw new Error('Executable skill registry audit was interrupted.');
    }
    const stdout = await output;
    const stderr = await errors;
    if (first.exitCode !== 0) {
      throw new Error(stderr || 'Executable skill registry Git audit failed.');
    }
    return stdout;
  } finally {
    interruption.dispose();
    if (typeof subprocess.exitCode !== 'number') subprocess.kill(9);
    await subprocess.exited;
  }
}

type RegistryInterruption = {
  readonly dispose: () => void;
  readonly promise: Promise<'interrupted'>;
};

function waitForRegistryInterruption(
  request: AuditExecutableSkillRegistryRequest,
): RegistryInterruption {
  let listener: (() => void) | false = false;
  let timer: ReturnType<typeof setTimeout> | false = false;
  const promise = new Promise<'interrupted'>((resolve) => {
    const remaining = Math.max(0, request.deadlineExpiresAt - Date.now());
    timer = setTimeout(resolve, remaining, 'interrupted');
    if (request.signal !== false) {
      if (request.signal.aborted) {
        resolve('interrupted');
        return;
      }
      listener = () => resolve('interrupted');
      request.signal.addEventListener('abort', listener);
    }
  });
  return {
    promise,
    dispose: () => {
      if (timer !== false) clearTimeout(timer);
      if (request.signal !== false && listener !== false) {
        request.signal.removeEventListener('abort', listener);
      }
    },
  };
}

async function readRegistryStream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16 * 1024) {
        await reader.cancel();
        throw new Error(
          'Executable skill registry Git output exceeded its bound.',
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

function createExecutableSkillRegistry(
  entries: readonly RegisteredExecutableSkill[],
): ReadonlyMap<string, RegisteredExecutableSkill> {
  const registry = new Map<string, RegisteredExecutableSkill>();
  for (const entry of entries) {
    if (registry.has(entry.skillId)) {
      throw new Error(`Duplicate executable skill ID: ${entry.skillId}`);
    }
    registry.set(entry.skillId, Object.freeze(entry));
  }
  return registry;
}
