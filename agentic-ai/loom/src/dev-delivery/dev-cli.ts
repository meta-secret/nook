import { isAbsolute, resolve } from 'node:path';
import { err, ok, type Result } from 'neverthrow';

import { ProcessCommandRunner } from './dev-command.ts';
import { DevDeliveryWorkspace } from './dev-workspace.ts';
import {
  CommitSha,
  DevFailureKind,
  type DevFailure,
} from './dev-types.ts';

export interface DevCliMessage {
  readonly message: string;
}

/**
 * Prime-issued provenance carried by the serialized dev:land task.
 *
 * The request deliberately retains both feature-head fields: `featureHeadSha`
 * is the provenance identity from the delivery packet, while
 * `expectedFeatureSha` is the exact branch head the landing operation must
 * observe. The downstream DevLandRequest owns the final relationship check.
 */
export interface DevLandProvenancePacket {
  /** Exact assigned canonical local-dev checkout path. */
  readonly devPath: string;
  readonly originMainSha: CommitSha;
  readonly pinnedLocalDevSha: CommitSha;
  readonly featureHeadSha: CommitSha;
  readonly expectedFeatureSha: CommitSha;
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

  /** Resolves every exact identity required by the dev:land packet. */
  static requiredDevLandPacket(): Result<
    DevLandProvenancePacket,
    DevFailure
  > {
    const devPath = DevCli.requiredAbsolutePath('DEV_PATH');
    if (devPath.isErr()) return err(devPath.error);
    const originMainSha = DevCli.requiredCommitSha('ORIGIN_MAIN_SHA');
    if (originMainSha.isErr()) return err(originMainSha.error);
    const pinnedLocalDevSha = DevCli.requiredCommitSha('PINNED_LOCAL_DEV_SHA');
    if (pinnedLocalDevSha.isErr()) return err(pinnedLocalDevSha.error);
    const featureHeadSha = DevCli.requiredCommitSha('FEATURE_HEAD_SHA');
    if (featureHeadSha.isErr()) return err(featureHeadSha.error);
    const expectedFeatureSha = DevCli.requiredCommitSha('EXPECTED_FEATURE_SHA');
    if (expectedFeatureSha.isErr()) return err(expectedFeatureSha.error);
    return ok({
      devPath: devPath.value,
      originMainSha: originMainSha.value,
      pinnedLocalDevSha: pinnedLocalDevSha.value,
      featureHeadSha: featureHeadSha.value,
      expectedFeatureSha: expectedFeatureSha.value,
    });
  }
}
