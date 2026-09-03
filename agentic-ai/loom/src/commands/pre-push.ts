import type { PrePushRequest } from '../codec/args/pre-push.ts';
import { lintChangedCortexDensity } from '../lib/changed-cortex-density.ts';
import { findRepoRoot, requireBun } from '../lib/repo.ts';
import { runCommand } from '../lib/run.ts';
import {
  LoomFailureCode,
  loomFailure,
  loomFailureDetail,
} from '../loom-failure.ts';

import type { RunCommandArgs } from '../lib/run.ts';
import type { LoomFailureDetailArgs } from '../loom-failure.ts';
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
    args: ['rev-parse', 'origin/main'],
    cwd: repoRoot,
  };
  const base = runCommand(baseArgs);
  if (base.exitCode !== 0) {
    const loomFailureDetailArgs4: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `git rev-parse origin/main failed: ${base.stderr}`,
    };
    loomFailureDetail(loomFailureDetailArgs4);
  }
  const baseSha = base.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(baseSha)) {
    const loomFailureDetailArgs3: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `origin/main did not resolve to a full SHA: ${baseSha}`,
    };
    loomFailureDetail(loomFailureDetailArgs3);
  }

  const densityArgs = { baseSha, repoRoot };
  const density = lintChangedCortexDensity(densityArgs);
  if (density.findings.length > 0 || density.valeAlerts.length > 0) {
    const typedDetail = density.findings.map(
      (finding) =>
        `${finding.file}:${finding.line}: ${finding.reason}: ${finding.excerpt}`,
    );
    const valeDetail = density.valeAlerts.map(
      (alert) =>
        `${alert.file}:${alert.line}: ${alert.check}: ${alert.message}`,
    );
    const detail = [...typedDetail, ...valeDetail].join('\n');
    const densityFailureArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.CortexAuditFailed,
      text: `Cortex Writer density failed for changed Markdown:\n${detail}`,
    };
    loomFailureDetail(densityFailureArgs);
  }
  messages.push(
    `Cortex Writer density passed for ${density.checkedPaths.length} changed Markdown file(s)`,
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
    formatOk: true,
    uiDemoOk: true,
    baseSha,
    staged,
    messages,
  };
}
