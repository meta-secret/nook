import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import type { MakeDirectoryOptions, RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  MODULE_EXPERT_CODEX_OPTIONS,
  createModuleExpertRuntimeIsolation,
  withModuleExpertRuntimeIsolation,
} from '../../src/module-experts/runtime-contract.ts';
import type {
  ModuleExpertRuntimeIsolationRequest,
  ModuleExpertRuntimeIsolationUse,
} from '../../src/module-experts/runtime-contract.ts';
import { runCommand } from '../../src/lib/run.ts';
import type { RunCommandArgs } from '../../src/lib/run.ts';

const CODEX_EXECUTABLE = resolve(
  import.meta.dir,
  '../../node_modules/@openai/codex/bin/codex.js',
);
const FIXTURE_AUTH = '{"OPENAI_API_KEY":"fixture-api-key"}\n';

type CodexMcpListEntry = {
  readonly name: string;
  readonly enabled: boolean;
};

type CodexMcpInventoryRequest = {
  readonly codexHome: string;
  readonly workingDirectory: string;
};

describe('module expert runtime isolation', () => {
  test('excludes arbitrary inherited user and project MCP servers', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-module-expert-isolation-'),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const parentCodexHome = join(fixtureRoot, 'parent-codex-home');
      const projectRoot = join(fixtureRoot, 'project');
      const isolationRoot = join(fixtureRoot, 'isolated');
      const recursiveDirectoryOptions: MakeDirectoryOptions = {
        recursive: true,
      };
      await mkdir(parentCodexHome, recursiveDirectoryOptions);
      await mkdir(projectRoot, recursiveDirectoryOptions);
      await mkdir(join(projectRoot, '.codex'), recursiveDirectoryOptions);
      await mkdir(isolationRoot, recursiveDirectoryOptions);
      const gitInitCommand: RunCommandArgs = {
        command: 'git',
        args: ['init'],
        cwd: projectRoot,
      };
      expect(runCommand(gitInitCommand).exitCode).toBe(0);
      await writeFile(join(parentCodexHome, 'auth.json'), FIXTURE_AUTH, 'utf8');
      const quotedProjectRoot = JSON.stringify(projectRoot);
      await writeFile(
        join(parentCodexHome, 'config.toml'),
        [
          `[projects.${quotedProjectRoot}]`,
          'trust_level = "trusted"',
          '',
          '[mcp_servers.arbitrary_inherited_user_mcp]',
          'command = "fixture-user-mcp"',
          '',
        ].join('\n'),
        'utf8',
      );
      await writeFile(
        join(projectRoot, '.codex/config.toml'),
        [
          '[mcp_servers.arbitrary_inherited_project_mcp]',
          'command = "fixture-project-mcp"',
          '',
        ].join('\n'),
        'utf8',
      );
      const parentInventoryRequest: CodexMcpInventoryRequest = {
        codexHome: parentCodexHome,
        workingDirectory: projectRoot,
      };
      const inheritedNames = await codexMcpNames(parentInventoryRequest);
      expect(inheritedNames).toContain('arbitrary_inherited_user_mcp');

      const parentEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        CODEX_HOME: parentCodexHome,
      };
      const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
        parentEnvironment,
        temporaryRoot: isolationRoot,
      };
      const isolation = createModuleExpertRuntimeIsolation(isolationRequest);
      try {
        expect(
          MODULE_EXPERT_CODEX_OPTIONS.config.cli_auth_credentials_store,
        ).toBe('file');
        expect(
          MODULE_EXPERT_CODEX_OPTIONS.config.features
            .skill_mcp_dependency_install,
        ).toBe(false);
        expect(isolation.codexHome).not.toBe(parentCodexHome);
        expect(await readdir(isolation.codexHome)).toEqual(['auth.json']);
        expect(
          await readFile(join(isolation.codexHome, 'auth.json'), 'utf8'),
        ).toBe(FIXTURE_AUTH);
        const isolatedAuth = await stat(join(isolation.codexHome, 'auth.json'));
        expect(isolatedAuth.mode & 0o777).toBe(0o600);
        expect(isolation.codexOptions.env?.CODEX_HOME).toBe(
          isolation.codexHome,
        );
        const isolatedInventoryRequest: CodexMcpInventoryRequest = {
          codexHome: isolation.codexHome,
          workingDirectory: projectRoot,
        };
        expect(await codexMcpNames(isolatedInventoryRequest)).toEqual([]);
      } finally {
        isolation.dispose();
      }
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('fails closed and removes the temporary home without authentication', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-module-expert-auth-'),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const parentCodexHome = join(fixtureRoot, 'parent-codex-home');
      const isolationRoot = join(fixtureRoot, 'isolated');
      const recursiveDirectoryOptions: MakeDirectoryOptions = {
        recursive: true,
      };
      await mkdir(parentCodexHome, recursiveDirectoryOptions);
      await mkdir(isolationRoot, recursiveDirectoryOptions);
      const parentEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        CODEX_ACCESS_TOKEN: '',
        CODEX_API_KEY: '',
        CODEX_HOME: parentCodexHome,
        OPENAI_API_KEY: '',
      };
      const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
        parentEnvironment,
        temporaryRoot: isolationRoot,
      };

      expect(() =>
        createModuleExpertRuntimeIsolation(isolationRequest),
      ).toThrow('requires isolated CLI authentication material');
      expect(await readdir(isolationRoot)).toEqual([]);
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('removes isolated state when guarded work fails', async () => {
    for (const failurePhase of ['source stability', 'agent turn']) {
      const fixtureRoot = await mkdtemp(
        join(tmpdir(), 'loom-module-expert-cleanup-'),
      );
      const removeOptions: RmOptions = { recursive: true, force: true };
      try {
        const parentCodexHome = join(fixtureRoot, 'parent-codex-home');
        const isolationRoot = join(fixtureRoot, 'isolated');
        const recursiveDirectoryOptions: MakeDirectoryOptions = {
          recursive: true,
        };
        await mkdir(parentCodexHome, recursiveDirectoryOptions);
        await mkdir(isolationRoot, recursiveDirectoryOptions);
        await writeFile(
          join(parentCodexHome, 'auth.json'),
          FIXTURE_AUTH,
          'utf8',
        );
        const parentEnvironment: NodeJS.ProcessEnv = {
          ...process.env,
          CODEX_HOME: parentCodexHome,
        };
        const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
          parentEnvironment,
          temporaryRoot: isolationRoot,
        };
        let isolatedCodexHome = '';
        const isolationUse: ModuleExpertRuntimeIsolationUse<never> = {
          isolationRequest,
          run: (isolation) => {
            isolatedCodexHome = isolation.codexHome;
            return Promise.reject(new Error(failurePhase));
          },
        };

        await expect(
          withModuleExpertRuntimeIsolation(isolationUse),
        ).rejects.toThrow(failurePhase);
        expect(isolatedCodexHome).not.toBe('');
        expect(await readdir(isolationRoot)).toEqual([]);
      } finally {
        await rm(fixtureRoot, removeOptions);
      }
    }
  });
});

async function codexMcpNames(
  request: CodexMcpInventoryRequest,
): Promise<readonly string[]> {
  const command = [CODEX_EXECUTABLE, 'mcp', 'list', '--json'];
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CODEX_HOME: request.codexHome,
  };
  const spawnOptions = {
    cwd: request.workingDirectory,
    env: environment,
    stderr: 'pipe',
    stdout: 'pipe',
  } as const;
  const child = Bun.spawn(command, spawnOptions);
  const exitCode = await child.exited;
  const stdout = await new Response(child.stdout).text();
  await new Response(child.stderr).text();
  expect(exitCode).toBe(0);
  const entries = JSON.parse(stdout) as readonly CodexMcpListEntry[];
  return entries.filter((entry) => entry.enabled).map((entry) => entry.name);
}
