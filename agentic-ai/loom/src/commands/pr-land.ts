import path from 'node:path';
import type {
  PrLandPrRequest,
  PrLandValidateRequest,
} from '../codec/args/pr-land.ts';
import { RequestKind } from '../codec/enums.ts';
import { findRepoRoot } from '../lib/repo.ts';
import { runCommand } from '../lib/run.ts';
import { MaybeKind, ResultKind, err, ok, type Result } from '../result.ts';

export type PrLandReport = {
  readonly requestKind:
    | RequestKind.PrLandStatus
    | RequestKind.PrLandValidate
    | RequestKind.PrLandReady
    | RequestKind.PrLandMergeCheck;
  readonly prNumber: number;
  readonly nextStep: string;
  readonly messages: string[];
  readonly ready: boolean;
};

export async function runPrLandStatus(
  request: PrLandPrRequest,
): Promise<Result<PrLandReport>> {
  const repo = findRepoRoot();
  if (repo.kind === ResultKind.Err) {
    return repo;
  }
  return status(repo.value, request.prNumber);
}

export async function runPrLandValidate(
  request: PrLandValidateRequest,
): Promise<Result<PrLandReport>> {
  const repo = findRepoRoot();
  if (repo.kind === ResultKind.Err) {
    return repo;
  }
  return validate(repo.value, request);
}

export async function runPrLandReady(
  request: PrLandPrRequest,
): Promise<Result<PrLandReport>> {
  const repo = findRepoRoot();
  if (repo.kind === ResultKind.Err) {
    return repo;
  }
  return ready(repo.value, request.prNumber);
}

export async function runPrLandMergeCheck(
  request: PrLandPrRequest,
): Promise<Result<PrLandReport>> {
  const repo = findRepoRoot();
  if (repo.kind === ResultKind.Err) {
    return repo;
  }
  return mergeCheck(repo.value, request.prNumber);
}

async function status(
  repoRoot: string,
  prNumber: number,
): Promise<Result<PrLandReport>> {
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
  if (view.kind === ResultKind.Err) {
    return view;
  }
  if (view.value.exitCode !== 0) {
    return err(`gh pr view failed: ${view.value.stderr || view.value.stdout}`);
  }

  return ok({
    requestKind: RequestKind.PrLandStatus,
    prNumber,
    nextStep: 'run a prLandValidate request when the head is ready',
    ready: false,
    messages: [view.value.stdout.trim()],
  });
}

async function validate(
  repoRoot: string,
  request: PrLandValidateRequest,
): Promise<Result<PrLandReport>> {
  const prePushRequest = path.join(
    repoRoot,
    'agentic-ai/loom/params/pre-push/default.yaml',
  );
  const prePush = runCommand(
    'bun',
    ['run', '--cwd', 'agentic-ai/loom', 'loom', '--', prePushRequest],
    repoRoot,
  );
  if (prePush.kind === ResultKind.Err) {
    return prePush;
  }
  if (prePush.value.exitCode !== 0) {
    return err(
      `prePush failed before validate: ${prePush.value.stderr || prePush.value.stdout}`,
    );
  }

  if (request.remoteTask.kind === MaybeKind.Present) {
    const remote = runCommand(
      'task',
      ['remote', `TASK_NAME=${request.remoteTask.value}`],
      repoRoot,
    );
    if (remote.kind === ResultKind.Err) {
      return remote;
    }
    if (remote.value.exitCode !== 0) {
      return err(
        `task remote failed: ${remote.value.stderr || remote.value.stdout}`,
      );
    }
  }

  const validateArgs = ['pr:validate', `PR=${request.prNumber}`];
  if (request.runFullE2e) {
    validateArgs.push('FULL_E2E=1');
  }
  const validated = runCommand('task', validateArgs, repoRoot);
  if (validated.kind === ResultKind.Err) {
    return validated;
  }
  if (validated.value.exitCode !== 0) {
    return err(
      `task pr:validate failed: ${validated.value.stderr || validated.value.stdout}`,
    );
  }

  return ok({
    requestKind: RequestKind.PrLandValidate,
    prNumber: request.prNumber,
    nextStep: 'watch repository-owned checks, then run a prLandReady request',
    ready: false,
    messages: [
      'prePush passed',
      (validated.value.stdout || 'pr:validate dispatched').trim(),
    ],
  });
}

async function ready(
  repoRoot: string,
  prNumber: number,
): Promise<Result<PrLandReport>> {
  const result = runCommand('task', ['pr:ready', `PR=${prNumber}`], repoRoot);
  if (result.kind === ResultKind.Err) {
    return result;
  }
  const passed = result.value.exitCode === 0;
  return ok({
    requestKind: RequestKind.PrLandReady,
    prNumber,
    ready: passed,
    nextStep: passed
      ? 'squash-merge with gh pr merge --squash when policy allows'
      : 'fix readiness gaps, then re-run a prLandReady request',
    messages: [
      (
        result.value.stdout ||
        result.value.stderr ||
        `exit ${result.value.exitCode}`
      ).trim(),
    ],
  });
}

async function mergeCheck(
  repoRoot: string,
  prNumber: number,
): Promise<Result<PrLandReport>> {
  const readiness = await ready(repoRoot, prNumber);
  if (readiness.kind === ResultKind.Err) {
    return readiness;
  }
  return ok({
    requestKind: RequestKind.PrLandMergeCheck,
    prNumber,
    ready: readiness.value.ready,
    nextStep: readiness.value.ready
      ? 'agent may squash-merge; Loom will not merge automatically'
      : readiness.value.nextStep,
    messages: [
      ...readiness.value.messages,
      'Loom never squash-merges; merge remains agent-gated',
    ],
  });
}
