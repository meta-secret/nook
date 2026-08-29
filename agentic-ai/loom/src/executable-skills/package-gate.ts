import path from 'node:path';
import {
  auditExecutableSkillPackageFiles,
  executableSkillPackages,
  readTrackedRepositoryFiles,
} from './repository.ts';

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

function commandArguments(
  action: ExecutableSkillGateAction,
): readonly string[] {
  if (action === 'install') return ['install', '--frozen-lockfile'];
  return ['run', action];
}

function runCommand(request: ExecutableSkillCommandRequest): number {
  let spawnOptions: PackageGateSpawnOptions;
  if (request.arguments.at(0) === 'install') {
    spawnOptions = {
      cmd: ['bun', 'install', '--frozen-lockfile'],
      cwd: request.cwd,
      stderr: 'inherit',
      stdout: 'inherit',
    };
  } else if (request.arguments.at(1) === 'format') {
    spawnOptions = {
      cmd: ['bun', 'run', 'format'],
      cwd: request.cwd,
      stderr: 'inherit',
      stdout: 'inherit',
    };
  } else {
    spawnOptions = {
      cmd: ['bun', 'run', 'verify'],
      cwd: request.cwd,
      stderr: 'inherit',
      stdout: 'inherit',
    };
  }
  const result = Bun.spawnSync(spawnOptions);
  return result.exitCode;
}

export function runExecutableSkillPackageGate(
  request: ExecutableSkillPackageGateRequest,
): void {
  const tracked = readTrackedRepositoryFiles(request.repoRoot);
  const auditRequest = { repoRoot: request.repoRoot, tracked };
  const findings = auditExecutableSkillPackageFiles(auditRequest);
  if (findings.length > 0) {
    const diagnostic = { findings };
    throw new Error(JSON.stringify(diagnostic));
  }
  const runner = request.runner ?? runCommand;
  const arguments_ = commandArguments(request.action);
  for (const skillPackage of executableSkillPackages(tracked)) {
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
