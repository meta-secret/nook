import type { PrePushRequest } from '../codec/args/pre-push.ts';
import { findRepoRoot, requireBun } from '../lib/repo.ts';
import { runCommand } from '../lib/run.ts';
import {
  LoomFailureCode,
  loomFailure,
  loomFailureDetail,
} from '../loom-failure.ts';

export type PrePushReport = {
  readonly formatOk: boolean;
  readonly uiDemoOk: boolean;
  readonly baseSha: string;
  readonly staged: boolean;
  readonly messages: string[];
};

export async function runPrePush(
  request: PrePushRequest,
): Promise<PrePushReport> {
  requireBun();
  const repoRoot = findRepoRoot();
  const messages: string[] = [];

  const format = runCommand('task', ['format'], repoRoot);
  if (format.exitCode !== 0) {
    loomFailureDetail(
      LoomFailureCode.CommandFailed,
      `task format failed (exit ${format.exitCode}): ${format.stderr || format.stdout}`,
    );
  }
  messages.push('task format passed');

  if (request.fetchOriginMain) {
    const fetch = runCommand('git', ['fetch', 'origin', 'main'], repoRoot);
    if (fetch.exitCode !== 0) {
      loomFailureDetail(
        LoomFailureCode.CommandFailed,
        `git fetch origin main failed: ${fetch.stderr || fetch.stdout}`,
      );
    }
  }

  const base = runCommand('git', ['rev-parse', 'origin/main'], repoRoot);
  if (base.exitCode !== 0) {
    loomFailureDetail(
      LoomFailureCode.CommandFailed,
      `git rev-parse origin/main failed: ${base.stderr}`,
    );
  }
  const baseSha = base.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(baseSha)) {
    loomFailureDetail(
      LoomFailureCode.CommandFailed,
      `origin/main did not resolve to a full SHA: ${baseSha}`,
    );
  }

  const contract = runCommand(
    'bash',
    ['.github/scripts/ui-demo-contract.sh', baseSha],
    repoRoot,
  );
  if (contract.exitCode !== 0) {
    loomFailureDetail(
      LoomFailureCode.CommandFailed,
      `UI demo contract failed: ${contract.stderr || contract.stdout}`,
    );
  }
  messages.push((contract.stdout || 'ui-demo-contract passed').trim());

  let staged = false;
  if (request.stageHostUpdates) {
    const stage = runCommand('git', ['add', '-u'], repoRoot);
    if (stage.exitCode !== 0) {
      loomFailureDetail(
        LoomFailureCode.CommandFailed,
        `git add -u failed: ${stage.stderr}`,
      );
    }
    staged = true;
    messages.push('staged host format updates with git add -u');
  }

  return {
    formatOk: true,
    uiDemoOk: true,
    baseSha,
    staged,
    messages,
  };
}
