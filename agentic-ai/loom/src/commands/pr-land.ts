import type {
  PrLandPrRequest,
  PrLandValidateRequest,
} from '../codec/args/pr-land.ts';
import { RemoteTaskPresence } from '../codec/args/pr-land.ts';
import { PrLandOperation, RequestFamily } from '../codec/enums.ts';
import { findRepoRoot } from '../lib/repo.ts';
import { runCommand } from '../lib/run.ts';
import {
  LoomFailureCode,
  loomFailure,
  loomFailureDetail,
} from '../loom-failure.ts';

import type { RunCommandArgs } from '../lib/run.ts';
import type { LoomFailureDetailArgs } from '../loom-failure.ts';
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

export async function runPrLandStatus(
  request: PrLandPrRequest,
): Promise<PrLandReport> {
  const repoRoot = findRepoRoot();
  const statusArgs = { repoRoot, prNumber: request.prNumber };
  return status(statusArgs);
}

export async function runPrLandValidate(
  request: PrLandValidateRequest,
): Promise<PrLandReport> {
  const repoRoot = findRepoRoot();
  const validateArgs2 = { repoRoot, request };
  return validate(validateArgs2);
}

export async function runPrLandReady(
  request: PrLandPrRequest,
): Promise<PrLandReport> {
  const repoRoot = findRepoRoot();
  const readyArgs = { repoRoot, prNumber: request.prNumber };
  return ready(readyArgs);
}

export async function runPrLandMergeCheck(
  request: PrLandPrRequest,
): Promise<PrLandReport> {
  const repoRoot = findRepoRoot();
  const mergeCheckArgs = { repoRoot, prNumber: request.prNumber };
  return mergeCheck(mergeCheckArgs);
}

type PrLandStatusArgs = {
  readonly repoRoot: string;
  readonly prNumber: number;
};

async function status(args: PrLandStatusArgs): Promise<PrLandReport> {
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
  const view = runCommand(viewArgs);
  if (view.exitCode !== 0) {
    const loomFailureDetailArgs4: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `gh pr view failed: ${view.stderr || view.stdout}`,
    };
    loomFailureDetail(loomFailureDetailArgs4);
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

type PrLandValidateArgs = {
  readonly repoRoot: string;
  readonly request: PrLandValidateRequest;
};

async function validate(args: PrLandValidateArgs): Promise<PrLandReport> {
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
  const prePush = runCommand(prePushArgs);
  if (prePush.exitCode !== 0) {
    const loomFailureDetailArgs3: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `prePush failed before validate: ${prePush.stderr || prePush.stdout}`,
    };
    loomFailureDetail(loomFailureDetailArgs3);
  }

  if (request.remoteTask.presence === RemoteTaskPresence.Specified) {
    const remoteArgs: RunCommandArgs = {
      command: 'task',
      args: ['remote', `TASK_NAME=${request.remoteTask.task}`],
      cwd: repoRoot,
    };
    const remote = runCommand(remoteArgs);
    if (remote.exitCode !== 0) {
      const loomFailureDetailArgs2: LoomFailureDetailArgs = {
        code: LoomFailureCode.CommandFailed,
        text: `task remote failed: ${remote.stderr || remote.stdout}`,
      };
      loomFailureDetail(loomFailureDetailArgs2);
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
  const validated = runCommand(validatedArgs);
  if (validated.exitCode !== 0) {
    const loomFailureDetailArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `task pr:validate failed: ${validated.stderr || validated.stdout}`,
    };
    loomFailureDetail(loomFailureDetailArgs);
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

type PrLandReadyArgs = {
  readonly repoRoot: string;
  readonly prNumber: number;
};

async function ready(args: PrLandReadyArgs): Promise<PrLandReport> {
  const { repoRoot, prNumber } = args;

  const resultArgs: RunCommandArgs = {
    command: 'task',
    args: ['pr:ready', `PR=${prNumber}`],
    cwd: repoRoot,
  };
  const result = runCommand(resultArgs);
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

type PrLandMergeCheckArgs = {
  readonly repoRoot: string;
  readonly prNumber: number;
};

async function mergeCheck(args: PrLandMergeCheckArgs): Promise<PrLandReport> {
  const { repoRoot, prNumber } = args;

  const readinessArgs = { repoRoot, prNumber };
  const readiness = await ready(readinessArgs);
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
