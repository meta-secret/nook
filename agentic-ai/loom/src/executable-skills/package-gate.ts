import { err, ok, type Result } from 'neverthrow';
import type { ExecutableRepositoryFailure } from './repository.ts';
import path from 'node:path';

import {
  EXECUTABLE_SKILL_WORKSPACE_ROOT,
  ExecutableSkillRepository,
  ExecutableSkillCheckout,
  ExecutableTrackedPackages,
} from './repository.ts';

export class ExecutableSkillPackageGate {
  constructor(private readonly request: ExecutableSkillPackageGateRequest) {}
  private commandArguments(
    action: ExecutableSkillGateAction,
  ): readonly string[] {
    if (action === 'install') return ['install', '--frozen-lockfile'];
    return ['run', action];
  }

  private runCommand(
    request: ExecutableSkillCommandRequest,
  ): Result<number, PackageGateFailure> {
    let exitCode: number;
    try {
      if (request.arguments.at(0) === 'install') {
        const options: PackageGateSpawnOptions = {
          cmd: ['bun', 'install', '--frozen-lockfile'],
          cwd: request.cwd,
          stderr: 'inherit',
          stdout: 'inherit',
        };
        exitCode = Bun.spawnSync(options).exitCode;
      } else if (request.arguments.at(1) === 'format') {
        const options: PackageGateSpawnOptions = {
          cmd: ['bun', 'run', 'format'],
          cwd: request.cwd,
          stderr: 'inherit',
          stdout: 'inherit',
        };
        exitCode = Bun.spawnSync(options).exitCode;
      } else {
        const options: PackageGateSpawnOptions = {
          cmd: ['bun', 'run', 'verify'],
          cwd: request.cwd,
          stderr: 'inherit',
          stdout: 'inherit',
        };
        exitCode = Bun.spawnSync(options).exitCode;
      }
      return ok(exitCode);
    } catch {
      return err({
        message: `Executable skill command failed to start in ${request.cwd}`,
      });
    }
  }

  execute(): Result<void, PackageGateFailure> {
    const request = this.request;
    const tracked = new ExecutableSkillCheckout(
      request.repoRoot,
    ).readTrackedFiles();
    if (tracked.isErr()) return err(tracked.error);
    const auditRequest = { repoRoot: request.repoRoot, tracked: tracked.value };
    const findings = new ExecutableSkillRepository(auditRequest).findings();
    if (findings.length > 0) {
      const diagnostic = { findings };
      return err({ message: JSON.stringify(diagnostic) });
    }
    const runner: ExecutableSkillCommandRunner =
      Object.hasOwn(request, 'runner') && request.runner
        ? request.runner
        : (commandRequest) => this.runCommand(commandRequest);
    const arguments_ = this.commandArguments(request.action);
    if (request.action === 'install') {
      const commandRequest: ExecutableSkillCommandRequest = {
        arguments: arguments_,
        cwd: path.join(request.repoRoot, EXECUTABLE_SKILL_WORKSPACE_ROOT),
      };
      const exitCode = runner(commandRequest);
      if (exitCode.isErr()) return err(exitCode.error);
      if (exitCode.value !== 0) {
        return err({
          message: `Executable skill workspace install failed with status ${exitCode.value}`,
        });
      }
      return ok();
    }
    for (const skillPackage of new ExecutableTrackedPackages(
      tracked.value,
    ).packages()) {
      const cwd = path.join(request.repoRoot, skillPackage.scriptsRoot);
      const commandRequest: ExecutableSkillCommandRequest = {
        arguments: arguments_,
        cwd,
      };
      const exitCode = runner(commandRequest);
      if (exitCode.isErr()) return err(exitCode.error);
      if (exitCode.value !== 0) {
        return err({
          message: `Executable skill ${request.action} failed for ${skillPackage.scriptsRoot} with status ${exitCode.value}`,
        });
      }
    }
    return ok();
  }
}

export const EXECUTABLE_SKILL_GATE_ACTIONS = [
  'install',
  'format',
  'verify',
] as const;

export type ExecutableSkillGateAction =
  (typeof EXECUTABLE_SKILL_GATE_ACTIONS)[number];

export type ExecutableSkillCommandRequest = {
  readonly arguments: readonly string[];
  readonly cwd: string;
};

export type ExecutableSkillCommandRunner = (
  request: ExecutableSkillCommandRequest,
) => Result<number, PackageGateFailure>;

export type ExecutableSkillPackageGateRequest = {
  readonly action: ExecutableSkillGateAction;
  readonly repoRoot: string;
  readonly runner?: ExecutableSkillCommandRunner;
};

type PackageGateSpawnOptions = {
  readonly cmd: string[];
  readonly cwd: string;
  readonly stderr: 'inherit';
  readonly stdout: 'inherit';
};

export type PackageGateFailure =
  ExecutableRepositoryFailure | { readonly message: string };
