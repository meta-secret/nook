import type { HostCommandFailure } from '../lib/run.ts';
import { err, ok, type Result } from 'neverthrow';
import type {
  PrLandPrRequest,
  PrLandValidateRequest,
} from '../codec/args/pr-land.ts';

import { RemoteTaskPresence } from '../codec/args/pr-land.ts';

import { PrLandOperation, RequestFamily } from '../codec/enums.ts';

import { RepositoryBunScript, RepositoryCommand } from '../lib/run.ts';

import { LoomFailureCode } from '../loom-failure.ts';

import type { RepositoryCommandRequest } from '../lib/run.ts';

export type PrLandReport = {
  readonly family: RequestFamily.PrLand;
  readonly operation: PrLandOperation;
  readonly prNumber: number;
  readonly nextStep: string;
  readonly messages: string[];
  readonly ready: boolean;
};

export const PR_LAND_VALIDATE_NEXT_STEP =
  'watch repository-owned checks and collect the opted-in exact-head review concurrently; after both settle, run a prLand.ready request';

export const PR_LAND_CODEX_REVIEW_ARG = 'CODEX_REVIEW=1';

type PrLandStatusArgs = {
  readonly repoRoot: string;
  readonly prNumber: number;
};

type PrLandValidateArgs = {
  readonly repoRoot: string;
  readonly request: PrLandValidateRequest;
};

type PrLandReadyArgs = {
  readonly repoRoot: string;
  readonly prNumber: number;
};

type PrLandMergeCheckArgs = {
  readonly repoRoot: string;
  readonly prNumber: number;
};

export type PrLandFailure =
  | HostCommandFailure
  | {
      readonly code: LoomFailureCode.CommandFailed;
      readonly message: string;
    };

export class PullRequestDeliveryCommand {
  constructor(private readonly request: PrLandStatusArgs) {}
  async status(): Promise<Result<PrLandReport, PrLandFailure>> {
    const { repoRoot, prNumber } = this.request;

    const viewArgs: RepositoryCommandRequest = {
      command: 'gh',
      args: [
        'pr',
        'view',
        String(prNumber),
        '--json',
        'number,state,isDraft,mergeStateStatus,url,headRefOid,baseRefName',
      ],
      rootDirectory: repoRoot,
      workingDirectory: repoRoot,
    };
    const viewLaunch = new RepositoryCommand(viewArgs).execute();
    if (viewLaunch.isErr()) return err(viewLaunch.error);
    const view = viewLaunch.value;
    if (view.exitCode !== 0) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `gh pr view failed: ${view.stderr || view.stdout}`,
      });
    }

    return ok({
      family: RequestFamily.PrLand,
      operation: PrLandOperation.Status,
      prNumber,
      nextStep: 'run a prLand.validate request when the head is ready',
      ready: false,
      messages: [view.stdout.trim()],
    });
  }
  async readiness(): Promise<Result<PrLandReport, PrLandFailure>> {
    const { repoRoot, prNumber } = this.request;

    const resultArgs: RepositoryCommandRequest = {
      command: 'task',
      args: ['pr:ready', `PR=${prNumber}`],
      rootDirectory: repoRoot,
      workingDirectory: repoRoot,
    };
    const resultLaunch = new RepositoryCommand(resultArgs).execute();
    if (resultLaunch.isErr()) return err(resultLaunch.error);
    const result = resultLaunch.value;
    const passed = result.exitCode === 0;
    return ok({
      family: RequestFamily.PrLand,
      operation: PrLandOperation.Ready,
      prNumber,
      ready: passed,
      nextStep: passed
        ? 'squash-merge with gh pr merge --squash when policy allows'
        : 'fix readiness gaps, then re-run a prLand.ready request',
      messages: [
        (result.stdout || result.stderr || `exit ${result.exitCode}`).trim(),
      ],
    });
  }
  async mergeReadiness(): Promise<Result<PrLandReport, PrLandFailure>> {
    const { repoRoot, prNumber } = this.request;

    const readinessArgs = { repoRoot, prNumber };
    const result = await this.readiness();
    if (result.isErr()) return err(result.error);
    const readiness = result.value;
    return ok({
      family: RequestFamily.PrLand,
      operation: PrLandOperation.MergeCheck,
      prNumber,
      ready: readiness.ready,
      nextStep: readiness.ready
        ? 'agent may squash-merge; Loom will not merge automatically'
        : readiness.nextStep,
      messages: [
        ...readiness.messages,
        'Loom never squash-merges; merge remains agent-gated',
      ],
    });
  }
}

export class PullRequestValidationCommand {
  constructor(private readonly request: PrLandValidateArgs) {}
  async execute(): Promise<Result<PrLandReport, PrLandFailure>> {
    const { repoRoot, request } = this.request;

    const prePushArgs: RepositoryCommandRequest = {
      command: 'bun',
      script: RepositoryBunScript.Loom,
      args: ['--default', 'prePush'],
      rootDirectory: repoRoot,
      workingDirectory: repoRoot,
    };
    const prePushLaunch = new RepositoryCommand(prePushArgs).execute();
    if (prePushLaunch.isErr()) return err(prePushLaunch.error);
    const prePush = prePushLaunch.value;
    if (prePush.exitCode !== 0) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `prePush failed before validate: ${prePush.stderr || prePush.stdout}`,
      });
    }

    if (request.remoteTask.presence === RemoteTaskPresence.Specified) {
      const remoteArgs: RepositoryCommandRequest = {
        command: 'task',
        args: ['remote', `TASK_NAME=${request.remoteTask.task}`],
        rootDirectory: repoRoot,
        workingDirectory: repoRoot,
      };
      const remoteLaunch = new RepositoryCommand(remoteArgs).execute();
      if (remoteLaunch.isErr()) return err(remoteLaunch.error);
      const remote = remoteLaunch.value;
      if (remote.exitCode !== 0) {
        return err({
          code: LoomFailureCode.CommandFailed,
          message: `task remote failed: ${remote.stderr || remote.stdout}`,
        });
      }
    }

    const validateArgs = [
      'pr:validate',
      `PR=${request.prNumber}`,
      PR_LAND_CODEX_REVIEW_ARG,
    ];
    if (request.runFullE2e) {
      validateArgs.push('FULL_E2E=1');
    }
    const validatedArgs: RepositoryCommandRequest = {
      command: 'task',
      args: validateArgs,
      rootDirectory: repoRoot,
      workingDirectory: repoRoot,
    };
    const validatedLaunch = new RepositoryCommand(validatedArgs).execute();
    if (validatedLaunch.isErr()) return err(validatedLaunch.error);
    const validated = validatedLaunch.value;
    if (validated.exitCode !== 0) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `task pr:validate failed: ${validated.stderr || validated.stdout}`,
      });
    }

    return ok({
      family: RequestFamily.PrLand,
      operation: PrLandOperation.Validate,
      prNumber: request.prNumber,
      nextStep: PR_LAND_VALIDATE_NEXT_STEP,
      ready: false,
      messages: [
        'prePush passed',
        (validated.stdout || 'pr:validate dispatched').trim(),
      ],
    });
  }
}
