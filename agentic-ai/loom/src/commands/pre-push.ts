import type { HostCommandFailure } from '../lib/run.ts';
import { err, ok, type Result } from 'neverthrow';
import type { PrePushRequest } from '../codec/args/pre-push.ts';

import { ChangedCortexDensity } from '../lib/changed-cortex-density.ts';

import {
  RepositoryBashScript,
  RepositoryCommand,
  RepositoryCommandExecutable,
} from '../lib/run.ts';

import { LoomFailureCode } from '../loom-failure.ts';

import type { RepositoryCommandRequest } from '../lib/run.ts';

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

    const formatArgs: RepositoryCommandRequest = {
      command: RepositoryCommandExecutable.Task,
      args: ['format'],
      rootDirectory: repoRoot,
      workingDirectory: repoRoot,
    };
    const formatLaunch = new RepositoryCommand(formatArgs).execute();
    if (formatLaunch.isErr()) return err(formatLaunch.error);
    const format = formatLaunch.value;
    if (format.exitCode !== 0) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `task format failed (exit ${format.exitCode}): ${format.stderr || format.stdout}`,
      });
    }
    messages.push('task format passed');

    if (request.fetchOriginMain) {
      const fetchArgs: RepositoryCommandRequest = {
        command: RepositoryCommandExecutable.Git,
        args: ['fetch', 'origin', 'main'],
        rootDirectory: repoRoot,
        workingDirectory: repoRoot,
      };
      const fetchLaunch = new RepositoryCommand(fetchArgs).execute();
      if (fetchLaunch.isErr()) return err(fetchLaunch.error);
      const fetch = fetchLaunch.value;
      if (fetch.exitCode !== 0) {
        return err({
          code: LoomFailureCode.CommandFailed,
          message: `git fetch origin main failed: ${fetch.stderr || fetch.stdout}`,
        });
      }
    }

    const baseArgs: RepositoryCommandRequest = {
      command: RepositoryCommandExecutable.Git,
      args: ['rev-parse', 'origin/main'],
      rootDirectory: repoRoot,
      workingDirectory: repoRoot,
    };
    const baseLaunch = new RepositoryCommand(baseArgs).execute();
    if (baseLaunch.isErr()) return err(baseLaunch.error);
    const base = baseLaunch.value;
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
    const densityResult = new ChangedCortexDensity(densityArgs).execute();
    if (densityResult.isErr()) return err(densityResult.error);
    const density = densityResult.value;
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

    const contractArgs: RepositoryCommandRequest = {
      command: RepositoryCommandExecutable.Bash,
      script: RepositoryBashScript.UiDemoContract,
      args: [baseSha],
      rootDirectory: repoRoot,
      workingDirectory: repoRoot,
    };
    const contractLaunch = new RepositoryCommand(contractArgs).execute();
    if (contractLaunch.isErr()) return err(contractLaunch.error);
    const contract = contractLaunch.value;
    if (contract.exitCode !== 0) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `UI demo contract failed: ${contract.stderr || contract.stdout}`,
      });
    }
    messages.push((contract.stdout || 'ui-demo-contract passed').trim());

    let staged = false;
    if (request.stageHostUpdates) {
      const stageArgs: RepositoryCommandRequest = {
        command: RepositoryCommandExecutable.Git,
        args: ['add', '-u'],
        rootDirectory: repoRoot,
        workingDirectory: repoRoot,
      };
      const stageLaunch = new RepositoryCommand(stageArgs).execute();
      if (stageLaunch.isErr()) return err(stageLaunch.error);
      const stage = stageLaunch.value;
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

export type PrePushFailure =
  | HostCommandFailure
  | {
      readonly code:
        LoomFailureCode.CommandFailed | LoomFailureCode.CortexAuditFailed;
      readonly message: string;
    };
