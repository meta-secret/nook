import { isAbsolute, resolve } from 'node:path';
import { err, ok, type Result } from 'neverthrow';

import { ProcessCommandRunner } from './dev-command.ts';
import { DevDeliveryWorkspace } from './dev-workspace.ts';
import {
  BranchName,
  CommitSha,
  DevLandBuildProofMode,
  DevFailureKind,
  type DevLandBuildProof,
  type DevFailure,
  type DevLandRequest,
  type LocalBuildEvidenceRequest,
} from './dev-types.ts';
import { LOCAL_BUILD_EVIDENCE_AUTHORIZATION } from './local-build-evidence.ts';

export interface DevCliMessage {
  readonly message: string;
}

/**
 * Prime-issued target and provenance carried by the serialized dev:land task.
 * The feature worktree HEAD is intentionally absent: the CLI observes it
 * after validating the authorized branch identity.
 */
export interface DevLandProvenancePacket {
  /** Exact canonical feature branch authorized for local integration. */
  readonly featureBranch: BranchName;
  /** Optional explicit one-off local proof; remote proof is the default. */
  readonly localBuildEvidence?: LocalBuildEvidenceRequest;
}

/** Provides the manual task boundary and a single human-readable failure format. */
export class DevCli {
  static repositoryRoot(): string {
    const configured = process.env.REPO_ROOT;
    return typeof configured === 'string' && configured.length > 0
      ? resolve(configured)
      : resolve(process.cwd());
  }

  static workspace(): DevDeliveryWorkspace {
    return new DevDeliveryWorkspace({
      root: DevCli.repositoryRoot(),
      runner: new ProcessCommandRunner({
        repositoryRoot: DevCli.repositoryRoot(),
      }),
    });
  }

  static report(result: Result<DevCliMessage, DevFailure>): number {
    if (result.isErr()) {
      process.stderr.write(`[${result.error.kind}] ${result.error.message}\n`);
      return 1;
    }
    process.stdout.write(`${result.value.message}\n`);
    return 0;
  }

  static missingEnvironment(name: string): Result<never, DevFailure> {
    return err({
      kind: DevFailureKind.Configuration,
      message: `${name} is required for this manual dev-manager task`,
    });
  }

  static requiredCommitSha(name: string): Result<CommitSha, DevFailure> {
    const raw = process.env[name];
    return typeof raw === 'string'
      ? CommitSha.parse(raw)
      : DevCli.missingEnvironment(name);
  }

  static requiredAbsolutePath(name: string): Result<string, DevFailure> {
    const raw = process.env[name];
    if (typeof raw !== 'string') return DevCli.missingEnvironment(name);
    if (raw.length === 0 || raw.includes('\u0000') || !isAbsolute(raw)) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `${name} must be a non-empty absolute path for this manual dev-manager task`,
      });
    }
    return ok(raw);
  }

  /** Resolves the target identities required by the dev:land packet. */
  static requiredDevLandPacket(): Result<DevLandProvenancePacket, DevFailure> {
    const featureBranch = DevCli.requiredFeatureBranch();
    if (featureBranch.isErr()) return err(featureBranch.error);
    const localBuildEvidence = DevCli.optionalLocalBuildEvidence();
    if (localBuildEvidence.isErr()) return err(localBuildEvidence.error);
    return ok({
      featureBranch: featureBranch.value,
      ...(localBuildEvidence.value.mode === DevLandBuildProofMode.Local
        ? { localBuildEvidence: localBuildEvidence.value.evidence }
        : {}),
    });
  }

  static requiredFeatureBranch(): Result<BranchName, DevFailure> {
    const raw = process.env.FEATURE_BRANCH;
    return typeof raw === 'string'
      ? BranchName.parseFeature(raw)
      : DevCli.missingEnvironment('FEATURE_BRANCH');
  }

  static optionalLocalBuildEvidence(): Result<DevLandBuildProof, DevFailure> {
    const path = process.env.LOCAL_BUILD_EVIDENCE_PATH;
    const authorization = process.env.LOCAL_BUILD_EVIDENCE_AUTHORIZATION;
    const noSelection =
      (typeof path !== 'string' || path === '') &&
      (typeof authorization !== 'string' || authorization === '');
    if (noSelection) return ok({ mode: DevLandBuildProofMode.Remote });
    if (authorization !== LOCAL_BUILD_EVIDENCE_AUTHORIZATION) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          'LOCAL_BUILD_EVIDENCE_AUTHORIZATION must be one-off-local when local proof is selected',
      });
    }
    const evidencePath = DevCli.requiredAbsolutePath(
      'LOCAL_BUILD_EVIDENCE_PATH',
    );
    if (evidencePath.isErr()) return err(evidencePath.error);
    return ok({
      mode: DevLandBuildProofMode.Local,
      evidence: {
        path: evidencePath.value,
        authorization: LOCAL_BUILD_EVIDENCE_AUTHORIZATION,
      },
    });
  }

  /** Binds the serialized target to the feature worktree state observed locally. */
  static observeDevLandRequest(
    ...[workspace, packet]: [
      workspace: DevDeliveryWorkspace,
      packet: DevLandProvenancePacket,
    ]
  ): Result<DevLandRequest, DevFailure> {
    const featureBranch = workspace.git.currentBranch();
    if (featureBranch.isErr()) return err(featureBranch.error);
    if (!featureBranch.value.equals(packet.featureBranch)) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `The feature worktree branch ${featureBranch.value.value()} does not match the authorized FEATURE_BRANCH ${packet.featureBranch.value()}`,
      });
    }
    return ok(packet);
  }
}
