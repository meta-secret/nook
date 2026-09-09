import { err, ok, type Result } from 'neverthrow';
import type { PrePushRequest } from '../codec/args/pre-push.ts';

import { ChangedCortexDensity } from '../lib/changed-cortex-density.ts';

import { HostCommand } from '../lib/run.ts';

import { LoomFailureCode } from '../loom-failure.ts';

import type { RunCommandArgs } from '../lib/run.ts';

export class PrePushCommand {
  constructor(
    private readonly input: {
      readonly request: PrePushRequest;
      readonly repoRoot: string;
    },
  ) {}
  async execute(): Promise<Result<PrePushReport, PrePushFailure>> {
    const { request, repoRoot } = this.input;
    const messages: string[] = [];

    const formatArgs: RunCommandArgs = {
      command: 'task',
      args: ['format'],
      cwd: repoRoot,
    };
    const format = HostCommand.run(formatArgs);
    if (format.exitCode !== 0) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `task format failed (exit ${format.exitCode}): ${format.stderr || format.stdout}`,
      });
    }
    messages.push('task format passed');

    if (request.fetchOriginMain) {
      const fetchArgs: RunCommandArgs = {
        command: 'git',
        args: ['fetch', 'origin', 'main'],
        cwd: repoRoot,
      };
      const fetch = HostCommand.run(fetchArgs);
      if (fetch.exitCode !== 0) {
        return err({
          code: LoomFailureCode.CommandFailed,
          message: `git fetch origin main failed: ${fetch.stderr || fetch.stdout}`,
        });
      }
    }

    const baseArgs: RunCommandArgs = {
      command: 'git',
      args: ['rev-parse', 'origin/main'],
      cwd: repoRoot,
    };
    const base = HostCommand.run(baseArgs);
    if (base.exitCode !== 0) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `git rev-parse origin/main failed: ${base.stderr}`,
      });
    }
    const baseSha = base.stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(baseSha)) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `origin/main did not resolve to a full SHA: ${baseSha}`,
      });
    }

    const densityArgs = { baseSha, repoRoot };
    const density = ChangedCortexDensity.lint(densityArgs);
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
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Cortex Writer density failed for changed Markdown:\n${detail}`,
      });
    }
    messages.push(
      `Cortex Writer density passed for ${density.checkedPaths.length} changed Markdown file(s)`,
    );

    const contractArgs: RunCommandArgs = {
      command: 'bash',
      args: ['.github/scripts/ui-demo-contract.sh', baseSha],
      cwd: repoRoot,
    };
    const contract = HostCommand.run(contractArgs);
    if (contract.exitCode !== 0) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `UI demo contract failed: ${contract.stderr || contract.stdout}`,
      });
    }
    messages.push((contract.stdout || 'ui-demo-contract passed').trim());

    let staged = false;
    if (request.stageHostUpdates) {
      const stageArgs: RunCommandArgs = {
        command: 'git',
        args: ['add', '-u'],
        cwd: repoRoot,
      };
      const stage = HostCommand.run(stageArgs);
      if (stage.exitCode !== 0) {
        return err({
          code: LoomFailureCode.CommandFailed,
          message: `git add -u failed: ${stage.stderr}`,
        });
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
}

export type PrePushReport = {
  readonly formatOk: boolean;
  readonly uiDemoOk: boolean;
  readonly baseSha: string;
  readonly staged: boolean;
  readonly messages: string[];
};

export type PrePushFailure = {
  readonly code:
    LoomFailureCode.CommandFailed | LoomFailureCode.CortexAuditFailed;
  readonly message: string;
};
