import { realpathSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import {
  CanonicalFeatureBranchContract,
  CanonicalWorkerBranchContract,
} from '../lib/base-evidence.ts';
import { ModuleDeliveryIssueCode, ModuleDeliveryTaskKind } from './domain.ts';
import type { ModuleDeliveryIssue } from './domain.ts';
import { TeamKey } from '../team-agents/catalog.ts';
import type {
  IssueRequest,
  ValidationState,
} from './plan-validation-context.ts';

type BranchIssueRequest = Omit<IssueRequest, 'code'>;

export class ModuleDeliveryBranchAssignmentValidation {
  private constructor() {}

  static validate(state: ValidationState): void {
    if (state.plan.baseBranch !== 'origin/main')
      this.addIssue({
        state,
        path: '$.baseBranch',
        message: 'baseBranch must select freshly fetched origin/main.',
      });
    try {
      CanonicalFeatureBranchContract.parse(state.plan.featureBranch);
    } catch {
      this.addIssue({
        state,
        path: '$.featureBranch',
        message: 'featureBranch must be a canonical codex branch.',
      });
    }
    const workerBranches = new Set<string>();
    const worktreePaths = new Set<string>();
    const featureSegment = state.plan.featureBranch.split('/')[1];
    for (const [index, node] of state.plan.nodes.entries()) {
      if (node.kind !== ModuleDeliveryTaskKind.Write) continue;
      const workspacePath = `$.nodes[${index}].workspace`;
      const branchSegments = node.workspace.workerBranch.split('/');
      const normalizedWorktreePath = this.canonicalWorktreePath(
        node.workspace.worktreePath,
      );
      try {
        CanonicalWorkerBranchContract.parse(node.workspace.workerBranch);
      } catch {
        this.addIssue({
          state,
          path: `${workspacePath}.workerBranch`,
          message: 'workerBranch must be a canonical codex worker branch.',
        });
      }
      if (
        branchSegments[2] !== this.workerTeamSegment(node.team) ||
        branchSegments[3] !== node.workspace.workerRole ||
        branchSegments[4] !== featureSegment ||
        workerBranches.has(node.workspace.workerBranch)
      )
        this.addIssue({
          state,
          path: `${workspacePath}.workerBranch`,
          message:
            'workerBranch must match the assigned team and role, name the canonical feature segment, and be unique.',
        });
      if (
        !isAbsolute(node.workspace.worktreePath) ||
        [...worktreePaths].some((existing) =>
          this.worktreePathsOverlap({
            first: existing,
            second: normalizedWorktreePath,
          }),
        )
      )
        this.addIssue({
          state,
          path: `${workspacePath}.worktreePath`,
          message: 'worktreePath must be a unique absolute path.',
        });
      workerBranches.add(node.workspace.workerBranch);
      worktreePaths.add(normalizedWorktreePath);
    }
  }

  private static workerTeamSegment(team: TeamKey): string {
    switch (team) {
      case TeamKey.Ai:
        return 'ai';
      case TeamKey.DevelopmentCore:
        return 'dev-core';
      case TeamKey.Security:
        return 'security';
      case TeamKey.Sre:
        return 'sre';
      case TeamKey.WebDevelopment:
        return 'web-dev';
      case TeamKey.DeliveryPipeline:
        return 'delivery-pipeline';
    }
  }

  private static canonicalWorktreePath(path: string): string {
    const resolved = resolve(path);
    const missingSegments: string[] = [];
    let existingParent = resolved;
    while (true) {
      try {
        return resolve(
          realpathSync.native(existingParent),
          ...missingSegments.reverse(),
        );
      } catch {
        const parent = dirname(existingParent);
        if (parent === existingParent) return resolved;
        missingSegments.push(basename(existingParent));
        existingParent = parent;
      }
    }
  }

  private static worktreePathsOverlap(request: {
    readonly first: string;
    readonly second: string;
  }): boolean {
    return (
      request.first === request.second ||
      this.isDescendantPath(relative(request.first, request.second)) ||
      this.isDescendantPath(relative(request.second, request.first))
    );
  }

  private static isDescendantPath(candidate: string): boolean {
    return (
      candidate !== '' &&
      candidate !== '..' &&
      !candidate.startsWith(`..${sep}`) &&
      !isAbsolute(candidate)
    );
  }

  private static addIssue(request: BranchIssueRequest): void {
    const issue: ModuleDeliveryIssue = {
      code: ModuleDeliveryIssueCode.InvalidField,
      path: request.path,
      message: request.message,
    };
    request.state.issues.push(issue);
  }
}
