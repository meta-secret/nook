import type {
  PrLandPrRequest,
  PrLandValidateRequest,
} from '../codec/args/pr-land.ts';

import { RemoteTaskPresence } from '../codec/args/pr-land.ts';

import { PrLandOperation, RequestFamily } from '../codec/enums.ts';

import { RepositoryRoot } from '../lib/repo.ts';

import { HostCommand } from '../lib/run.ts';

import { LoomFailureCode, LoomFailure } from '../loom-failure.ts';

import type { RunCommandArgs } from '../lib/run.ts';

import type { LoomFailureDetailArgs } from '../loom-failure.ts';

export class PullRequestDeliveryCommand {
  private constructor(private readonly request: PrLandPrRequest) {}

  static runPrLandStatus(request: PrLandPrRequest): Promise<PrLandReport> {
    return new PullRequestDeliveryCommand(request).execute();
  }

  private async execute(): Promise<PrLandReport> {
    const request = this.request;
    const repoRoot = RepositoryRoot.find();
    const statusArgs = { repoRoot, prNumber: request.prNumber };
    return PullRequestDeliveryCommand.status(statusArgs);
  }

  static async runPrLandValidate(
    request: PrLandValidateRequest,
  ): Promise<PrLandReport> {
    const repoRoot = RepositoryRoot.find();
    const validateArgs2 = { repoRoot, request };
    return PullRequestDeliveryCommand.validate(validateArgs2);
  }

  static async runPrLandReady(request: PrLandPrRequest): Promise<PrLandReport> {
    const repoRoot = RepositoryRoot.find();
    const readyArgs = { repoRoot, prNumber: request.prNumber };
    return PullRequestDeliveryCommand.ready(readyArgs);
  }

  static async runPrLandMergeCheck(
    request: PrLandPrRequest,
  ): Promise<PrLandReport> {
    const repoRoot = RepositoryRoot.find();
    const mergeCheckArgs = { repoRoot, prNumber: request.prNumber };
    return PullRequestDeliveryCommand.mergeCheck(mergeCheckArgs);
  }

  private static async status(args: PrLandStatusArgs): Promise<PrLandReport> {
    const { repoRoot, prNumber } = args;

    const viewArgs: RunCommandArgs = {
      command: 'gh',
      args: [
        'pr',
        'view',
        String(prNumber),
        '--json',
        'number,state,isDraft,mergeStateStatus,url,headRefOid,baseRefName',
      ],
      cwd: repoRoot,
    };
    const view = HostCommand.run(viewArgs);
    if (view.exitCode !== 0) {
      const loomFailureDetailArgs4: LoomFailureDetailArgs = {
        code: LoomFailureCode.CommandFailed,
        text: `gh pr view failed: ${view.stderr || view.stdout}`,
      };
      LoomFailure.detail(loomFailureDetailArgs4);
    }

    return {
      family: RequestFamily.PrLand,
      operation: PrLandOperation.Status,
      prNumber,
      nextStep: 'run a prLand.validate request when the head is ready',
      ready: false,
      messages: [view.stdout.trim()],
    };
  }

  private static async validate(
    args: PrLandValidateArgs,
  ): Promise<PrLandReport> {
    const { repoRoot, request } = args;

    const prePushArgs: RunCommandArgs = {
      command: 'bun',
      args: [
        'run',
        '--cwd',
        'agentic-ai/loom',
        'loom',
        '--',
        '--default',
        'prePush',
      ],
      cwd: repoRoot,
    };
    const prePush = HostCommand.run(prePushArgs);
    if (prePush.exitCode !== 0) {
      const loomFailureDetailArgs3: LoomFailureDetailArgs = {
        code: LoomFailureCode.CommandFailed,
        text: `prePush failed before validate: ${prePush.stderr || prePush.stdout}`,
      };
      LoomFailure.detail(loomFailureDetailArgs3);
    }

    if (request.remoteTask.presence === RemoteTaskPresence.Specified) {
      const remoteArgs: RunCommandArgs = {
        command: 'task',
        args: ['remote', `TASK_NAME=${request.remoteTask.task}`],
        cwd: repoRoot,
      };
      const remote = HostCommand.run(remoteArgs);
      if (remote.exitCode !== 0) {
        const loomFailureDetailArgs2: LoomFailureDetailArgs = {
          code: LoomFailureCode.CommandFailed,
          text: `task remote failed: ${remote.stderr || remote.stdout}`,
        };
        LoomFailure.detail(loomFailureDetailArgs2);
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
    const validatedArgs: RunCommandArgs = {
      command: 'task',
      args: validateArgs,
      cwd: repoRoot,
    };
    const validated = HostCommand.run(validatedArgs);
    if (validated.exitCode !== 0) {
      const loomFailureDetailArgs: LoomFailureDetailArgs = {
        code: LoomFailureCode.CommandFailed,
        text: `task pr:validate failed: ${validated.stderr || validated.stdout}`,
      };
      LoomFailure.detail(loomFailureDetailArgs);
    }

    return {
      family: RequestFamily.PrLand,
      operation: PrLandOperation.Validate,
      prNumber: request.prNumber,
      nextStep: PR_LAND_VALIDATE_NEXT_STEP,
      ready: false,
      messages: [
        'prePush passed',
        (validated.stdout || 'pr:validate dispatched').trim(),
      ],
    };
  }

  private static async ready(args: PrLandReadyArgs): Promise<PrLandReport> {
    const { repoRoot, prNumber } = args;

    const resultArgs: RunCommandArgs = {
      command: 'task',
      args: ['pr:ready', `PR=${prNumber}`],
      cwd: repoRoot,
    };
    const result = HostCommand.run(resultArgs);
    const passed = result.exitCode === 0;
    return {
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
    };
  }

  private static async mergeCheck(
    args: PrLandMergeCheckArgs,
  ): Promise<PrLandReport> {
    const { repoRoot, prNumber } = args;

    const readinessArgs = { repoRoot, prNumber };
    const readiness = await PullRequestDeliveryCommand.ready(readinessArgs);
    return {
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
    };
  }
}

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
