import { flagPresent, positionalArgs, requireOption } from '../lib/args.ts'
import { findRepoRoot } from '../lib/repo.ts'
import { runCommand } from '../lib/run.ts'
import { ResultKind, err, ok, type Result } from '../result.ts'

export type PrLandReport = {
  readonly action: string
  readonly prNumber: number
  readonly nextStep: string
  readonly messages: string[]
  readonly ready: boolean
}

export async function runPrLand(
  args: readonly string[],
): Promise<Result<PrLandReport>> {
  const action = positionalArgs(args)[0]
  if (typeof action !== 'string') {
    return err(
      'Usage: loom pr-land <status|validate|ready|merge-check> --pr <n> [--remote TASK] [--full-e2e]',
    )
  }

  const repo = findRepoRoot()
  if (repo.kind === ResultKind.Err) {
    return repo
  }
  const prRaw = requireOption(args, '--pr')
  if (prRaw.kind === ResultKind.Err) {
    return prRaw
  }
  const prNumber = Number.parseInt(prRaw.value, 10)
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return err('--pr must be a positive integer')
  }

  switch (action) {
    case 'status':
      return status(repo.value, prNumber)
    case 'validate':
      return validate(repo.value, prNumber, args)
    case 'ready':
      return ready(repo.value, prNumber)
    case 'merge-check':
      return mergeCheck(repo.value, prNumber)
    default:
      return err(`Unknown pr-land action: ${action}`)
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
  )
  if (view.kind === ResultKind.Err) {
    return view
  }
  if (view.value.exitCode !== 0) {
    return err(`gh pr view failed: ${view.value.stderr || view.value.stdout}`)
  }

  return ok({
    action: 'status',
    prNumber,
    nextStep: 'run loom pr-land validate --pr <n> when the head is ready',
    ready: false,
    messages: [view.value.stdout.trim()],
  })
}

async function validate(
  repoRoot: string,
  prNumber: number,
  args: readonly string[],
): Promise<Result<PrLandReport>> {
  const forbiddenLocal = ['check', 'ci:pr', 'test', 'build']
  for (const token of args) {
    if (forbiddenLocal.some((name) => token === name || token.endsWith(`:${name}`))) {
      return err(
        `Refusing local heavy gate token "${token}". Use task remote / task pr:validate instead.`,
      )
    }
  }

  const prePush = runCommand(
    'bun',
    ['run', '--cwd', 'agentic-ai/loom', 'loom', '--', 'pre-push'],
    repoRoot,
  )
  if (prePush.kind === ResultKind.Err) {
    return prePush
  }
  if (prePush.value.exitCode !== 0) {
    return err(
      `pre-push failed before validate: ${prePush.value.stderr || prePush.value.stdout}`,
    )
  }

  const remoteTask = requireOption(args, '--remote')
  if (remoteTask.kind === ResultKind.Ok) {
    const remote = runCommand(
      'task',
      ['remote', `TASK_NAME=${remoteTask.value}`],
      repoRoot,
    )
    if (remote.kind === ResultKind.Err) {
      return remote
    }
    if (remote.value.exitCode !== 0) {
      return err(
        `task remote failed: ${remote.value.stderr || remote.value.stdout}`,
      )
    }
  }

  const validateArgs = ['pr:validate', `PR=${prNumber}`]
  if (flagPresent(args, '--full-e2e')) {
    validateArgs.push('FULL_E2E=1')
  }
  const validated = runCommand('task', validateArgs, repoRoot)
  if (validated.kind === ResultKind.Err) {
    return validated
  }
  if (validated.value.exitCode !== 0) {
    return err(
      `task pr:validate failed: ${validated.value.stderr || validated.value.stdout}`,
    )
  }

  return ok({
    action: 'validate',
    prNumber,
    nextStep: 'watch repository-owned checks, then loom pr-land ready --pr <n>',
    ready: false,
    messages: [
      'pre-push passed',
      (validated.value.stdout || 'pr:validate dispatched').trim(),
    ],
  })
}

async function ready(
  repoRoot: string,
  prNumber: number,
): Promise<Result<PrLandReport>> {
  const result = runCommand('task', ['pr:ready', `PR=${prNumber}`], repoRoot)
  if (result.kind === ResultKind.Err) {
    return result
  }
  const passed = result.value.exitCode === 0
  return ok({
    action: 'ready',
    prNumber,
    ready: passed,
    nextStep: passed
      ? 'squash-merge with gh pr merge --squash when policy allows'
      : 'fix readiness gaps, then re-run loom pr-land ready',
    messages: [
      (result.value.stdout || result.value.stderr || `exit ${result.value.exitCode}`).trim(),
    ],
  })
}

async function mergeCheck(
  repoRoot: string,
  prNumber: number,
): Promise<Result<PrLandReport>> {
  const readiness = await ready(repoRoot, prNumber)
  if (readiness.kind === ResultKind.Err) {
    return readiness
  }
  return ok({
    action: 'merge-check',
    prNumber,
    ready: readiness.value.ready,
    nextStep: readiness.value.ready
      ? 'agent may squash-merge; Loom will not merge automatically'
      : readiness.value.nextStep,
    messages: [
      ...readiness.value.messages,
      'Loom never squash-merges; merge remains agent-gated',
    ],
  })
}
