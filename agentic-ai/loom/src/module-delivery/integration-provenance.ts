import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { gitText, runModuleDeliveryGit } from './git-command.ts';
import { pathExists } from './workspace-paths.ts';
import {
  assertPreparedModuleWorktreeIdentity,
  cleanupModuleWorktree,
} from './workspace.ts';
import {
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryGenerationFenceKind,
  assertModuleDeliveryAdmissionStateAuthority,
  recordModuleDeliveryAttemptDisposition,
} from './admission.ts';

import type { GitCommandRequest } from './git-command.ts';
import type {
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryGenerationAuthority,
} from './admission.ts';
import type {
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  ModuleDeliveryEvidenceClaimIdentity,
} from './evidence.ts';
import type { TeamKey } from '../team-agents/catalog.ts';
import type {
  ModuleDeliveryNode,
  ModuleDeliveryOwnerIdentity,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';
import type {
  CleanupModuleWorktreeRequest,
  ModuleWorktreeHandle,
} from './workspace.ts';

export const MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION = 1;

export enum ModuleDeliveryProviderSubmissionKind {
  Write = 'write',
  ReadOnlyEvidence = 'read-only-evidence',
}

export enum ModuleDeliveryEvidenceVerdict {
  TerminalSuccess = 'terminal-success',
}

export enum ModuleIntegrationPhase {
  AcceptingProviders = 'accepting-providers',
  Finalized = 'finalized',
}

export type ModuleDeliveryReadOnlyEvidenceSubmission = Readonly<{
  kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence;
  schemaVersion: typeof MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION;
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
  sourceCommit: string;
  producerTeam: TeamKey;
  functionalOwner: ModuleDeliveryOwnerIdentity;
  acceptanceOwner: ModuleDeliveryOwnerIdentity;
  acceptanceRequirements: readonly string[];
  claimIdentities: readonly ModuleDeliveryEvidenceClaimIdentity[];
  acceptedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
  artifactIdentity: string;
  artifactDigest: string;
  verdict: ModuleDeliveryEvidenceVerdict;
  evidence: readonly string[];
}>;

export type AcceptedModuleDeliveryEvidence =
  ModuleDeliveryReadOnlyEvidenceSubmission &
    Readonly<{ sourceProvenanceDigest: string; verifiedHeadCommit: string }>;

export type PrepareModuleIntegrationRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  repositoryRoot: string;
  workspaceRoot: string;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  admissionState: ModuleDeliveryAdmissionState;
}>;
export type GenerationAuthorityInspection = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  generation: number;
  planDigest: string;
}>;
export type AdmissionStateAuthorityInspection = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  state: ModuleDeliveryAdmissionState;
}>;
export type AttemptLeaseAuthorityInspection = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  lease: ModuleDeliveryAttemptLease;
}>;
export type ModuleDeliveryAuthorityPlanRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
}>;
export type ModuleDeliveryAuthorityRepositoryInspection = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  repositoryRoot: string;
}>;
export type AcceptedPlanStateInspection = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  state: ModuleIntegrationState;
}>;
export type ModuleIntegrationNodeLookup = Readonly<{
  acceptedPlan: ValidatedModuleDeliveryPlan;
  taskId: string;
}>;
export type ModuleDeliveryCanonicalEvidenceTransition = Readonly<{
  previousHeadCommit: string;
  canonicalHeadCommit: string;
  integratedTaskIds: readonly string[];
}>;
export type AssertModuleDeliveryCanonicalEvidenceTransitionRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  transition: ModuleDeliveryCanonicalEvidenceTransition;
  previousHeadCommit: string;
  canonicalHeadCommit: string;
  integratedTaskIds: readonly string[];
}>;
export type CanonicalEvidenceTransitionProvenance = Omit<
  AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
  'transition'
>;
export type ModuleDeliveryDispositionOutcome = Readonly<{
  kind: ModuleDeliveryAttemptDispositionKind;
  conclusion: ModuleDeliveryGenerationFenceKind;
}>;
export type RecordModuleDeliveryAttemptDispositionRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  state: ModuleDeliveryAdmissionState;
  lease: ModuleDeliveryAttemptLease;
  outcome: ModuleDeliveryDispositionOutcome;
}>;

export type ModuleDeliveryHandoffSubmission = Readonly<{
  taskId: string;
  attempt: number;
  planDigest: string;
  baselineCommit: string;
  commit: string;
  workspace: ModuleWorktreeHandle;
}>;

export type ModuleDeliveryWriteProviderSubmission = Readonly<{
  kind: ModuleDeliveryProviderSubmissionKind.Write;
  generation: number;
  acceptedByTeam: ModuleDeliveryOwnerIdentity;
  verdict: ModuleDeliveryEvidenceVerdict;
  handoff: ModuleDeliveryHandoffSubmission;
}>;

export type ModuleDeliveryProviderSubmission =
  | ModuleDeliveryWriteProviderSubmission
  | ModuleDeliveryReadOnlyEvidenceSubmission;

export type AcceptedModuleDeliveryWrite = Readonly<{
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
  startingFrontier: string;
  integrationCommit: string;
  acceptedByTeam: ModuleDeliveryOwnerIdentity;
  handoff: ModuleDeliveryHandoffSubmission;
}>;

export type ModuleIntegrationCleanupHandle = Readonly<{
  sessionId: string;
}>;

export type ModuleIntegrationState = Readonly<{
  phase: ModuleIntegrationPhase;
  generation: number;
  planDigest: string;
  sourceCommit: string;
  topologicalOrder: readonly string[];
  waves: readonly (readonly string[])[];
  completedWaveCount: number;
  integratedTaskIds: readonly string[];
  acceptedWrites: readonly AcceptedModuleDeliveryWrite[];
  acceptedEvidence: readonly AcceptedModuleDeliveryEvidence[];
  headCommit: string;
  admissionState: ModuleDeliveryAdmissionState;
  workspace: ModuleWorktreeHandle;
  cleanupHandle: ModuleIntegrationCleanupHandle;
}>;

export type IntegrateVerifiedModuleDeliveryTaskRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  lease: ModuleDeliveryAttemptLease;
  state: ModuleIntegrationState;
  submission: ModuleDeliveryProviderSubmission;
}>;

export type FinalizeModuleDeliveryIntegrationRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  state: ModuleIntegrationState;
}>;

export type CleanupModuleIntegrationRequest = Readonly<{
  cleanupHandle: ModuleIntegrationCleanupHandle;
}>;

export type CleanupModuleIntegrationResult = Readonly<{ removed: boolean }>;

export function moduleDeliveryEvidenceSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

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
  readonly authority: ModuleDeliveryGenerationAuthority;
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
  readonly authority: ModuleDeliveryGenerationAuthority;
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
export type ModuleIntegrationRefRequest = Readonly<{
  workspace: ModuleWorktreeHandle;
  planDigest: string;
}>;
export type UpdateModuleIntegrationRefRequest = Readonly<{
  provenance: ModuleIntegrationProvenance;
  nextCommit: string;
  rollback: boolean;
}>;
export type FreshModuleIntegrationStateInspection = Readonly<{
  state: ModuleIntegrationState;
  provenance: ModuleIntegrationProvenance;
}>;
export type RecordIntegratedLeaseAcceptanceRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  state: ModuleDeliveryAdmissionState;
  lease: ModuleDeliveryAttemptLease;
}>;
export type ModuleIntegrationHandoffRepositoryInspection = Readonly<{
  state: ModuleIntegrationState;
  handoff: ModuleDeliveryHandoffSubmission;
}>;
export type CurrentModuleIntegrationAdmissionInspection = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  state: ModuleIntegrationState;
}>;
export type ModuleIntegrationLeaseFrontierInspection = Readonly<{
  state: ModuleIntegrationState;
  lease: ModuleDeliveryAttemptLease;
}>;
export type ModuleIntegrationProviderPrecedenceInspection = Readonly<{
  acceptedPlan: ValidatedModuleDeliveryPlan;
  state: ModuleIntegrationState;
  taskId: string;
  lease: ModuleDeliveryAttemptLease;
}>;
export type ModuleIntegrationCompletedWaveCountRequest = Readonly<{
  acceptedPlan: ValidatedModuleDeliveryPlan;
  state: ModuleIntegrationState;
}>;

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
const INTEGRATION_TASK_ID = 'module-delivery-integration';
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
    authority: registration.authority,
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

function frozenAcceptedWrite(
  entry: AcceptedModuleDeliveryWrite,
): AcceptedModuleDeliveryWrite {
  const handoffValue: ModuleDeliveryHandoffSubmission = { ...entry.handoff };
  const handoff = Object.freeze(handoffValue);
  const value: AcceptedModuleDeliveryWrite = { ...entry, handoff };
  return Object.freeze(value);
}

export function immutableModuleIntegrationState(
  state: ModuleIntegrationState,
): ModuleIntegrationState {
  const workspaceValue: ModuleWorktreeHandle = { ...state.workspace };
  const workspace = Object.isFrozen(state.workspace)
    ? state.workspace
    : Object.freeze(workspaceValue);
  const value: ModuleIntegrationState = {
    ...state,
    topologicalOrder: Object.freeze([...state.topologicalOrder]),
    waves: Object.freeze(state.waves.map((wave) => Object.freeze([...wave]))),
    integratedTaskIds: Object.freeze([...state.integratedTaskIds]),
    acceptedWrites: Object.freeze(
      state.acceptedWrites.map(frozenAcceptedWrite),
    ),
    acceptedEvidence: Object.freeze([...state.acceptedEvidence]),
    workspace,
  };
  return Object.freeze(value);
}

export function moduleIntegrationRef(
  request: ModuleIntegrationRefRequest,
): string {
  return `refs/nook/module-delivery/${request.planDigest}/${request.workspace.worktreeId}`;
}

export function updateModuleIntegrationRef(
  request: UpdateModuleIntegrationRefRequest,
): void {
  const args = request.rollback
    ? [
        'update-ref',
        request.provenance.session.integrationRef,
        request.provenance.headCommit,
        request.nextCommit,
      ]
    : [
        'update-ref',
        '--create-reflog',
        request.provenance.session.integrationRef,
        request.nextCommit,
        request.provenance.headCommit,
      ];
  const invocation: GitCommandRequest = {
    cwd: request.provenance.workspace.sourceRepositoryRoot,
    args,
  };
  runModuleDeliveryGit(invocation);
}

export function assertFreshModuleIntegrationState(
  request: FreshModuleIntegrationStateInspection,
): void {
  const { state, provenance } = request;
  if (
    provenance.planDigest !== state.planDigest ||
    provenance.sourceCommit !== state.sourceCommit ||
    provenance.completedWaveCount !== state.completedWaveCount ||
    provenance.headCommit !== state.headCommit ||
    provenance.workspace !== state.workspace
  )
    throw new Error(
      'Module integration state violates its private provenance.',
    );
  if (
    state.phase !== ModuleIntegrationPhase.AcceptingProviders &&
    state.phase !== ModuleIntegrationPhase.Finalized
  )
    throw new Error('Module integration state has an invalid phase.');
  if (
    !Number.isSafeInteger(state.completedWaveCount) ||
    state.completedWaveCount < 0 ||
    state.completedWaveCount > state.waves.length
  )
    throw new Error('Module integration state has an invalid wave frontier.');
  if (new Set(state.integratedTaskIds).size !== state.integratedTaskIds.length)
    throw new Error(
      'Module integration state has an inconsistent task frontier.',
    );
  assertPreparedModuleWorktreeIdentity(state.workspace);
  if (
    state.workspace.planDigest !== state.planDigest ||
    state.workspace.baselineCommit !== state.sourceCommit ||
    state.workspace.taskId !== INTEGRATION_TASK_ID ||
    state.workspace.attempt !== 1
  )
    throw new Error('Module integration workspace metadata is inconsistent.');
  const headInvocation: GitCommandRequest = {
    cwd: state.workspace.worktreePath,
    args: ['rev-parse', '--verify', 'HEAD^{commit}'],
  };
  const head = gitText(runModuleDeliveryGit(headInvocation));
  if (head !== state.sourceCommit)
    throw new Error(
      'Module integration worktree was changed without authority.',
    );
  if (
    provenance.session.cleaned ||
    provenance.session.cleanupHandle !== state.cleanupHandle ||
    provenance.session.workspace !== state.workspace ||
    provenance.session.currentHead !== state.headCommit
  )
    throw new Error('Module integration session is stale or already cleaned.');
  const refInvocation: GitCommandRequest = {
    cwd: state.workspace.sourceRepositoryRoot,
    args: [
      'rev-parse',
      '--verify',
      `${provenance.session.integrationRef}^{commit}`,
    ],
  };
  const ref = gitText(runModuleDeliveryGit(refInvocation));
  if (ref !== state.headCommit)
    throw new Error('Module integration state is stale.');
  const branchInvocation: GitCommandRequest = {
    cwd: state.workspace.worktreePath,
    args: ['symbolic-ref', '--quiet', 'HEAD'],
    allowFailure: true,
  };
  const branch = runModuleDeliveryGit(branchInvocation);
  if (branch.exitCode === 0)
    throw new Error('Module integration workspace must keep detached HEAD.');
  const sourceExpectation: SourceSnapshotExpectation = {
    repositoryRoot: state.workspace.sourceRepositoryRoot,
    expected: provenance.sourceSnapshot,
  };
  assertSourceSnapshot(sourceExpectation);
  const workspaceExpectation: SourceSnapshotExpectation = {
    repositoryRoot: state.workspace.worktreePath,
    expected: provenance.workspaceSnapshot,
  };
  assertSourceSnapshot(workspaceExpectation);
}

export function recordIntegratedLeaseAcceptance(
  accepted: RecordIntegratedLeaseAcceptanceRequest,
): void {
  const outcome: ModuleDeliveryDispositionOutcome = {
    kind: ModuleDeliveryAttemptDispositionKind.Accepted,
    conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
  };
  const request: RecordModuleDeliveryAttemptDispositionRequest = {
    authority: accepted.authority,
    state: accepted.state,
    lease: accepted.lease,
    outcome,
  };
  recordModuleDeliveryAttemptDisposition(request);
}

export function assertModuleIntegrationHandoffRepository(
  inspection: ModuleIntegrationHandoffRepositoryInspection,
): void {
  const integrationInvocation: GitCommandRequest = {
    cwd: inspection.state.workspace.sourceRepositoryRoot,
    args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
  };
  const handoffInvocation: GitCommandRequest = {
    cwd: inspection.handoff.workspace.worktreePath,
    args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
  };
  const integrationGit = realpathSync(
    gitText(runModuleDeliveryGit(integrationInvocation)),
  );
  const handoffGit = realpathSync(
    gitText(runModuleDeliveryGit(handoffInvocation)),
  );
  if (
    inspection.handoff.workspace.sourceRepositoryRoot !==
      inspection.state.workspace.sourceRepositoryRoot ||
    handoffGit !== integrationGit
  )
    throw new Error('Module delivery handoff repository is invalid.');
}

export function assertCurrentModuleIntegrationAdmission(
  inspection: CurrentModuleIntegrationAdmissionInspection,
): void {
  const authorityInspection: AdmissionStateAuthorityInspection = {
    authority: inspection.authority,
    state: inspection.state.admissionState,
  };
  assertModuleDeliveryAdmissionStateAuthority(authorityInspection);
}

export function assertModuleIntegrationLeaseFrontier(
  inspection: ModuleIntegrationLeaseFrontierInspection,
): void {
  if (!/^[0-9a-f]{40}$/u.test(inspection.lease.startingFrontier))
    throw new Error('Provider lease has an invalid starting frontier.');
  const invocation: GitCommandRequest = {
    cwd: inspection.state.workspace.sourceRepositoryRoot,
    args: [
      'merge-base',
      '--is-ancestor',
      inspection.lease.startingFrontier,
      inspection.state.headCommit,
    ],
    allowFailure: true,
  };
  if (runModuleDeliveryGit(invocation).exitCode !== 0)
    throw new Error('Provider lease starting frontier is stale or unrelated.');
}

export function assertModuleIntegrationProviderPrecedence(
  inspection: ModuleIntegrationProviderPrecedenceInspection,
): void {
  const predecessors = inspection.acceptedPlan.executionPrecedence
    .filter((edge) => edge.successorTaskId === inspection.taskId)
    .map((edge) => edge.predecessorTaskId);
  for (const predecessor of predecessors) {
    const acceptedWrite = inspection.state.acceptedWrites.find(
      (entry) => entry.taskId === predecessor,
    );
    const evidenceAccepted = inspection.state.acceptedEvidence.some(
      (entry) => entry.taskId === predecessor,
    );
    if (!acceptedWrite && !evidenceAccepted)
      throw new Error(
        `Provider ${inspection.taskId} is not ready; predecessor ${predecessor} is undispositioned.`,
      );
    if (!acceptedWrite) continue;
    const invocation: GitCommandRequest = {
      cwd: inspection.state.workspace.sourceRepositoryRoot,
      args: [
        'merge-base',
        '--is-ancestor',
        acceptedWrite.integrationCommit,
        inspection.lease.startingFrontier,
      ],
      allowFailure: true,
    };
    if (runModuleDeliveryGit(invocation).exitCode !== 0)
      throw new Error(
        `Provider ${inspection.taskId} lease predates integrated predecessor ${predecessor}.`,
      );
  }
}

export function moduleIntegrationCompletedWaveCount(
  request: ModuleIntegrationCompletedWaveCountRequest,
): number {
  let completed = 0;
  for (const wave of request.acceptedPlan.waves) {
    const complete = wave.every(
      (taskId) =>
        request.state.integratedTaskIds.includes(taskId) ||
        request.state.acceptedEvidence.some((entry) => entry.taskId === taskId),
    );
    if (!complete) break;
    completed += 1;
  }
  return completed;
}

export function assertModuleIntegrationAcceptedPlanState(
  inspection: AcceptedPlanStateInspection,
): void {
  const validation = inspection.acceptedPlan;
  if (
    inspection.state.planDigest !== validation.planDigest ||
    inspection.state.generation !== validation.plan.generation ||
    inspection.state.sourceCommit !== validation.plan.sourceCommit ||
    JSON.stringify(inspection.state.topologicalOrder) !==
      JSON.stringify(validation.topologicalOrder) ||
    JSON.stringify(inspection.state.waves) !== JSON.stringify(validation.waves)
  )
    throw new Error(
      'Module integration state does not match the accepted plan.',
    );
}

export function moduleIntegrationNodeByTaskId(
  lookup: ModuleIntegrationNodeLookup,
): ModuleDeliveryNode {
  const node = lookup.acceptedPlan.plan.nodes.find(
    (candidate) => candidate.taskId === lookup.taskId,
  );
  if (!node) throw new Error(`Accepted plan is missing task ${lookup.taskId}.`);
  return node;
}

export function cleanupRegisteredModuleIntegration(
  request: CleanupModuleIntegrationRequest,
): CleanupModuleIntegrationResult {
  const session = integrationSession(request.cleanupHandle);
  if (session.cleaned) return { removed: false };
  const deleteInvocation: GitCommandRequest = {
    cwd: session.workspace.sourceRepositoryRoot,
    args: ['update-ref', '-d', session.integrationRef, session.currentHead],
  };
  runModuleDeliveryGit(deleteInvocation);
  const cleanupRequest: CleanupModuleWorktreeRequest = {
    workspace: session.workspace,
  };
  try {
    cleanupModuleWorktree(cleanupRequest);
  } catch {
    const restoreInvocation: GitCommandRequest = {
      cwd: session.workspace.sourceRepositoryRoot,
      args: [
        'update-ref',
        '--create-reflog',
        session.integrationRef,
        session.currentHead,
        '0'.repeat(40),
      ],
    };
    runModuleDeliveryGit(restoreInvocation);
    throw new Error('Module integration cleanup failed and restored its ref.');
  }
  session.cleaned = true;
  return { removed: true };
}
