import { flagPresent } from '../lib/args.ts';
import { findRepoRoot, requireBun } from '../lib/repo.ts';
import { runCommand } from '../lib/run.ts';
import { ResultKind, err, ok, type Result } from '../result.ts';

export type PrePushReport = {
  readonly formatOk: boolean;
  readonly uiDemoOk: boolean;
  readonly baseSha: string;
  readonly staged: boolean;
  readonly messages: string[];
};

export async function runPrePush(
  args: readonly string[],
): Promise<Result<PrePushReport>> {
  const bun = requireBun();
  if (bun.kind === ResultKind.Err) {
    return bun;
  }

  const repo = findRepoRoot();
  if (repo.kind === ResultKind.Err) {
    return repo;
  }
  const repoRoot = repo.value;
  const skipStage = flagPresent(args, '--no-stage');
  const skipFetch = flagPresent(args, '--no-fetch');
  const messages: string[] = [];

  const format = runCommand('task', ['format'], repoRoot);
  if (format.kind === ResultKind.Err) {
    return format;
  }
  if (format.value.exitCode !== 0) {
    return err(
      `task format failed (exit ${format.value.exitCode}): ${format.value.stderr || format.value.stdout}`,
    );
  }
  messages.push('task format passed');

  if (!skipFetch) {
    const fetch = runCommand('git', ['fetch', 'origin', 'main'], repoRoot);
    if (fetch.kind === ResultKind.Err) {
      return fetch;
    }
    if (fetch.value.exitCode !== 0) {
      return err(
        `git fetch origin main failed: ${fetch.value.stderr || fetch.value.stdout}`,
      );
    }
  }

  const base = runCommand('git', ['rev-parse', 'origin/main'], repoRoot);
  if (base.kind === ResultKind.Err) {
    return base;
  }
  if (base.value.exitCode !== 0) {
    return err(`git rev-parse origin/main failed: ${base.value.stderr}`);
  }
  const baseSha = base.value.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(baseSha)) {
    return err(`origin/main did not resolve to a full SHA: ${baseSha}`);
  }

  const contract = runCommand(
    'bash',
    ['.github/scripts/ui-demo-contract.sh', baseSha],
    repoRoot,
  );
  if (contract.kind === ResultKind.Err) {
    return contract;
  }
  if (contract.value.exitCode !== 0) {
    return err(
      `UI demo contract failed: ${contract.value.stderr || contract.value.stdout}`,
    );
  }
  messages.push((contract.value.stdout || 'ui-demo-contract passed').trim());

  let staged = false;
  if (!skipStage) {
    const stage = runCommand('git', ['add', '-u'], repoRoot);
    if (stage.kind === ResultKind.Err) {
      return stage;
    }
    if (stage.value.exitCode !== 0) {
      return err(`git add -u failed: ${stage.value.stderr}`);
    }
    staged = true;
    messages.push('staged host format updates with git add -u');
  }

  return ok({
    formatOk: true,
    uiDemoOk: true,
    baseSha,
    staged,
    messages,
  });
}
