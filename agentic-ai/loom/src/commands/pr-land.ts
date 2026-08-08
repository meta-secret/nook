import path from 'node:path';
import type { PrLandArgs } from '../codec/args/pr-land.ts';
import { PrLandAction } from '../codec/enums.ts';
import { MaybeKind, ResultKind, err, ok, type Result } from '../result.ts';
import { findRepoRoot } from '../lib/repo.ts';
import { runCommand } from '../lib/run.ts';

export type PrLandReport = {
  readonly action: PrLandAction;
  readonly prNumber: number;
  readonly nextStep: string;
  readonly messages: string[];
  readonly ready: boolean;
};

export async function runPrLand(
  args: PrLandArgs,
): Promise<Result<PrLandReport>> {
  const repo = findRepoRoot();
  if (repo.kind === ResultKind.Err) {
    return repo;
  }

  switch (args.action) {
    case PrLandAction.Status:
      return status(repo.value, args.pr);
    case PrLandAction.Validate:
      return validate(repo.value, args);
    case PrLandAction.Ready:
      return ready(repo.value, args.pr);
    case PrLandAction.MergeCheck:
      return mergeCheck(repo.value, args.pr);
  }
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
    action: PrLandAction.Status,
    prNumber,
    nextStep: 'run loom with a pr-land validate request when the head is ready',
    ready: false,
    messages: [view.value.stdout.trim()],
  });
}

async function validate(
  repoRoot: string,
  args: PrLandArgs,
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
      `pre-push failed before validate: ${prePush.value.stderr || prePush.value.stdout}`,
    );
  }

  if (args.remote.kind === MaybeKind.Present) {
    const remote = runCommand(
      'task',
      ['remote', `TASK_NAME=${args.remote.value}`],
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

  const validateArgs = ['pr:validate', `PR=${args.pr}`];
  if (args.fullE2e) {
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
    action: PrLandAction.Validate,
    prNumber: args.pr,
    nextStep: 'watch repository-owned checks, then run a pr-land ready request',
    ready: false,
    messages: [
      'pre-push passed',
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
    action: PrLandAction.Ready,
    prNumber,
    ready: passed,
    nextStep: passed
      ? 'squash-merge with gh pr merge --squash when policy allows'
      : 'fix readiness gaps, then re-run a pr-land ready request',
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
    action: PrLandAction.MergeCheck,
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
