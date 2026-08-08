import path from 'node:path';
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

export type PrLandReport = {
  readonly family: RequestFamily.PrLand;
  readonly operation: PrLandOperation;
  readonly prNumber: number;
  readonly nextStep: string;
  readonly messages: string[];
  readonly ready: boolean;
};

export async function runPrLandStatus(
  request: PrLandPrRequest,
): Promise<PrLandReport> {
  const repoRoot = findRepoRoot();
  return status(repoRoot, request.prNumber);
}

export async function runPrLandValidate(
  request: PrLandValidateRequest,
): Promise<PrLandReport> {
  const repoRoot = findRepoRoot();
  return validate(repoRoot, request);
}

export async function runPrLandReady(
  request: PrLandPrRequest,
): Promise<PrLandReport> {
  const repoRoot = findRepoRoot();
  return ready(repoRoot, request.prNumber);
}

export async function runPrLandMergeCheck(
  request: PrLandPrRequest,
): Promise<PrLandReport> {
  const repoRoot = findRepoRoot();
  return mergeCheck(repoRoot, request.prNumber);
}

async function status(
  repoRoot: string,
  prNumber: number,
): Promise<PrLandReport> {
  const view = runCommand(
    'gh',
    [
      'pr',
      'view',
      String(prNumber),
      '--json',
      'number,state,isDraft,mergeStateStatus,url,headRefOid,baseRefName',
    ],
    repoRoot,
  );
  if (view.exitCode !== 0) {
    loomFailureDetail(
      LoomFailureCode.CommandFailed,
      `gh pr view failed: ${view.stderr || view.stdout}`,
    );
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

async function validate(
  repoRoot: string,
  request: PrLandValidateRequest,
): Promise<PrLandReport> {
  const prePushRequest = path.join(
    repoRoot,
    'agentic-ai/loom/params/pre-push/default.yaml',
  );
  const prePush = runCommand(
    'bun',
    ['run', '--cwd', 'agentic-ai/loom', 'loom', '--', prePushRequest],
    repoRoot,
  );
  if (prePush.exitCode !== 0) {
    loomFailureDetail(
      LoomFailureCode.CommandFailed,
      `prePush failed before validate: ${prePush.stderr || prePush.stdout}`,
    );
  }

  if (request.remoteTask.presence === RemoteTaskPresence.Specified) {
    const remote = runCommand(
      'task',
      ['remote', `TASK_NAME=${request.remoteTask.task}`],
      repoRoot,
    );
    if (remote.exitCode !== 0) {
      loomFailureDetail(
        LoomFailureCode.CommandFailed,
        `task remote failed: ${remote.stderr || remote.stdout}`,
      );
    }
  }

  const validateArgs = ['pr:validate', `PR=${request.prNumber}`];
  if (request.runFullE2e) {
    validateArgs.push('FULL_E2E=1');
  }
  const validated = runCommand('task', validateArgs, repoRoot);
  if (validated.exitCode !== 0) {
    loomFailureDetail(
      LoomFailureCode.CommandFailed,
      `task pr:validate failed: ${validated.stderr || validated.stdout}`,
    );
  }

  return {
    family: RequestFamily.PrLand,
    operation: PrLandOperation.Validate,
    prNumber: request.prNumber,
    nextStep: 'watch repository-owned checks, then run a prLand.ready request',
    ready: false,
    messages: [
      'prePush passed',
      (validated.stdout || 'pr:validate dispatched').trim(),
    ],
  };
}

async function ready(
  repoRoot: string,
  prNumber: number,
): Promise<PrLandReport> {
  const result = runCommand('task', ['pr:ready', `PR=${prNumber}`], repoRoot);
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

async function mergeCheck(
  repoRoot: string,
  prNumber: number,
): Promise<PrLandReport> {
  const readiness = await ready(repoRoot, prNumber);
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
