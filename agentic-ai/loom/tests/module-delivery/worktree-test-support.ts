import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryProviderSubmissionKind,
  TeamKey,
  moduleDeliveryEvidenceArtifactDigest,
  moduleDeliveryEvidenceClaimIdentities,
} from '../../src/module-delivery/index.ts';

import type {
  SpawnSyncOptionsWithStringEncoding,
  SpawnSyncReturns,
} from 'node:child_process';
import type {
  ModuleWorktreeHandle,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryEvidenceArtifactDigestRequest,
  ModuleDeliveryEvidenceDigestRequest,
  ModuleDeliveryEvidenceSynthesisNodeV2,
  ModuleDeliveryReadOnlyEvidenceSubmission,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleIntegrationState,
  PrepareModuleWorktreeRequest,
} from '../../src/module-delivery/index.ts';

const PLAN_DIGEST = 'a'.repeat(64);

export type GitFixture = {
  readonly root: string;
  readonly sourceRoot: string;
  readonly workspaceRoot: string;
  readonly baselineCommit: string;
};

type GitExecution = {
  readonly cwd: string;
  readonly args: readonly string[];
};

export type GitRunner = (args: readonly string[]) => string;
export type FixtureFileEntry = readonly [
  relativePath: string,
  contents: string,
];
export type FixtureFileWriter = (entry: FixtureFileEntry) => void;

export type FixtureFileWrite = {
  readonly fixture: GitFixture;
  readonly relativePath: string;
  readonly contents: string;
};

export type WorktreeFileWrite = {
  readonly workspace: ModuleWorktreeHandle;
  readonly relativePath: string;
  readonly contents: string;
};

export type EvidenceFixtureInput = {
  readonly state: ModuleIntegrationState;
  readonly node:
    ModuleDeliveryReadOnlyNodeV2 | ModuleDeliveryEvidenceSynthesisNodeV2;
  readonly lease: ModuleDeliveryAttemptLease;
};
export type InvalidEvidenceCase = readonly [
  submission: ModuleDeliveryReadOnlyEvidenceSubmission,
  error: string,
];

export function evidenceSubmission(
  input: EvidenceFixtureInput,
): ModuleDeliveryReadOnlyEvidenceSubmission {
  const claimRequest: ModuleDeliveryEvidenceDigestRequest = {
    repositoryRoot: input.state.workspace.sourceRepositoryRoot,
    sourceCommit: input.state.headCommit,
    evidenceSurface: input.node.resources.evidenceSurface,
  };
  const evidence = [`${input.node.taskId} completed`];
  const artifactIdentity = `${input.node.taskId}/report.json`;
  const acceptedProviderEvidence = input.lease.authorizedProviderEvidence;
  const digestRequest: ModuleDeliveryEvidenceArtifactDigestRequest = {
    artifactIdentity,
    evidence,
    acceptanceRequirements: input.lease.acceptanceRequirements,
    acceptedProviderEvidence,
  };
  return {
    kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence,
    schemaVersion: MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
    taskId: input.node.taskId,
    attempt: input.lease.attempt,
    generation: input.lease.generation,
    planDigest: input.lease.planDigest,
    sourceCommit: input.state.headCommit,
    producerTeam: input.node.team,
    functionalOwner: input.node.functionalOwner,
    acceptanceOwner: input.node.acceptanceOwner,
    acceptanceRequirements: input.lease.acceptanceRequirements,
    acceptedProviderEvidence,
    claimIdentities: moduleDeliveryEvidenceClaimIdentities(claimRequest),
    artifactIdentity,
    artifactDigest: moduleDeliveryEvidenceArtifactDigest(digestRequest),
    verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
    evidence,
  };
}

export function invalidEvidenceCases(
  valid: ModuleDeliveryReadOnlyEvidenceSubmission,
): readonly InvalidEvidenceCase[] {
  const claim = valid.claimIdentities[0];
  if (!claim) throw new Error('Evidence claim fixture is missing.');
  return [
    [{ ...valid, producerTeam: TeamKey.WebDevelopment }, 'metadata'],
    [{ ...valid, generation: valid.generation + 1 }, 'obsolete'],
    [{ ...valid, attempt: valid.attempt + 1 }, 'authoritative'],
    [{ ...valid, sourceCommit: '0'.repeat(40) }, 'metadata'],
    [
      {
        ...valid,
        claimIdentities: [{ ...claim, contentDigest: '0'.repeat(64) }],
      },
      'stale',
    ],
    [{ ...valid, claimIdentities: [] }, 'stale'],
    [{ ...valid, artifactIdentity: '../forged' }, 'metadata'],
    [{ ...valid, artifactDigest: '0'.repeat(64) }, 'invalid'],
    [{ ...valid, evidence: ['stale evidence'] }, 'invalid'],
  ];
}

function executeGit(command: GitExecution): string {
  const options: SpawnSyncOptionsWithStringEncoding = {
    cwd: command.cwd,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const result: SpawnSyncReturns<string> = spawnSync(
    'git',
    [...command.args],
    options,
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Fixture Git command failed.');
  }
  return result.stdout.trim();
}

export function createGitFixture(): GitFixture {
  const createdRoot = mkdtempSync(join(tmpdir(), 'nook-module-worktree-'));
  const root = realpathSync(createdRoot);
  const sourceRoot = join(root, 'source');
  const workspaceRoot = join(root, 'workspaces');
  mkdirSync(sourceRoot);
  mkdirSync(workspaceRoot);
  const provisional: GitFixture = {
    root,
    sourceRoot,
    workspaceRoot,
    baselineCommit: '',
  };
  const git = fixtureGit(provisional);
  git(['-c', 'init.templateDir=', 'init', '--quiet']);
  // prettier-ignore
  for (const name of ['hooks', 'info']) chmodSync((mkdirSync(join(sourceRoot, '.git', name)), join(sourceRoot, '.git', name)), 0o755);
  writeFileSync(join(sourceRoot, '.git/info/exclude'), '');
  git(['config', 'user.name', 'Nook Test']);
  git(['config', 'user.email', 'nook-test@example.invalid']);
  const initialWrite: FixtureFileWrite = {
    fixture: provisional,
    relativePath: 'module/seed.txt',
    contents: 'seed\n',
  };
  writeFixtureFile(initialWrite);
  writeFileSync(join(sourceRoot, '.gitignore'), 'hidden/**\n');
  git(['add', '--all']);
  git(['commit', '--quiet', '-m', 'baseline']);
  const baselineCommit = git(['rev-parse', 'HEAD']);
  const branch = git(['symbolic-ref', '--short', 'HEAD']);
  git(['update-ref', `refs/remotes/origin/${branch}`, baselineCommit]);
  git(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
  git(['config', `branch.${branch}.remote`, 'origin']);
  git(['config', `branch.${branch}.merge`, `refs/heads/${branch}`]);
  return { root, sourceRoot, workspaceRoot, baselineCommit };
}

export function disposeGitFixture(fixture: GitFixture): void {
  const git = fixtureGit(fixture);
  try {
    git(['worktree', 'prune', '--expire', 'now']);
  } catch {
    // The fixture may intentionally corrupt its source registration.
  }
  const removalOptions = { recursive: true, force: true } as const;
  rmSync(fixture.root, removalOptions);
}

export function fixtureGit(fixture: GitFixture): GitRunner {
  return (args: readonly string[]) => {
    const execution: GitExecution = { cwd: fixture.sourceRoot, args };
    return executeGit(execution);
  };
}

export function worktreeGit(workspace: ModuleWorktreeHandle): GitRunner {
  return (args: readonly string[]) => {
    const execution: GitExecution = { cwd: workspace.worktreePath, args };
    return executeGit(execution);
  };
}

export function writeFixtureFile(write: FixtureFileWrite): void {
  const path = join(write.fixture.sourceRoot, write.relativePath);
  const directoryOptions = { recursive: true } as const;
  mkdirSync(join(path, '..'), directoryOptions);
  writeFileSync(path, write.contents);
}

export function writeWorktreeFile(write: WorktreeFileWrite): void {
  const path = join(write.workspace.worktreePath, write.relativePath);
  const directoryOptions = { recursive: true } as const;
  mkdirSync(join(path, '..'), directoryOptions);
  writeFileSync(path, write.contents);
}

export function fixtureFileWriter(fixture: GitFixture): FixtureFileWriter {
  return (entry: FixtureFileEntry) => {
    const write: FixtureFileWrite = {
      fixture,
      relativePath: entry[0],
      contents: entry[1],
    };
    writeFixtureFile(write);
  };
}

export function worktreeFileWriter(
  workspace: ModuleWorktreeHandle,
): FixtureFileWriter {
  return (entry: FixtureFileEntry) => {
    const write: WorktreeFileWrite = {
      workspace,
      relativePath: entry[0],
      contents: entry[1],
    };
    writeWorktreeFile(write);
  };
}

export function prepareRequest(
  fixture: GitFixture,
): PrepareModuleWorktreeRequest {
  return {
    repositoryRoot: fixture.sourceRoot,
    workspaceRoot: fixture.workspaceRoot,
    planDigest: PLAN_DIGEST,
    taskId: 'core-provider',
    attempt: 1,
    baselineCommit: fixture.baselineCommit,
  };
}

export function installCheckoutHook(fixture: GitFixture): string {
  const hooksDirectory = join(fixture.sourceRoot, '.git', 'hooks');
  const markerPath = join(fixture.root, 'hook-ran');
  const hookPath = join(hooksDirectory, 'post-checkout');
  writeFileSync(hookPath, `#!/bin/sh\ntouch '${markerPath}'\n`);
  chmodSync(hookPath, 0o755);
  return markerPath;
}
