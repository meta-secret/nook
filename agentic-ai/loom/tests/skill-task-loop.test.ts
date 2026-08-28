import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const REPOSITORY_ROOT = join(import.meta.dir, '../../..');
const TASKFILE_PATH = join(REPOSITORY_ROOT, '.task', 'agentic-ai.yml');
const CREATE_TREE_OPTIONS = { recursive: true } as const;
const REMOVE_TREE_OPTIONS = { recursive: true, force: true } as const;

type SpawnOptions = {
  readonly cmd: string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stderr: 'pipe';
  readonly stdout: 'pipe';
};

type TaskCommandRequest = {
  readonly nextTaskName: string;
  readonly taskfile: string;
  readonly taskName: string;
};

function taskCommand(request: TaskCommandRequest): string {
  const start = request.taskfile.indexOf(`  ${request.taskName}:`);
  const end = request.taskfile.indexOf(`  ${request.nextTaskName}:`, start);
  if (start < 0 || end < 0)
    throw new Error(`Missing task block: ${request.taskName}`);
  const command = request.taskfile
    .slice(start, end)
    .split('\n')
    .find((line) => line.trimStart().startsWith('- set -euo pipefail;'));
  if (typeof command !== 'string')
    throw new Error(`Missing fail-fast command: ${request.taskName}`);
  return command.trimStart().slice(2);
}

test('skills package loops stop on the first failing package', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'skills-task-loop-'));
  try {
    const firstPackage = join(fixtureRoot, 'first-package');
    const secondPackage = join(fixtureRoot, 'second-package');
    const executableDirectory = join(fixtureRoot, 'bin');
    const markerPath = join(fixtureRoot, 'second-ran');
    await mkdir(firstPackage, CREATE_TREE_OPTIONS);
    await mkdir(secondPackage, CREATE_TREE_OPTIONS);
    await mkdir(executableDirectory, CREATE_TREE_OPTIONS);
    const bunPath = join(executableDirectory, 'bun');
    await writeFile(
      bunPath,
      '#!/usr/bin/env bash\nset -euo pipefail\nif [[ "$*" == *"repository-cli.ts"* ]]; then exit 0; fi\nif [[ "$PWD" == "$FAIL_PACKAGE" ]]; then exit 23; fi\nprintf reached >"$SECOND_MARKER"\n',
    );
    await chmod(bunPath, 0o755);
    const taskfile = await readFile(TASKFILE_PATH, 'utf8');
    for (const [taskName, nextTaskName] of [
      ['skills:install', 'skills:format'],
      ['skills:format', 'skills:verify'],
      ['skills:verify', 'skills:tools-list'],
    ] as const) {
      const taskCommandRequest: TaskCommandRequest = {
        nextTaskName,
        taskfile,
        taskName,
      };
      const command = taskCommand(taskCommandRequest)
        .replaceAll(
          '{{.SKILL_APPLICATION_DIRS}}',
          'first-package second-package',
        )
        .replaceAll('{{.REPO_ROOT}}', fixtureRoot);
      if (taskName === 'skills:install') {
        expect(command.indexOf('repository-cli.ts')).toBeLessThan(
          command.indexOf('for skill_dir'),
        );
      }
      const inheritedPath = Bun.env.PATH;
      if (typeof inheritedPath !== 'string')
        throw new Error('The task-loop test requires PATH.');
      const spawnOptions: SpawnOptions = {
        cmd: ['bash', '-c', command],
        cwd: fixtureRoot,
        env: {
          FAIL_PACKAGE: firstPackage,
          PATH: `${executableDirectory}:${inheritedPath}`,
          SECOND_MARKER: markerPath,
        },
        stderr: 'pipe',
        stdout: 'pipe',
      };
      const result = Bun.spawnSync(spawnOptions);
      expect(result.exitCode, taskName).toBe(23);
      expect(existsSync(markerPath), taskName).toBe(false);
    }
  } finally {
    await rm(fixtureRoot, REMOVE_TREE_OPTIONS);
  }
});
