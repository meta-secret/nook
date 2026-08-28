import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
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
    const skillRoot = `${fixtureRoot}/.cortex/teams/ai/dynamic-skills`;
    const firstPackage = `${skillRoot}/cortex-article-structure/scripts`;
    const secondPackage = `${skillRoot}/executable-skill-host/scripts`;
    const executableDirectory = join(fixtureRoot, 'bin');
    const markerPath = join(fixtureRoot, 'second-ran');
    await mkdir(firstPackage, CREATE_TREE_OPTIONS);
    await mkdir(secondPackage, CREATE_TREE_OPTIONS);
    await mkdir(executableDirectory, CREATE_TREE_OPTIONS);
    const bunPath = join(executableDirectory, 'bun');
    await writeFile(
      bunPath,
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s|%s\\n" "$PWD" "$*" >>"$SECOND_MARKER"\nif [[ "$PWD" == *"/$FAIL_PACKAGE" && "$*" == "$FAIL_COMMAND" ]]; then exit 23; fi\n',
    );
    await chmod(bunPath, 0o755);
    const taskfile = await readFile(TASKFILE_PATH, 'utf8');
    for (const [taskName, command, nextTaskName] of [
      ['skills:format', 'run format', 'skills:verify'],
      ['skills:verify', 'run verify', 'loom:install'],
    ] as const) {
      const taskCommandRequest: TaskCommandRequest = {
        nextTaskName,
        taskfile,
        taskName,
      };
      expect(taskCommand(taskCommandRequest)).toContain(
        '{{.SKILL_APPLICATION_DIRS}}',
      );
      const inheritedPath = Bun.env.PATH;
      if (typeof inheritedPath !== 'string')
        throw new Error('The task-loop test requires PATH.');
      const spawnOptions: SpawnOptions = {
        cmd: ['task', '--taskfile', TASKFILE_PATH, taskName],
        cwd: fixtureRoot,
        env: {
          FAIL_COMMAND: command,
          FAIL_PACKAGE: 'cortex-article-structure/scripts',
          PATH: `${executableDirectory}:${inheritedPath}`,
          REPO_ROOT: fixtureRoot,
          SECOND_MARKER: markerPath,
        },
        stderr: 'pipe',
        stdout: 'pipe',
      };
      const successOptions: SpawnOptions = {
        ...spawnOptions,
        env: { ...spawnOptions.env, FAIL_PACKAGE: '' },
      };
      expect(Bun.spawnSync(successOptions).exitCode, taskName).toBe(0);
      expect(await readFile(markerPath, 'utf8'), taskName).toContain(
        `${secondPackage}|${command}`,
      );
      await rm(markerPath);
      const result = Bun.spawnSync(spawnOptions);
      const failureLog = await readFile(markerPath, 'utf8');
      expect(result.exitCode, `${taskName}:${failureLog}`).not.toBe(0);
      expect(failureLog, taskName).not.toContain(`${secondPackage}|${command}`);
    }
  } finally {
    await rm(fixtureRoot, REMOVE_TREE_OPTIONS);
  }
});
