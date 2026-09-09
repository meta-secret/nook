import path from 'node:path';

import {
  EXECUTABLE_SKILL_WORKSPACE_ROOT,
  ExecutableSkillRepository,
} from './repository.ts';

export class ExecutableSkillPackageGate {
  private constructor(
    private readonly request: ExecutableSkillPackageGateRequest,
  ) {}
  static run(request: ExecutableSkillPackageGateRequest): void {
    return new ExecutableSkillPackageGate(request).execute();
  }
  private commandArguments(
    action: ExecutableSkillGateAction,
  ): readonly string[] {
    if (action === 'install') return ['install', '--frozen-lockfile'];
    return ['run', action];
  }

  private runCommand(request: ExecutableSkillCommandRequest): number {
    let exitCode: number;
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
    return exitCode;
  }

  private execute(): void {
    const request = this.request;
    const tracked = ExecutableSkillRepository.readTrackedFiles(
      request.repoRoot,
    );
    const auditRequest = { repoRoot: request.repoRoot, tracked };
    const findings = ExecutableSkillRepository.auditFiles(auditRequest);
    if (findings.length > 0) {
      const diagnostic = { findings };
      throw new Error(JSON.stringify(diagnostic));
    }
    const [runner = (value) => this.runCommand(value)] = [request.runner];
    const arguments_ = this.commandArguments(request.action);
    if (request.action === 'install') {
      const commandRequest: ExecutableSkillCommandRequest = {
        arguments: arguments_,
        cwd: path.join(request.repoRoot, EXECUTABLE_SKILL_WORKSPACE_ROOT),
      };
      const exitCode = runner(commandRequest);
      if (exitCode !== 0) {
        throw new Error(
          `Executable skill workspace install failed with status ${exitCode}`,
        );
      }
      return;
    }
    for (const skillPackage of ExecutableSkillRepository.packages(tracked)) {
      const cwd = path.join(request.repoRoot, skillPackage.scriptsRoot);
      const commandRequest: ExecutableSkillCommandRequest = {
        arguments: arguments_,
        cwd,
      };
      const exitCode = runner(commandRequest);
      if (exitCode !== 0) {
        throw new Error(
          `Executable skill ${request.action} failed for ${skillPackage.scriptsRoot} with status ${exitCode}`,
        );
      }
    }
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
) => number;

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
