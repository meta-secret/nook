import { err, ok, type Result } from 'neverthrow';

import { DevPrManagerCommand } from './dev-pr-manager.ts';
import { DevPublishCommand } from './dev-publish.ts';
import { DevDeliveryWorkspace } from './dev-workspace.ts';
import { Ancestry, RemoteBranchPresence } from './dev-types.ts';
import {
  DevFailureKind,
  ManagedBranch,
  type CommitSha,
  type DevFailure,
  type DevSnapshot,
  type DevelopmentPullRequest,
  type RemoteBranchSnapshot,
  type WorktreeRecord,
  WorktreeState,
} from './dev-types.ts';
import { type DevLockLease } from './dev-lock.ts';

export enum DevManagerGizmoState {
  Idle = 'idle',
  ValidationRequired = 'validation-required',
  ValidationFrozen = 'validation-frozen',
  ReviewRequired = 'review-required',
  EvidenceRequired = 'evidence-required',
  RepairRequired = 'repair-required',
  PromotionReady = 'promotion-ready',
  ReconcileRequired = 'reconcile-required',
}

export enum DevManagerGizmoAction {
  NoAction = 'no-action',
  Publish = 'publish',
  WaitForValidation = 'wait-for-validation',
  ObtainReview = 'obtain-review',
  ObtainEvidence = 'obtain-evidence',
  RequestRepair = 'request-feature-gizmo-repair',
  Promote = 'promote',
  Reconcile = 'reconcile',
}

export enum DevCommitRelation {
  Equal = 'equal',
  Ahead = 'ahead',
  Behind = 'behind',
  Diverged = 'diverged',
}

export interface DevManagerGizmoOutcome {
  readonly state: DevManagerGizmoState;
  readonly action: DevManagerGizmoAction;
  readonly localDevPath: string;
  readonly localDevSha: CommitSha;
  readonly originMainSha: CommitSha;
  readonly originDev: RemoteBranchSnapshot;
  readonly expectedSha: CommitSha;
  readonly pullRequestUrl?: string;
  readonly message: string;
}

interface DevManagerGizmoInspection extends DevSnapshot {
  readonly worktree: WorktreeRecord;
  readonly originMainSha: CommitSha;
  readonly originDev: RemoteBranchSnapshot;
  readonly localToMain: DevCommitRelation;
  readonly localToOriginDev: DevCommitRelation | undefined;
}

interface DevManagerGizmoLocks {
  readonly publication: DevLockLease;
  readonly local: DevLockLease;
}

enum DevManagerGizmoPlanKind {
  Report = 'report',
  Publish = 'publish',
  PrManager = 'pr-manager',
}

type DevManagerGizmoPlan =
  | {
      readonly kind: DevManagerGizmoPlanKind.Report;
      readonly outcome: DevManagerGizmoOutcome;
    }
  | {
      readonly kind: DevManagerGizmoPlanKind.Publish;
      readonly inspection: DevManagerGizmoInspection;
    }
  | {
      readonly kind: DevManagerGizmoPlanKind.PrManager;
      readonly inspection: DevManagerGizmoInspection;
    };

/** Performs one manual exact-SHA dev-manager observation and bounded handoff. */
export class DevManagerGizmoCommand {
  constructor(private readonly workspace: DevDeliveryWorkspace) {}

  execute(): Result<DevManagerGizmoOutcome, DevFailure> {
    const plan = this.inspectAndPlan();
    if (plan.isErr()) return err(plan.error);
    switch (plan.value.kind) {
      case DevManagerGizmoPlanKind.Report:
        return ok(plan.value.outcome);
      case DevManagerGizmoPlanKind.Publish:
        return this.publish(plan.value.inspection);
      case DevManagerGizmoPlanKind.PrManager:
        return this.runPrManager(plan.value.inspection);
    }
  }

  private inspectAndPlan(): Result<DevManagerGizmoPlan, DevFailure> {
    const locks = this.acquireLocks();
    if (locks.isErr()) return err(locks.error);
    const inspection = this.inspectInsideLocks();
    const plan = inspection.isErr()
      ? err<DevManagerGizmoPlan, DevFailure>(inspection.error)
      : this.planInsideLocks(inspection.value);
    const released = this.releaseLocks(locks.value);
    if (released.isErr()) return err(released.error);
    return plan;
  }

  private inspectInsideLocks(): Result<DevManagerGizmoInspection, DevFailure> {
    const refreshed = this.workspace.git.refreshManagedRefs();
    if (refreshed.isErr()) return err(refreshed.error);
    const development = this.workspace.developmentWorktree();
    if (development.isErr()) return err(development.error);
    const worktree = development.value;
    const state = this.workspace.git.stateAt(worktree.path);
    if (state.isErr()) return err(state.error);
    if (state.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message: `Local dev is dirty; refusing to select a manager snapshot: ${worktree.path}`,
      });
    }
    const branch = this.workspace.git.branchAt(worktree.path);
    if (branch.isErr()) return err(branch.error);
    if (branch.value.value() !== ManagedBranch.Dev) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Selected development worktree is not on dev: ${worktree.path}`,
      });
    }
    const localDevSha = this.workspace.git.headAt(worktree.path);
    if (localDevSha.isErr()) return err(localDevSha.error);
    if (!localDevSha.value.equals(worktree.head)) {
      return err({
        kind: DevFailureKind.Race,
        message: `Local dev changed while its exact snapshot was being observed: expected ${worktree.head.value()}, found ${localDevSha.value.value()}`,
      });
    }
    const originMain = this.workspace.git.remoteBranch(ManagedBranch.Main);
    if (originMain.isErr()) return err(originMain.error);
    if (originMain.value.presence !== RemoteBranchPresence.Present) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          'origin/main must exist before the manager can select a snapshot',
      });
    }
    const originDev = this.workspace.git.remoteBranch(ManagedBranch.Dev);
    if (originDev.isErr()) return err(originDev.error);
    const localToMain = this.relation({
      base: originMain.value.sha,
      candidate: localDevSha.value,
      workingDirectory: worktree.path,
    });
    if (localToMain.isErr()) return err(localToMain.error);
    let localToOriginDev: DevCommitRelation | undefined;
    if (originDev.value.presence === RemoteBranchPresence.Present) {
      const relation = this.relation({
        base: originDev.value.sha,
        candidate: localDevSha.value,
        workingDirectory: worktree.path,
      });
      if (relation.isErr()) return err(relation.error);
      localToOriginDev = relation.value;
    }
    return ok({
      devPath: worktree.path,
      devSha: localDevSha.value,
      worktree,
      originMainSha: originMain.value.sha,
      originDev: originDev.value,
      localToMain: localToMain.value,
      localToOriginDev,
    });
  }

  private planInsideLocks(
    inspection: DevManagerGizmoInspection,
  ): Result<DevManagerGizmoPlan, DevFailure> {
    if (
      inspection.localToMain === DevCommitRelation.Behind ||
      inspection.localToMain === DevCommitRelation.Diverged
    ) {
      return ok({
        kind: DevManagerGizmoPlanKind.Report,
        outcome: this.outcome({
          inspection,
          state: DevManagerGizmoState.ReconcileRequired,
          action: DevManagerGizmoAction.Reconcile,
          expectedSha: inspection.originMainSha,
          detail:
            'local dev is not based on the refreshed origin/main; reconcile through the feature path before publishing',
        }),
      });
    }

    if (
      inspection.localToMain === DevCommitRelation.Equal &&
      inspection.localToOriginDev === undefined
    ) {
      return ok({
        kind: DevManagerGizmoPlanKind.Report,
        outcome: this.outcome({
          inspection,
          state: DevManagerGizmoState.Idle,
          action: DevManagerGizmoAction.NoAction,
          expectedSha: inspection.devSha,
          detail: 'no local commits exist beyond origin/main',
        }),
      });
    }

    if (
      inspection.localToMain === DevCommitRelation.Equal &&
      inspection.localToOriginDev === DevCommitRelation.Equal
    ) {
      return ok({
        kind: DevManagerGizmoPlanKind.Report,
        outcome: this.outcome({
          inspection,
          state: DevManagerGizmoState.Idle,
          action: DevManagerGizmoAction.NoAction,
          expectedSha: inspection.devSha,
          detail: 'no local commits exist beyond origin/main',
        }),
      });
    }

    if (
      inspection.localToOriginDev === DevCommitRelation.Behind ||
      inspection.localToOriginDev === DevCommitRelation.Diverged
    ) {
      return ok({
        kind: DevManagerGizmoPlanKind.Report,
        outcome: this.outcome({
          inspection,
          state: DevManagerGizmoState.ReconcileRequired,
          action: DevManagerGizmoAction.Reconcile,
          expectedSha: this.remoteDevSha(inspection),
          detail:
            'origin/dev is newer or divergent; preserve it and reconcile local dev through the feature path',
        }),
      });
    }

    if (inspection.localToOriginDev === undefined) {
      return ok({
        kind: DevManagerGizmoPlanKind.Publish,
        inspection,
      });
    }

    if (inspection.localToOriginDev === DevCommitRelation.Ahead) {
      return this.planUnpublishedLocalDev(inspection);
    }

    return this.planFrozenSnapshot(inspection);
  }

  private planUnpublishedLocalDev(
    inspection: DevManagerGizmoInspection,
  ): Result<DevManagerGizmoPlan, DevFailure> {
    const pullRequest = this.workspace.github.findDevelopmentPullRequest({
      workingDirectory: this.workspace.root,
    });
    if (pullRequest.isErr()) return err(pullRequest.error);
    if (pullRequest.value.kind === 'found') {
      return this.planFrozenPullRequest({
        inspection,
        pullRequest: pullRequest.value.pullRequest,
      });
    }
    return ok({ kind: DevManagerGizmoPlanKind.Publish, inspection });
  }

  private planFrozenSnapshot(
    inspection: DevManagerGizmoInspection,
  ): Result<DevManagerGizmoPlan, DevFailure> {
    const expectedSha = this.remoteDevSha(inspection);
    const pullRequest = this.workspace.github.findDevelopmentPullRequest({
      workingDirectory: this.workspace.root,
    });
    if (pullRequest.isErr()) return err(pullRequest.error);
    if (pullRequest.value.kind === 'absent') {
      return ok({
        kind: DevManagerGizmoPlanKind.PrManager,
        inspection,
      });
    }
    return this.planFrozenPullRequest({
      inspection,
      pullRequest: pullRequest.value.pullRequest,
    });
  }

  private planFrozenPullRequest(request: {
    readonly inspection: DevManagerGizmoInspection;
    readonly pullRequest: DevelopmentPullRequest;
  }): Result<DevManagerGizmoPlan, DevFailure> {
    const expectedSha = this.remoteDevSha(request.inspection);
    const currentPullRequest = request.pullRequest;
    if (!currentPullRequest.headSha.equals(expectedSha)) {
      return err({
        kind: DevFailureKind.Race,
        message: `The live dev-to-main pull request is at ${currentPullRequest.headSha.value()} but origin/dev is at ${expectedSha.value()}; refusing to infer validation state`,
      });
    }
    if (currentPullRequest.isDraft) {
      return ok({
        kind: DevManagerGizmoPlanKind.Report,
        outcome: this.outcome({
          inspection: request.inspection,
          state: DevManagerGizmoState.ReviewRequired,
          action: DevManagerGizmoAction.ObtainReview,
          expectedSha,
          detail: 'the dev-to-main pull request is still a draft',
        }),
      });
    }
    const terminal = this.workspace.github.requireDevelopmentCiTerminal({
      sha: expectedSha,
      workingDirectory: this.workspace.root,
      replacement: true,
    });
    if (terminal.isErr()) {
      return this.planPriorValidationBlocker({
        inspection: request.inspection,
        expectedSha,
        failure: terminal.error,
      });
    }
    const evidence = this.workspace.github.requirePromotionEvidence({
      sha: expectedSha,
      pullRequest: currentPullRequest,
      workingDirectory: this.workspace.root,
    });
    if (evidence.isErr()) {
      return this.planPromotionBlocker({
        inspection: request.inspection,
        expectedSha,
        failure: evidence.error,
      });
    }
    return ok({
      kind: DevManagerGizmoPlanKind.Report,
      outcome: this.outcome({
        inspection: request.inspection,
        state: DevManagerGizmoState.PromotionReady,
        action: DevManagerGizmoAction.Promote,
        expectedSha,
        detail:
          'complete exact-head validation, review, security, and deployment evidence was observed; promotion remains a separate guarded operation',
      }),
    });
  }

  private planPriorValidationBlocker(request: {
    readonly inspection: DevManagerGizmoInspection;
    readonly expectedSha: CommitSha;
    readonly failure: DevFailure;
  }): Result<DevManagerGizmoPlan, DevFailure> {
    if (request.failure.kind !== DevFailureKind.Checks) {
      return err(request.failure);
    }
    const isActive = / is (queued|in_progress);/u.test(request.failure.message);
    return ok({
      kind: DevManagerGizmoPlanKind.Report,
      outcome: this.outcome({
        inspection: request.inspection,
        state: isActive
          ? DevManagerGizmoState.ValidationFrozen
          : DevManagerGizmoState.ValidationRequired,
        action: DevManagerGizmoAction.WaitForValidation,
        expectedSha: request.expectedSha,
        detail: isActive
          ? `${request.failure.message}; local dev is newer and remains preserved`
          : `${request.failure.message}; obtain an exact-head terminal outcome before replacing origin/dev`,
      }),
    });
  }

  private planPromotionBlocker(request: {
    readonly inspection: DevManagerGizmoInspection;
    readonly expectedSha: CommitSha;
    readonly failure: DevFailure;
  }): Result<DevManagerGizmoPlan, DevFailure> {
    switch (request.failure.kind) {
      case DevFailureKind.Checks:
        return ok({
          kind: DevManagerGizmoPlanKind.Report,
          outcome: this.outcome({
            inspection: request.inspection,
            state: DevManagerGizmoState.RepairRequired,
            action: DevManagerGizmoAction.RequestRepair,
            expectedSha: request.expectedSha,
            detail: `${request.failure.message}; route the failed snapshot through a Feature Gizmo for repair`,
          }),
        });
      case DevFailureKind.Reviews:
        return ok({
          kind: DevManagerGizmoPlanKind.Report,
          outcome: this.outcome({
            inspection: request.inspection,
            state: DevManagerGizmoState.ReviewRequired,
            action: DevManagerGizmoAction.ObtainReview,
            expectedSha: request.expectedSha,
            detail: request.failure.message,
          }),
        });
      case DevFailureKind.Deployment:
      case DevFailureKind.Evidence:
        return ok({
          kind: DevManagerGizmoPlanKind.Report,
          outcome: this.outcome({
            inspection: request.inspection,
            state: DevManagerGizmoState.EvidenceRequired,
            action: DevManagerGizmoAction.ObtainEvidence,
            expectedSha: request.expectedSha,
            detail: `${request.failure.message}; collect the required security/deployment evidence`,
          }),
        });
      default:
        return err(request.failure);
    }
  }

  private publish(
    inspection: DevManagerGizmoInspection,
  ): Result<DevManagerGizmoOutcome, DevFailure> {
    const published = new DevPublishCommand(this.workspace).execute();
    if (published.isErr()) {
      if (published.error.kind === DevFailureKind.Checks) {
        return ok(
          this.outcome({
            inspection,
            state: DevManagerGizmoState.ValidationFrozen,
            action: DevManagerGizmoAction.WaitForValidation,
            expectedSha: this.remoteDevSha(inspection),
            detail: `${published.error.message}; local dev remains preserved`,
          }),
        );
      }
      return err(
        this.operationFailure({ inspection, failure: published.error }),
      );
    }
    const manager = new DevPrManagerCommand(this.workspace).execute();
    if (manager.isErr()) {
      return err(this.operationFailure({ inspection, failure: manager.error }));
    }
    return ok(
      this.outcome({
        inspection: this.afterPublication(inspection, published.value.devSha),
        state: DevManagerGizmoState.ValidationRequired,
        action: DevManagerGizmoAction.WaitForValidation,
        expectedSha: published.value.devSha,
        pullRequestUrl: manager.value.pullRequestUrl,
        detail:
          'published the selected local dev snapshot and prepared the manager-owned dev-to-main pull request; wait for complete exact-head evidence',
      }),
    );
  }

  private runPrManager(
    inspection: DevManagerGizmoInspection,
  ): Result<DevManagerGizmoOutcome, DevFailure> {
    const manager = new DevPrManagerCommand(this.workspace).execute();
    if (manager.isErr()) {
      return err(this.operationFailure({ inspection, failure: manager.error }));
    }
    return ok(
      this.outcome({
        inspection,
        state: DevManagerGizmoState.ValidationRequired,
        action: DevManagerGizmoAction.WaitForValidation,
        expectedSha: manager.value.devSha,
        pullRequestUrl: manager.value.pullRequestUrl,
        detail:
          'prepared the manager-owned dev-to-main pull request; wait for complete exact-head checks, review, security, and deployment evidence',
      }),
    );
  }

  private afterPublication(
    inspection: DevManagerGizmoInspection,
    devSha: CommitSha,
  ): DevManagerGizmoInspection {
    return {
      ...inspection,
      devSha,
      originDev: {
        presence: RemoteBranchPresence.Present,
        branch: ManagedBranch.Dev,
        sha: devSha,
      },
      localToOriginDev: DevCommitRelation.Equal,
    };
  }

  private operationFailure(request: {
    readonly inspection: DevManagerGizmoInspection;
    readonly failure: DevFailure;
  }): DevFailure {
    return {
      kind: request.failure.kind,
      message: `${request.failure.message}; expected SHA: ${request.inspection.devSha.value()}; next action: stop and inspect the exact local/remote state before retrying`,
    };
  }

  private outcome(request: {
    readonly inspection: DevManagerGizmoInspection;
    readonly state: DevManagerGizmoState;
    readonly action: DevManagerGizmoAction;
    readonly expectedSha: CommitSha;
    readonly detail: string;
    readonly pullRequestUrl?: string;
  }): DevManagerGizmoOutcome {
    const pullRequestUrl = request.pullRequestUrl;
    const pullRequestLine = pullRequestUrl ?? 'not observed';
    return {
      state: request.state,
      action: request.action,
      localDevPath: request.inspection.devPath,
      localDevSha: request.inspection.devSha,
      originMainSha: request.inspection.originMainSha,
      originDev: request.inspection.originDev,
      expectedSha: request.expectedSha,
      ...(pullRequestUrl ? { pullRequestUrl } : {}),
      message: [
        'Dev Manager Gizmo report',
        `state: ${request.state}`,
        `action: ${request.action}`,
        `local dev worktree: ${request.inspection.devPath}`,
        `local dev SHA: ${request.inspection.devSha.value()}`,
        `origin/main SHA: ${request.inspection.originMainSha.value()}`,
        `origin/dev SHA: ${this.remoteDevText(request.inspection.originDev)}`,
        `local dev vs origin/main: ${request.inspection.localToMain}`,
        `local dev vs origin/dev: ${this.localToOriginDevText(request.inspection)}`,
        `expected SHA: ${request.expectedSha.value()}`,
        `pull request: ${pullRequestLine}`,
        `next action: ${request.detail}`,
      ].join('\n'),
    };
  }

  private relation(request: {
    readonly base: CommitSha;
    readonly candidate: CommitSha;
    readonly workingDirectory: string;
  }): Result<DevCommitRelation, DevFailure> {
    if (request.base.equals(request.candidate))
      return ok(DevCommitRelation.Equal);
    const baseFirst = this.workspace.git.ancestry({
      ancestor: request.base,
      descendant: request.candidate,
      workingDirectory: request.workingDirectory,
    });
    if (baseFirst.isErr()) return err(baseFirst.error);
    if (baseFirst.value === Ancestry.Ancestor)
      return ok(DevCommitRelation.Ahead);
    const candidateFirst = this.workspace.git.ancestry({
      ancestor: request.candidate,
      descendant: request.base,
      workingDirectory: request.workingDirectory,
    });
    if (candidateFirst.isErr()) return err(candidateFirst.error);
    return ok(
      candidateFirst.value === Ancestry.Ancestor
        ? DevCommitRelation.Behind
        : DevCommitRelation.Diverged,
    );
  }

  private remoteDevSha(inspection: DevManagerGizmoInspection): CommitSha {
    if (inspection.originDev.presence === RemoteBranchPresence.Absent) {
      return inspection.devSha;
    }
    return inspection.originDev.sha;
  }

  private remoteDevText(snapshot: RemoteBranchSnapshot): string {
    return snapshot.presence === RemoteBranchPresence.Present
      ? snapshot.sha.value()
      : 'absent';
  }

  private localToOriginDevText(inspection: DevManagerGizmoInspection): string {
    return inspection.localToOriginDev ?? 'unpublished';
  }

  private acquireLocks(): Result<DevManagerGizmoLocks, DevFailure> {
    const publication = this.workspace.publicationLock();
    if (publication.isErr()) return err(publication.error);
    const local = this.workspace.localLock();
    if (local.isErr()) {
      const released = publication.value.release();
      return released.isErr() ? err(released.error) : err(local.error);
    }
    return ok({ publication: publication.value, local: local.value });
  }

  private releaseLocks(locks: DevManagerGizmoLocks): Result<void, DevFailure> {
    const local = locks.local.release();
    if (local.isErr()) return err(local.error);
    const publication = locks.publication.release();
    if (publication.isErr()) return err(publication.error);
    return ok();
  }
}
