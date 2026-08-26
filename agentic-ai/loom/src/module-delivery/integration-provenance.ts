import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { gitText, runModuleDeliveryGit } from './git-command.ts';
import { pathExists } from './workspace-paths.ts';

import type { GitCommandRequest } from './git-command.ts';
import type {
  ModuleIntegrationCleanupHandle,
  ModuleIntegrationState,
} from './integration.ts';
import type { ModuleWorktreeHandle } from './workspace.ts';

export type SourceRepositorySnapshot = {
  readonly headCommit: string;
  readonly symbolicHead: string;
  readonly contentDigest: string;
  readonly metadataDigest: string;
  readonly indexDigest: string;
  readonly refsDigest: string;
  readonly configDigest: string;
};

export type ModuleIntegrationSession = {
  readonly cleanupHandle: ModuleIntegrationCleanupHandle;
  readonly workspace: ModuleWorktreeHandle;
  readonly integrationRef: string;
  currentHead: string;
  cleaned: boolean;
};

export type ModuleIntegrationProvenance = {
  readonly planDigest: string;
  readonly sourceCommit: string;
  readonly completedWaveCount: number;
  readonly headCommit: string;
  readonly workspace: ModuleWorktreeHandle;
  readonly sourceSnapshot: SourceRepositorySnapshot;
  readonly workspaceSnapshot: SourceRepositorySnapshot;
  readonly session: ModuleIntegrationSession;
};

export type SourceSnapshotExpectation = {
  readonly repositoryRoot: string;
  readonly expected: SourceRepositorySnapshot;
};

export type IntegrationSessionRegistration = {
  readonly cleanupHandle: ModuleIntegrationCleanupHandle;
  readonly workspace: ModuleWorktreeHandle;
  readonly integrationRef: string;
  readonly currentHead: string;
};

export type IntegrationStateRegistration = {
  readonly state: ModuleIntegrationState;
  readonly sourceSnapshot: SourceRepositorySnapshot;
  readonly workspaceSnapshot: SourceRepositorySnapshot;
  readonly session: ModuleIntegrationSession;
};

type ModuleGitInvocation = {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly allowFailure?: boolean;
};

type RepositoryPathSet = {
  readonly repositoryRoot: string;
  readonly paths: readonly string[];
  readonly includeContent: boolean;
};

type RepositoryFingerprint = {
  readonly contentDigest: string;
  readonly metadataDigest: string;
};

type EntryFingerprint = {
  readonly content: readonly Buffer[];
  readonly metadata: readonly Buffer[];
};

type SymlinkAncestorInspection = {
  readonly root: string;
  readonly absolutePath: string;
};

type EntryFingerprintRequest = {
  readonly repositoryRoot: string;
  readonly path: string;
  readonly includeContent: boolean;
};

type RepositorySnapshotRequest = {
  readonly repositoryRoot: string;
  readonly includeContent: boolean;
};

const BIGINT_STATS_OPTIONS = { bigint: true } as const;

const PROVENANCE = new WeakMap<
  ModuleIntegrationState,
  ModuleIntegrationProvenance
>();
const SESSIONS = new WeakMap<
  ModuleIntegrationCleanupHandle,
  ModuleIntegrationSession
>();
const RETIRED_STATES = new WeakSet<ModuleIntegrationState>();

function gitRequest(invocation: ModuleGitInvocation): GitCommandRequest {
  if ('allowFailure' in invocation) {
    return {
      cwd: invocation.cwd,
      args: invocation.args,
      allowFailure: invocation.allowFailure,
    };
  }
  return { cwd: invocation.cwd, args: invocation.args };
}

function gitBytes(invocation: ModuleGitInvocation): Buffer {
  return runModuleDeliveryGit(gitRequest(invocation)).stdout;
}

function digestBuffers(buffers: readonly Buffer[]): string {
  const hash = createHash('sha256');
  for (const bytes of buffers) {
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(length);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function nullSeparatedPaths(bytes: Buffer): readonly string[] {
  if (bytes.length === 0) return [];
  if (bytes.at(-1) !== 0) {
    throw new Error('Repository path list requires NUL termination.');
  }
  const paths: string[] = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue;
    const encoded = bytes.subarray(start, index);
    const path = encoded.toString('utf8');
    if (!Buffer.from(path, 'utf8').equals(encoded)) {
      throw new Error('Repository path is not valid UTF-8.');
    }
    paths.push(path);
    start = index + 1;
  }
  return paths;
}

function assertNoSymlinkAncestor(inspection: SymlinkAncestorInspection): void {
  let parent = dirname(inspection.absolutePath);
  while (parent !== inspection.root) {
    if (lstatSync(parent).isSymbolicLink()) {
      throw new Error('Repository entry has a symlink ancestor.');
    }
    parent = dirname(parent);
  }
}

function entryFingerprint(request: EntryFingerprintRequest): EntryFingerprint {
  const absolutePath = resolve(request.repositoryRoot, request.path);
  const fromRoot = relative(request.repositoryRoot, absolutePath);
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('Repository entry escapes its root.');
  }
  const ancestorInspection: SymlinkAncestorInspection = {
    root: request.repositoryRoot,
    absolutePath,
  };
  assertNoSymlinkAncestor(ancestorInspection);
  const pathTag = Buffer.from(`path:${request.path}`, 'utf8');
  if (!pathExists(absolutePath)) {
    return {
      content: [pathTag, Buffer.from('content:missing', 'utf8')],
      metadata: [pathTag, Buffer.from('kind:missing', 'utf8')],
    };
  }
  const metadata = lstatSync(absolutePath, BIGINT_STATS_OPTIONS);
  const kind = metadata.isSymbolicLink()
    ? 'symlink'
    : metadata.isFile()
      ? 'file'
      : metadata.isDirectory()
        ? 'directory'
        : 'other';
  const metadataTag = Buffer.from(
    [
      `kind:${kind}`,
      `mode:${metadata.mode.toString(8)}`,
      `dev:${metadata.dev.toString()}`,
      `ino:${metadata.ino.toString()}`,
      `size:${metadata.size.toString()}`,
      `mtime:${metadata.mtimeNs.toString()}`,
      `ctime:${metadata.ctimeNs.toString()}`,
    ].join('|'),
    'utf8',
  );
  if (kind === 'symlink') {
    return {
      content: request.includeContent
        ? [
            pathTag,
            Buffer.from('content:symlink-target', 'utf8'),
            Buffer.from(readlinkSync(absolutePath), 'utf8'),
          ]
        : [],
      metadata: [pathTag, metadataTag],
    };
  }
  if (kind === 'file') {
    return {
      content: request.includeContent
        ? [
            pathTag,
            Buffer.from('content:file-bytes', 'utf8'),
            readFileSync(absolutePath),
          ]
        : [],
      metadata: [pathTag, metadataTag],
    };
  }
  return {
    content: [pathTag, Buffer.from(`content:${kind}`, 'utf8')],
    metadata: [pathTag, metadataTag],
  };
}

function repositoryFingerprint(
  paths: RepositoryPathSet,
): RepositoryFingerprint {
  const content: Buffer[] = [];
  const metadata: Buffer[] = [];
  for (const path of [...paths.paths].sort()) {
    const request: EntryFingerprintRequest = {
      repositoryRoot: paths.repositoryRoot,
      path,
      includeContent: paths.includeContent,
    };
    const fingerprint = entryFingerprint(request);
    content.push(...fingerprint.content);
    metadata.push(...fingerprint.metadata);
  }
  return {
    contentDigest: digestBuffers(content),
    metadataDigest: digestBuffers(metadata),
  };
}

function repositoryPaths(repositoryRoot: string): readonly string[] {
  const trackedInvocation: ModuleGitInvocation = {
    cwd: repositoryRoot,
    args: ['ls-files', '-z'],
  };
  const untrackedInvocation: ModuleGitInvocation = {
    cwd: repositoryRoot,
    args: ['ls-files', '--others', '--exclude-standard', '-z'],
  };
  return [
    ...new Set([
      ...nullSeparatedPaths(gitBytes(trackedInvocation)),
      ...nullSeparatedPaths(gitBytes(untrackedInvocation)),
    ]),
  ];
}

function relevantRefsDigest(repositoryRoot: string): string {
  const invocation: ModuleGitInvocation = {
    cwd: repositoryRoot,
    args: [
      'for-each-ref',
      '--sort=refname',
      '--format=%(refname)%00%(objectname)%00%(symref)',
      'refs',
    ],
  };
  const fields: Buffer[] = [];
  for (const record of gitBytes(invocation).toString('utf8').split('\n')) {
    if (record.length === 0) continue;
    const [ref = '', objectId = '', symref = ''] = record.split('\0');
    if (ref.startsWith('refs/nook/module-delivery/')) continue;
    if (ref.length === 0 || objectId.length === 0) {
      throw new Error('Repository ref fingerprint record is malformed.');
    }
    fields.push(
      Buffer.from(ref, 'utf8'),
      Buffer.from(objectId, 'ascii'),
      Buffer.from(symref, 'utf8'),
    );
  }
  return digestBuffers(fields);
}

function captureRepositorySnapshot(
  request: RepositorySnapshotRequest,
): SourceRepositorySnapshot {
  const repositoryRoot = request.repositoryRoot;
  const headInvocation: ModuleGitInvocation = {
    cwd: repositoryRoot,
    args: ['rev-parse', '--verify', 'HEAD^{commit}'],
  };
  const branchInvocation: ModuleGitInvocation = {
    cwd: repositoryRoot,
    args: ['symbolic-ref', '--quiet', 'HEAD'],
    allowFailure: true,
  };
  const branch = runModuleDeliveryGit(gitRequest(branchInvocation));
  const indexPathInvocation: ModuleGitInvocation = {
    cwd: repositoryRoot,
    args: ['rev-parse', '--path-format=absolute', '--git-path', 'index'],
  };
  const configInvocation: ModuleGitInvocation = {
    cwd: repositoryRoot,
    args: ['config', '--local', '--null', '--list'],
  };
  const pathSet: RepositoryPathSet = {
    repositoryRoot,
    paths: repositoryPaths(repositoryRoot),
    includeContent: request.includeContent,
  };
  const fingerprint = repositoryFingerprint(pathSet);
  const indexPath = gitText(
    runModuleDeliveryGit(gitRequest(indexPathInvocation)),
  );
  return {
    headCommit: gitText(runModuleDeliveryGit(gitRequest(headInvocation))),
    symbolicHead: branch.exitCode === 0 ? gitText(branch) : '(detached)',
    contentDigest: fingerprint.contentDigest,
    metadataDigest: fingerprint.metadataDigest,
    indexDigest: digestBuffers([readFileSync(indexPath)]),
    refsDigest: relevantRefsDigest(repositoryRoot),
    configDigest: digestBuffers([gitBytes(configInvocation)]),
  };
}

export function captureSourceSnapshot(
  repositoryRoot: string,
): SourceRepositorySnapshot {
  const request: RepositorySnapshotRequest = {
    repositoryRoot,
    includeContent: true,
  };
  return captureRepositorySnapshot(request);
}

export function assertSourceSnapshot(
  expectation: SourceSnapshotExpectation,
): void {
  const request: RepositorySnapshotRequest = {
    repositoryRoot: expectation.repositoryRoot,
    includeContent: false,
  };
  const current = captureRepositorySnapshot(request);
  if (
    current.headCommit !== expectation.expected.headCommit ||
    current.symbolicHead !== expectation.expected.symbolicHead ||
    current.metadataDigest !== expectation.expected.metadataDigest ||
    current.indexDigest !== expectation.expected.indexDigest ||
    current.refsDigest !== expectation.expected.refsDigest ||
    current.configDigest !== expectation.expected.configDigest
  ) {
    throw new Error('Source repository changed after integration preparation.');
  }
}

export function createIntegrationSession(
  registration: IntegrationSessionRegistration,
): ModuleIntegrationSession {
  const session: ModuleIntegrationSession = {
    cleanupHandle: registration.cleanupHandle,
    workspace: registration.workspace,
    integrationRef: registration.integrationRef,
    currentHead: registration.currentHead,
    cleaned: false,
  };
  SESSIONS.set(registration.cleanupHandle, session);
  return session;
}

export function integrationSession(
  handle: ModuleIntegrationCleanupHandle,
): ModuleIntegrationSession {
  const session = SESSIONS.get(handle);
  if (!session)
    throw new Error('Module integration cleanup handle is invalid.');
  return session;
}

export function registerIntegrationState(
  registration: IntegrationStateRegistration,
): void {
  const provenanceValue: ModuleIntegrationProvenance = {
    planDigest: registration.state.planDigest,
    sourceCommit: registration.state.sourceCommit,
    completedWaveCount: registration.state.completedWaveCount,
    headCommit: registration.state.headCommit,
    workspace: registration.state.workspace,
    sourceSnapshot: registration.sourceSnapshot,
    workspaceSnapshot: registration.workspaceSnapshot,
    session: registration.session,
  };
  PROVENANCE.set(registration.state, Object.freeze(provenanceValue));
}

export function integrationProvenance(
  state: ModuleIntegrationState,
): ModuleIntegrationProvenance {
  if (RETIRED_STATES.has(state)) {
    throw new Error('Module integration state is stale.');
  }
  const provenance = PROVENANCE.get(state);
  if (!provenance) {
    throw new Error('Module integration state lacks private provenance.');
  }
  return provenance;
}

export function retireIntegrationState(state: ModuleIntegrationState): void {
  RETIRED_STATES.add(state);
}
