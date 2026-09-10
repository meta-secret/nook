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
  ModuleEvidenceBoundary,
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

export class ModuleDeliveryWorktreeTestSupportScenario {
  private constructor(private readonly request: GitFixture) {}

  static evidenceSubmission(
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
      claimIdentities:
        ModuleEvidenceBoundary.moduleDeliveryEvidenceClaimIdentities(
          claimRequest,
        ),
      artifactIdentity,
      artifactDigest:
        ModuleEvidenceBoundary.moduleDeliveryEvidenceArtifactDigest(
          digestRequest,
        ),
      verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
      evidence,
    };
  }

  static invalidEvidenceCases(
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

  static executeGit(command: GitExecution): string {
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

  static createGitFixture(): GitFixture {
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
    const git =
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(provisional);
    git(['init', '--quiet']);
    git(['config', 'user.name', 'Nook Test']);
    git(['config', 'user.email', 'nook-test@example.invalid']);
    const initialWrite: FixtureFileWrite = {
      fixture: provisional,
      relativePath: 'module/seed.txt',
      contents: 'seed\n',
    };
    ModuleDeliveryWorktreeTestSupportScenario.writeFixtureFile(initialWrite);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'baseline']);
    const baselineCommit = git(['rev-parse', 'HEAD']);
    return { root, sourceRoot, workspaceRoot, baselineCommit };
  }

  static disposeGitFixture(fixture: GitFixture): void {
    return new ModuleDeliveryWorktreeTestSupportScenario(fixture).execute();
  }

  private execute(): void {
    const fixture = this.request;
    const git = ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture);
    try {
      git(['worktree', 'prune', '--expire', 'now']);
    } catch {
      // The fixture may intentionally corrupt its source registration.
    }
    const removalOptions = { recursive: true, force: true } as const;
    rmSync(fixture.root, removalOptions);
  }

  static fixtureGit(fixture: GitFixture): GitRunner {
    return (args: readonly string[]) => {
      const execution: GitExecution = { cwd: fixture.sourceRoot, args };
      return ModuleDeliveryWorktreeTestSupportScenario.executeGit(execution);
    };
  }

  static worktreeGit(workspace: ModuleWorktreeHandle): GitRunner {
    return (args: readonly string[]) => {
      const execution: GitExecution = { cwd: workspace.worktreePath, args };
      return ModuleDeliveryWorktreeTestSupportScenario.executeGit(execution);
    };
  }

  static writeFixtureFile(write: FixtureFileWrite): void {
    const path = join(write.fixture.sourceRoot, write.relativePath);
    const directoryOptions = { recursive: true } as const;
    mkdirSync(join(path, '..'), directoryOptions);
    writeFileSync(path, write.contents);
  }

  static writeWorktreeFile(write: WorktreeFileWrite): void {
    const path = join(write.workspace.worktreePath, write.relativePath);
    const directoryOptions = { recursive: true } as const;
    mkdirSync(join(path, '..'), directoryOptions);
    writeFileSync(path, write.contents);
  }

  static fixtureFileWriter(fixture: GitFixture): FixtureFileWriter {
    return (entry: FixtureFileEntry) => {
      const write: FixtureFileWrite = {
        fixture,
        relativePath: entry[0],
        contents: entry[1],
      };
      ModuleDeliveryWorktreeTestSupportScenario.writeFixtureFile(write);
    };
  }

  static worktreeFileWriter(
    workspace: ModuleWorktreeHandle,
  ): FixtureFileWriter {
    return (entry: FixtureFileEntry) => {
      const write: WorktreeFileWrite = {
        workspace,
        relativePath: entry[0],
        contents: entry[1],
      };
      ModuleDeliveryWorktreeTestSupportScenario.writeWorktreeFile(write);
    };
  }

  static prepareRequest(fixture: GitFixture): PrepareModuleWorktreeRequest {
    return {
      repositoryRoot: fixture.sourceRoot,
      workspaceRoot: fixture.workspaceRoot,
      planDigest: PLAN_DIGEST,
      taskId: 'core-provider',
      attempt: 1,
      baselineCommit: fixture.baselineCommit,
    };
  }

  static installCheckoutHook(fixture: GitFixture): string {
    const hooksDirectory = join(fixture.sourceRoot, '.git', 'hooks');
    const markerPath = join(fixture.root, 'hook-ran');
    const hookPath = join(hooksDirectory, 'post-checkout');
    writeFileSync(hookPath, `#!/bin/sh\ntouch '${markerPath}'\n`);
    chmodSync(hookPath, 0o755);
    return markerPath;
  }
}

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
