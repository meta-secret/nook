import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { ExecutableSkillRegistryFindingCode } from './domain.ts';
import type {
  AuditExecutableSkillRegistryRequest,
  ExecutableSkillClosurePlan,
  ExecutableSkillRegistryFinding,
  RegisteredExecutableSkill,
} from './domain.ts';
import {
  ExecutableSkillClosureAuditError,
  type ExecutableSkillClosureCandidate,
  isExecutableSkillClosurePlanSealed,
  planExecutableSkillClosure,
  type PlanExecutableSkillClosureRequest,
} from './closure.ts';
import { decodeExecutableSkillManifest } from './manifest-codec.ts';
import {
  createExecutableSkillRegistry,
  ExecutableSkillRegistrationError,
  findRegisteredExecutableSkill,
  MAXIMUM_EXECUTABLE_SKILL_REGISTRATIONS,
  sameExecutableSkillManifest,
} from './registration.ts';
import type { ExecutableSkillRegistry } from './registration.ts';
import type { SealedSourceAnalysisDockerEnvironment } from './source-analysis-docker.ts';
import {
  isBoundPolicyFileSafe,
  type AuditBoundPolicyFileRequest,
} from './policy-file-binding.ts';

const GIT_TREE_HASH = /^[0-9a-f]{40}$/u;
const EXECUTABLE_MANIFEST_PATH =
  /^\.agents\/skills\/[a-z0-9][a-z0-9-]*\/executable-skill\.json$/u;
const MAXIMUM_EXECUTABLE_SKILL_MANIFESTS =
  MAXIMUM_EXECUTABLE_SKILL_REGISTRATIONS;
const MAXIMUM_EXECUTABLE_SKILL_MANIFEST_PATH_BYTES = 4096;
const executableSkillEntries: readonly RegisteredExecutableSkill[] = [];

export const MAXIMUM_REGISTERED_EXECUTABLE_SKILL_TIMEOUT_MS = Math.max(
  0,
  ...executableSkillEntries.map((entry) => entry.manifest.limits.timeoutMs),
);

const executableRegistryRequest = {
  assertActive: false as const,
  entries: executableSkillEntries,
};
const EXECUTABLE_SKILL_REGISTRY = createExecutableSkillRegistry(
  executableRegistryRequest,
);

export type ExecutableSkillRegistryAuditRequest =
  AuditExecutableSkillRegistryRequest & {
    readonly dockerEnvironment: SealedSourceAnalysisDockerEnvironment;
  };

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
  readonly skills: readonly ResolvedAuditedExecutableSkill[];
  readonly sourceTree: string;
};

const auditedRegistryBindings = new WeakMap<
  AuditedExecutableSkillRegistry,
  AuditedExecutableSkillRegistryBinding
>();

export async function inspectExecutableSkillRegistry(
  request: ExecutableSkillRegistryAuditRequest,
): Promise<ExecutableSkillRegistryInspection> {
  let repositoryRoot: string;
  try {
    repositoryRoot = await canonicalRepositoryRoot(request);
  } catch {
    assertRegistryActive(request);
    const finding: ExecutableSkillRegistryFinding = {
      code: ExecutableSkillRegistryFindingCode.UnsafeFile,
      skillId: 'registry',
      path: '.agents/skills',
      message: 'Executable skill repository root is not canonical.',
    };
    return {
      kind: ExecutableSkillRegistryInspectionKind.Invalid,
      findings: [finding],
    };
  }
  const auditRequest: ExecutableSkillRegistryAuditRequest = {
    ...request,
    repositoryRoot,
  };
  const canonicalAuditRequest: AuditExecutableSkillRegistryCanonicalRequest = {
    ...auditRequest,
    collectAuthority: true,
    planClosure: planExecutableSkillClosure,
    registry: EXECUTABLE_SKILL_REGISTRY,
  };
  const audit = await auditExecutableSkillRegistryCanonical(
    canonicalAuditRequest,
  );
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
    skills: Object.freeze([...audit.skills]),
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

export type ResolveAuditedExecutableSkillRequest = {
  readonly authority: AuditedExecutableSkillRegistry;
  readonly deadlineExpiresAt: number;
  readonly signal: AbortSignal | false;
  readonly skillId: string;
};

export type ResolvedAuditedExecutableSkill = {
  readonly closurePlan: ExecutableSkillClosurePlan;
  readonly registration: RegisteredExecutableSkill;
};

export function resolveAuditedExecutableSkill(
  request: ResolveAuditedExecutableSkillRequest,
): ResolvedAuditedExecutableSkill {
  assertRegistryResolutionActive(request);
  const binding = auditedRegistryBindings.get(request.authority);
  if (!binding) {
    throw new Error('Executable skill registry authority is invalid.');
  }
  const skill = binding.skills.find(
    (candidate) => candidate.registration.skillId === request.skillId,
  );
  if (!skill) {
    throw new Error(`Unregistered executable skill: ${request.skillId}`);
  }
  return skill;
}

export async function auditExecutableSkillRegistry(
  request: ExecutableSkillRegistryAuditRequest,
): Promise<readonly ExecutableSkillRegistryFinding[]> {
  try {
    const repositoryRoot = await canonicalRepositoryRoot(request);
    const canonicalRequest: ExecutableSkillRegistryAuditRequest = {
      ...request,
      repositoryRoot,
    };
    const auditRequest: AuditExecutableSkillRegistryCanonicalRequest = {
      ...canonicalRequest,
      collectAuthority: false,
      planClosure: planExecutableSkillClosure,
      registry: EXECUTABLE_SKILL_REGISTRY,
    };
    return (await auditExecutableSkillRegistryCanonical(auditRequest)).findings;
  } catch {
    assertRegistryActive(request);
    return [unsafeRegistryRootFinding()];
  }
}

export type AuditExecutableSkillCatalogRequest =
  ExecutableSkillRegistryAuditRequest & {
    readonly registrations: readonly RegisteredExecutableSkill[];
  };

export type ExecutableSkillClosureCandidatePlanner = (
  request: PlanExecutableSkillClosureRequest,
) => Promise<ExecutableSkillClosureCandidate>;

export type ExecutableSkillCatalogAuditDependencies = {
  readonly planClosure: ExecutableSkillClosureCandidatePlanner;
};

export type AuditExecutableSkillCatalogWithDependenciesRequest = {
  readonly dependencies: ExecutableSkillCatalogAuditDependencies;
  readonly request: AuditExecutableSkillCatalogRequest;
};

export async function auditExecutableSkillCatalog(
  request: AuditExecutableSkillCatalogRequest,
): Promise<readonly ExecutableSkillRegistryFinding[]> {
  const dependencies: ExecutableSkillCatalogAuditDependencies = {
    planClosure: planExecutableSkillClosure,
  };
  const execution: AuditExecutableSkillCatalogWithDependenciesRequest = {
    dependencies,
    request,
  };
  return await auditExecutableSkillCatalogWithDependencies(execution);
}

export async function auditExecutableSkillCatalogWithDependencies(
  execution: AuditExecutableSkillCatalogWithDependenciesRequest,
): Promise<readonly ExecutableSkillRegistryFinding[]> {
  const request = execution.request;
  assertRegistryActive(request);
  let registry: ExecutableSkillRegistry;
  try {
    const registryRequest = {
      assertActive: () => assertRegistryActive(request),
      entries: request.registrations,
    };
    registry = createExecutableSkillRegistry(registryRequest);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const invalidRegistration =
      error instanceof ExecutableSkillRegistrationError ? error : false;
    const finding: ExecutableSkillRegistryFinding = {
      code:
        invalidRegistration === false
          ? ExecutableSkillRegistryFindingCode.DuplicateId
          : ExecutableSkillRegistryFindingCode.InvalidManifest,
      skillId:
        invalidRegistration === false
          ? 'registry'
          : invalidRegistration.skillId,
      path:
        invalidRegistration === false
          ? '.agents/skills'
          : invalidRegistration.path,
      message,
    };
    return [finding];
  }
  try {
    const repositoryRoot = await canonicalRepositoryRoot(request);
    const auditRequest: AuditExecutableSkillRegistryCanonicalRequest = {
      ...request,
      collectAuthority: false,
      planClosure: execution.dependencies.planClosure,
      registry,
      repositoryRoot,
    };
    return (await auditExecutableSkillRegistryCanonical(auditRequest)).findings;
  } catch {
    assertRegistryActive(request);
    return [unsafeRegistryRootFinding()];
  }
}

type AuditExecutableSkillRegistryCanonicalRequest =
  ExecutableSkillRegistryAuditRequest & {
    readonly collectAuthority: boolean;
    readonly planClosure: ExecutableSkillClosureCandidatePlanner;
    readonly registry: ExecutableSkillRegistry;
  };

async function auditExecutableSkillRegistryCanonical(
  request: AuditExecutableSkillRegistryCanonicalRequest,
): Promise<ExecutableSkillRegistryAudit> {
  assertRegistryActive(request);
  const discovery = await discoverManifestPaths(request);
  const manifestPaths = discovery.manifestPaths;
  const driftRequest: WorktreeManifestDriftRequest = {
    ...request,
    frozenManifestPaths: manifestPaths,
    registry: request.registry,
    sourceTree: discovery.sourceTree,
  };
  const findings = await worktreeManifestDriftFindings(driftRequest);
  const skills: ResolvedAuditedExecutableSkill[] = [];
  const discoveredIds = new Set<string>();
  for (const manifestPath of manifestPaths) {
    assertRegistryActive(request);
    const segments = manifestPath.split('/');
    const skillId = segments.at(-2);
    if (typeof skillId !== 'string') continue;
    discoveredIds.add(skillId);
    const registrationLookup = { registry: request.registry, skillId };
    const registration = findRegisteredExecutableSkill(registrationLookup);
    if (!registration) {
      const finding: ExecutableSkillRegistryFinding = {
        code: ExecutableSkillRegistryFindingCode.MissingRegistration,
        skillId,
        path: manifestPath,
        message: 'Executable skill manifest has no static registration.',
      };
      findings.push(finding);
      continue;
    }
    if (registration.manifestPath !== manifestPath) {
      const finding: ExecutableSkillRegistryFinding = {
        code: ExecutableSkillRegistryFindingCode.InvalidManifest,
        skillId,
        path: manifestPath,
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
    const registrationAudit = await auditRegistration(registrationRequest);
    findings.push(...registrationAudit.findings);
    if (registrationAudit.skill !== false) {
      skills.push(registrationAudit.skill);
    }
  }
  for (const registration of request.registry) {
    if (discoveredIds.has(registration.skillId)) continue;
    const finding: ExecutableSkillRegistryFinding = {
      code: ExecutableSkillRegistryFindingCode.UnexpectedRegistration,
      skillId: registration.skillId,
      path: registration.manifestPath,
      message: 'Registered executable skill has no manifest.',
    };
    findings.push(finding);
  }
  return {
    findings,
    skills,
    sourceTree: discovery.sourceTree,
  };
}

type ExecutableSkillRegistryAudit = {
  readonly findings: ExecutableSkillRegistryFinding[];
  readonly skills: ResolvedAuditedExecutableSkill[];
  readonly sourceTree: string;
};

type AuditRegistrationRequest = ExecutableSkillRegistryAuditRequest & {
  readonly collectAuthority: boolean;
  readonly planClosure: ExecutableSkillClosureCandidatePlanner;
  readonly registration: RegisteredExecutableSkill;
  readonly sourceTree: string;
};

async function auditRegistration(
  request: AuditRegistrationRequest,
): Promise<AuditRegistrationResult> {
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
    const manifestComparisonRequest = {
      left: manifest,
      right: request.registration.manifest,
    };
    if (!sameExecutableSkillManifest(manifestComparisonRequest)) {
      throw new Error('Executable skill manifest registration drift.');
    }
  } catch {
    assertRegistryActive(request);
    const finding: ExecutableSkillRegistryFinding = {
      code: ExecutableSkillRegistryFindingCode.InvalidManifest,
      skillId: request.registration.skillId,
      path: request.registration.manifestPath,
      message: 'Executable skill staged manifest is invalid or drifted.',
    };
    return { findings: [finding], skill: false };
  }
  for (const policyPath of request.registration.manifest.policyPaths) {
    const boundRequest: AuditBoundPolicyFileRequest = {
      ...request,
      relativePath: policyPath,
      runGit: runRegistryGit,
      skillId: request.registration.skillId,
    };
    if (!(await isBoundPolicyFileSafe(boundRequest))) {
      return { findings: [unsafeBoundFileFinding(boundRequest)], skill: false };
    }
  }
  const closureRequest = {
    deadlineExpiresAt: request.deadlineExpiresAt,
    definition: request.registration,
    dockerEnvironment: request.dockerEnvironment,
    repositoryRoot: request.repositoryRoot,
    signal: request.signal,
    sourceTree: request.sourceTree,
  };
  try {
    const closurePlan = await request.planClosure(closureRequest);
    if (
      request.collectAuthority &&
      !isExecutableSkillClosurePlanSealed(closurePlan)
    ) {
      throw new Error('Executable skill closure plan authority is unsealed.');
    }
    if (!request.collectAuthority) {
      return { findings: [], skill: false };
    }
    const skill: ResolvedAuditedExecutableSkill = {
      closurePlan,
      registration: request.registration,
    };
    return {
      findings: [],
      skill: Object.freeze(skill),
    };
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
      path:
        error instanceof ExecutableSkillClosureAuditError
          ? error.relativePath
          : request.registration.manifestPath,
      message: `Executable skill closure audit failed: ${message}`,
    };
    return { findings: [finding], skill: false };
  }
}

type AuditRegistrationResult = {
  readonly findings: readonly ExecutableSkillRegistryFinding[];
  readonly skill: ResolvedAuditedExecutableSkill | false;
};

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
    manifestDiscovery: true,
  };
  const treePaths = (await runRegistryGit(listTreeRequest)).split('\0');
  const manifestPaths = treePaths.filter((candidate) =>
    EXECUTABLE_MANIFEST_PATH.test(candidate),
  );
  if (
    manifestPaths.some(
      (manifestPath) =>
        Buffer.byteLength(manifestPath, 'utf8') + 1 >
        MAXIMUM_EXECUTABLE_SKILL_MANIFEST_PATH_BYTES,
    )
  ) {
    throw new Error('Executable skill manifest path exceeds its bound.');
  }
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
  readonly registry: ExecutableSkillRegistry;
  readonly sourceTree: string;
};

async function worktreeManifestDriftFindings(
  request: WorktreeManifestDriftRequest,
): Promise<ExecutableSkillRegistryFinding[]> {
  const frozenPaths = new Set(request.frozenManifestPaths);
  const candidatePaths = new Set([
    ...request.frozenManifestPaths,
    ...request.registry.map((registration) => registration.manifestPath),
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
    path: manifestPath,
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
      maximumBytes: 16 * 1024 + 1,
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
  readonly maximumBytes: number;
};

async function readManifestDescriptor(
  request: ReadManifestDescriptorRequest,
): Promise<string> {
  const maximumBytes = 16 * 1024;
  const descriptorRequest: ReadManifestDescriptorRequest = {
    ...request,
    maximumBytes: maximumBytes + 1,
  };
  const content = await readDescriptorBytes(descriptorRequest);
  if (content.byteLength > maximumBytes) {
    throw new Error('Executable skill worktree manifest exceeds its bound.');
  }
  return content.toString('utf8');
}

async function readDescriptorBytes(
  request: ReadManifestDescriptorRequest,
): Promise<Buffer> {
  const content = Buffer.alloc(request.maximumBytes);
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
  return content.subarray(0, offset);
}

function unsafeBoundFileFinding(
  request: AuditBoundPolicyFileRequest,
): ExecutableSkillRegistryFinding {
  return {
    code: ExecutableSkillRegistryFindingCode.UnsafeFile,
    skillId: request.skillId,
    path: request.relativePath,
    message: `Executable skill policy is not a tracked regular file: ${request.relativePath}`,
  };
}

function unsafeRegistryRootFinding(): ExecutableSkillRegistryFinding {
  return {
    code: ExecutableSkillRegistryFindingCode.UnsafeFile,
    skillId: 'registry',
    path: '.agents/skills',
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

function assertRegistryResolutionActive(
  request: ResolveAuditedExecutableSkillRequest,
): void {
  if (request.signal !== false && request.signal.aborted) {
    throw new Error('Executable skill registry resolution was cancelled.');
  }
  if (Date.now() >= request.deadlineExpiresAt) {
    throw new Error('Executable skill registry resolution deadline expired.');
  }
}

type RunRegistryGitRequest = AuditExecutableSkillRegistryRequest & {
  readonly arguments: readonly string[];
  readonly manifestDiscovery?: true;
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
  const stdoutRequest: ReadRegistryStreamRequest = {
    maximumBytes: 16 * 1024,
    stream: subprocess.stdout,
  };
  const stderrRequest: ReadRegistryStreamRequest = {
    maximumBytes: 16 * 1024,
    stream: subprocess.stderr,
  };
  const output =
    request.manifestDiscovery === true
      ? readManifestDiscoveryStream(subprocess.stdout)
      : readRegistryStream(stdoutRequest);
  const errors = readRegistryStream(stderrRequest);
  const streamFailure = Promise.race([
    waitForRegistryStreamFailure(output),
    waitForRegistryStreamFailure(errors),
  ]);
  const interruption = waitForRegistryInterruption(request);
  try {
    const completion = subprocess.exited.then((exitCode) => ({ exitCode }));
    const first = await Promise.race([
      completion,
      interruption.promise,
      streamFailure,
    ]);
    if (first instanceof Error) {
      subprocess.kill(9);
      await subprocess.exited;
      await Promise.allSettled([output, errors]);
      throw first;
    }
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

async function readManifestDiscoveryStream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  let pathBytes: number[] = [];
  const manifestPaths: string[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      for (const byte of chunk.value) {
        if (byte !== 0) {
          pathBytes.push(byte);
          if (pathBytes.length > MAXIMUM_EXECUTABLE_SKILL_MANIFEST_PATH_BYTES) {
            await reader.cancel();
            throw new Error(
              'Executable skill registry tree path exceeds its bound.',
            );
          }
          continue;
        }
        const candidate = Buffer.from(pathBytes).toString('utf8');
        pathBytes = [];
        if (!EXECUTABLE_MANIFEST_PATH.test(candidate)) continue;
        manifestPaths.push(candidate);
        if (manifestPaths.length > MAXIMUM_EXECUTABLE_SKILL_MANIFESTS) {
          await reader.cancel();
          throw new Error('Executable skill manifest count exceeds its bound.');
        }
      }
    }
    if (pathBytes.length > 0) {
      throw new Error('Executable skill registry tree framing is invalid.');
    }
    return manifestPaths.join('\0');
  } finally {
    reader.releaseLock();
  }
}

async function waitForRegistryStreamFailure(
  stream: Promise<string>,
): Promise<Error> {
  try {
    await stream;
    return await new Promise<Error>(() => false);
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error('Executable skill registry Git stream failed.');
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

type ReadRegistryStreamRequest = {
  readonly maximumBytes: number;
  readonly stream: ReadableStream<Uint8Array>;
};

async function readRegistryStream(
  request: ReadRegistryStreamRequest,
): Promise<string> {
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
