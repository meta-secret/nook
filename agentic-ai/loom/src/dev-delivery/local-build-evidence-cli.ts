import { err, ok, type Result } from 'neverthrow';

import { DevCli, type DevCliMessage } from './dev-cli.ts';
import {
  LOCAL_BUILD_EVIDENCE_AUTHORIZATION,
  LocalBuildEvidenceGenerator,
  LocalBuildEvidenceStore,
  LOCAL_BUILD_TASKS,
  ProcessLocalBuildCommandRunner,
  type LocalBuildTaskName,
} from './local-build-evidence.ts';
import { DevFailureKind, type DevFailure } from './dev-types.ts';

/** Owns the repository task boundary for an explicitly requested local proof. */
export class LocalBuildEvidenceCli {
  static execute(): Result<DevCliMessage, DevFailure> {
    const branch = DevCli.requiredFeatureBranch();
    if (branch.isErr()) return err(branch.error);
    const task = LocalBuildEvidenceCli.taskName();
    if (task.isErr()) return err(task.error);
    const workspace = DevCli.workspace();
    const currentBranch = workspace.git.currentBranch();
    if (currentBranch.isErr()) return err(currentBranch.error);
    if (!currentBranch.value.equals(branch.value)) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `The feature worktree branch ${currentBranch.value.value()} does not match FEATURE_BRANCH ${branch.value.value()}`,
      });
    }
    const state = workspace.git.stateAt(workspace.root);
    if (state.isErr()) return err(state.error);
    if (state.value !== 'clean') {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message: `Feature worktree is dirty; refusing to generate local build evidence: ${workspace.root}`,
      });
    }
    const sourceSha = workspace.git.head();
    if (sourceSha.isErr()) return err(sourceSha.error);
    const outputPath = LocalBuildEvidenceCli.outputPath({
      repositoryRoot: workspace.root,
      sourceSha: sourceSha.value,
    });
    if (outputPath.isErr()) return err(outputPath.error);
    const taskId =
      process.env.LOCAL_BUILD_TASK_ID ||
      `local-build-${sourceSha.value.value().slice(0, 12)}-${task.value.replaceAll(':', '-')}`;
    const attempt = LocalBuildEvidenceCli.attempt();
    if (attempt.isErr()) return err(attempt.error);
    const result = new LocalBuildEvidenceGenerator({
      runner: new ProcessLocalBuildCommandRunner(workspace.root),
    }).execute({
      repositoryRoot: workspace.root,
      source: { branch: branch.value, commit: sourceSha.value },
      task: { id: taskId, attempt: attempt.value, name: task.value },
      outputPath: outputPath.value,
    });
    return result.map(() => ({
      message: `Generated one-off local build evidence at ${outputPath.value}; authorize dev:land with LOCAL_BUILD_EVIDENCE_AUTHORIZATION=${LOCAL_BUILD_EVIDENCE_AUTHORIZATION}`,
    }));
  }

  private static taskName(): Result<LocalBuildTaskName, DevFailure> {
    const raw = process.env.LOCAL_BUILD_TASK || 'rust:build';
    const task = LOCAL_BUILD_TASKS.find((candidate) => candidate === raw);
    if (task) return ok(task);
    return err({
      kind: DevFailureKind.Configuration,
      message: `LOCAL_BUILD_TASK must be one of: ${LOCAL_BUILD_TASKS.join(', ')}`,
    });
  }

  private static attempt(): Result<number, DevFailure> {
    const raw = process.env.LOCAL_BUILD_ATTEMPT || '1';
    if (!/^[1-9][0-9]*$/u.test(raw)) {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'LOCAL_BUILD_ATTEMPT must be a positive integer',
      });
    }
    const value = Number(raw);
    return Number.isSafeInteger(value)
      ? ok(value)
      : err({
          kind: DevFailureKind.Configuration,
          message: 'LOCAL_BUILD_ATTEMPT must be a safe positive integer',
        });
  }

  private static outputPath(request: {
    readonly repositoryRoot: string;
    readonly sourceSha: Parameters<
      typeof LocalBuildEvidenceStore.defaultPath
    >[0]['sourceSha'];
  }): Result<string, DevFailure> {
    const configured = process.env.LOCAL_BUILD_EVIDENCE_PATH;
    if (typeof configured !== 'string' || configured === '')
      return ok(LocalBuildEvidenceStore.defaultPath(request));
    return DevCli.requiredAbsolutePath('LOCAL_BUILD_EVIDENCE_PATH');
  }
}

if (import.meta.main) {
  process.exitCode = DevCli.report(LocalBuildEvidenceCli.execute());
}
