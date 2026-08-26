import type { PrePushRequest } from '../codec/args/pre-push.ts';
import { findRepoRoot, requireBun } from '../lib/repo.ts';
import { runCommand } from '../lib/run.ts';
import {
  measureAuthoredChangeBudget,
  type AuthoredChangeBudgetRequest,
} from '../lib/authored-change-budget.ts';
import {
  LoomFailureCode,
  loomFailure,
  loomFailureDetail,
} from '../loom-failure.ts';

import type { RunCommandArgs } from '../lib/run.ts';
import type { LoomFailureDetailArgs } from '../loom-failure.ts';
export type PrePushReport = {
  readonly authoredLines: number;
  readonly baseRef: string;
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
  const baseRef = process.env.NOOK_PRE_PUSH_BASE_REF?.trim() || 'origin/main';

  const formatArgs: RunCommandArgs = {
    command: 'task',
    args: ['format'],
    cwd: repoRoot,
  };
  const format = runCommand(formatArgs);
  if (format.exitCode !== 0) {
    const loomFailureDetailArgs6: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `task format failed (exit ${format.exitCode}): ${format.stderr || format.stdout}`,
    };
    loomFailureDetail(loomFailureDetailArgs6);
  }
  messages.push('task format passed');

  if (request.fetchOriginMain) {
    const fetchArgs: RunCommandArgs = {
      command: 'git',
      args: ['fetch', 'origin', 'main'],
      cwd: repoRoot,
    };
    const fetch = runCommand(fetchArgs);
    if (fetch.exitCode !== 0) {
      const loomFailureDetailArgs5: LoomFailureDetailArgs = {
        code: LoomFailureCode.CommandFailed,
        text: `git fetch origin main failed: ${fetch.stderr || fetch.stdout}`,
      };
      loomFailureDetail(loomFailureDetailArgs5);
    }
  }

  const baseArgs: RunCommandArgs = {
    command: 'git',
    args: ['rev-parse', baseRef],
    cwd: repoRoot,
  };
  const base = runCommand(baseArgs);
  if (base.exitCode !== 0) {
    const loomFailureDetailArgs4: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `git rev-parse ${baseRef} failed: ${base.stderr}`,
    };
    loomFailureDetail(loomFailureDetailArgs4);
  }
  const baseSha = base.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(baseSha)) {
    const loomFailureDetailArgs3: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `${baseRef} did not resolve to a full SHA: ${baseSha}`,
    };
    loomFailureDetail(loomFailureDetailArgs3);
  }

  const budgetRequest: AuthoredChangeBudgetRequest = { baseRef, repoRoot };
  const budget = measureAuthoredChangeBudget(budgetRequest);
  if (budget.unmeasurableAuthoredFiles > 0) {
    const budgetFailure: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `${budget.unmeasurableAuthoredFiles} authored file(s) have unmeasurable binary line counts`,
    };
    loomFailureDetail(budgetFailure);
  }
  if (budget.authoredLines > 3_015) {
    const budgetFailure: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `PR slice has ${budget.authoredLines} authored changed lines against ${baseRef}; split logical domain changes before exceeding the 3,000-line target and 15-line tolerance`,
    };
    loomFailureDetail(budgetFailure);
  }
  if (
    budget.authoredLines >= 2_700 &&
    process.env.NOOK_PRE_PUSH_MULTI_PR?.trim() !== '1'
  ) {
    const splitFailure: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `PR slice has ${budget.authoredLines} authored changed lines against ${baseRef}; inventory logical domain changes, publish ordered Workbench slices, open the dependent stack, then rerun with MULTI_PR=1`,
    };
    loomFailureDetail(splitFailure);
  }
  messages.push(
    `authored-change-budget: ${budget.authoredLines}/3000 lines against ${baseRef}; untracked authored files=${budget.untrackedAuthoredFiles}`,
  );

  const contractArgs: RunCommandArgs = {
    command: 'bash',
    args: ['.github/scripts/ui-demo-contract.sh', baseSha],
    cwd: repoRoot,
  };
  const contract = runCommand(contractArgs);
  if (contract.exitCode !== 0) {
    const loomFailureDetailArgs2: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `UI demo contract failed: ${contract.stderr || contract.stdout}`,
    };
    loomFailureDetail(loomFailureDetailArgs2);
  }
  messages.push((contract.stdout || 'ui-demo-contract passed').trim());

  let staged = false;
  if (request.stageHostUpdates) {
    const stageArgs: RunCommandArgs = {
      command: 'git',
      args: ['add', '-u'],
      cwd: repoRoot,
    };
    const stage = runCommand(stageArgs);
    if (stage.exitCode !== 0) {
      const loomFailureDetailArgs: LoomFailureDetailArgs = {
        code: LoomFailureCode.CommandFailed,
        text: `git add -u failed: ${stage.stderr}`,
      };
      loomFailureDetail(loomFailureDetailArgs);
    }
    staged = true;
    messages.push('staged host format updates with git add -u');
  }

  return {
    authoredLines: budget.authoredLines,
    baseRef,
    formatOk: true,
    uiDemoOk: true,
    baseSha,
    staged,
    messages,
  };
}
