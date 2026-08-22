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
  readonly environment: NodeJS.ProcessEnv;
  readonly workingDirectory: string;
};

const DECOY_ENVIRONMENT: NodeJS.ProcessEnv = {
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  AWS_SESSION_TOKEN: 'aws-session',
  DATABASE_URL: 'postgres://credential@example.test/database',
  DOCKER_HOST: 'ssh://privileged-docker.example.test',
  GH_TOKEN: 'gh-token',
  GITHUB_TOKEN: 'github-token',
  KUBECONFIG: '/sensitive/kubeconfig',
  NOOK_GITHUB_PAT: 'nook-token',
  NPM_TOKEN: 'npm-token',
  PROJECT_SECRET: 'project-secret',
  SSH_AUTH_SOCK: '/sensitive/ssh-agent.sock',
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
        environment: {
          CODEX_HOME: parentCodexHome,
          PATH: process.env.PATH ?? '',
        },
        workingDirectory: projectRoot,
      };
      const inheritedNames = await codexMcpNames(parentInventoryRequest);
      expect(inheritedNames).toContain('arbitrary_inherited_user_mcp');

      const parentEnvironment: NodeJS.ProcessEnv = {
        ...DECOY_ENVIRONMENT,
        CODEX_ACCESS_TOKEN: 'ambient-access-token',
        CODEX_API_KEY: 'ambient-api-key',
        CODEX_HOME: parentCodexHome,
        OPENAI_API_KEY: 'ambient-openai-key',
        PATH: process.env.PATH ?? '',
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
        expect(MODULE_EXPERT_CODEX_OPTIONS.config.allow_login_shell).toBe(
          false,
        );
        expect(
          MODULE_EXPERT_CODEX_OPTIONS.config.shell_environment_policy.inherit,
        ).toBe('none');
        expect(
          MODULE_EXPERT_CODEX_OPTIONS.config.features
            .skill_mcp_dependency_install,
        ).toBe(false);
        expect(isolation.codexHome).not.toBe(parentCodexHome);
        expect(Object.keys(isolation.codexOptions.env).sort()).toEqual([
          'CODEX_HOME',
          'PATH',
        ]);
        const expectedShellEnvironment: Readonly<Record<string, string>> = {
          PATH: process.env.PATH ?? '',
        };
        expect(
          isolation.codexOptions.config.shell_environment_policy.set,
        ).toEqual(expectedShellEnvironment);
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
          environment: isolation.codexOptions.env,
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

  test('brokers one supported environment credential without parent secrets', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-module-expert-environment-auth-'),
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
        ...DECOY_ENVIRONMENT,
        CODEX_ACCESS_TOKEN: 'access-token',
        CODEX_API_KEY: 'api-key',
        CODEX_HOME: parentCodexHome,
        OPENAI_API_KEY: 'openai-key',
        PATH: '/usr/bin:/bin',
      };
      const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
        parentEnvironment,
        temporaryRoot: isolationRoot,
      };
      const isolation = createModuleExpertRuntimeIsolation(isolationRequest);
      try {
        const expectedProcessEnvironment: Readonly<Record<string, string>> = {
          CODEX_API_KEY: 'api-key',
          CODEX_HOME: isolation.codexHome,
          PATH: '/usr/bin:/bin',
        };
        expect(isolation.codexOptions.env).toEqual(expectedProcessEnvironment);
        const expectedShellEnvironment: Readonly<Record<string, string>> = {
          PATH: '/usr/bin:/bin',
        };
        expect(
          isolation.codexOptions.config.shell_environment_policy.set,
        ).toEqual(expectedShellEnvironment);
        expect(await readdir(isolation.codexHome)).toEqual([]);
      } finally {
        isolation.dispose();
      }
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('keeps concurrent isolated homes and process environment independent', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-module-expert-concurrency-'),
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
      await writeFile(join(parentCodexHome, 'auth.json'), FIXTURE_AUTH, 'utf8');
      const parentEnvironment: NodeJS.ProcessEnv = {
        CODEX_HOME: parentCodexHome,
        PATH: '/usr/bin:/bin',
        PROJECT_SECRET: 'must-not-leak',
      };
      const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
        parentEnvironment,
        temporaryRoot: isolationRoot,
      };
      const first = createModuleExpertRuntimeIsolation(isolationRequest);
      const second = createModuleExpertRuntimeIsolation(isolationRequest);
      try {
        expect(first.codexHome).not.toBe(second.codexHome);
        const expectedParentEnvironment: NodeJS.ProcessEnv = {
          CODEX_HOME: parentCodexHome,
          PATH: '/usr/bin:/bin',
          PROJECT_SECRET: 'must-not-leak',
        };
        expect(parentEnvironment).toEqual(expectedParentEnvironment);
        first.dispose();
        expect(await readdir(isolationRoot)).toEqual([
          second.codexHome.slice(isolationRoot.length + 1),
        ]);
        expect(await readdir(second.codexHome)).toEqual(['auth.json']);
      } finally {
        first.dispose();
        second.dispose();
      }
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('rejects unsupported authentication and removes the temporary home', async () => {
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
        CODEX_ACCESS_TOKEN: '',
        CODEX_API_KEY: '',
        CODEX_HOME: parentCodexHome,
        OPENAI_API_KEY: 'unsupported-openai-api-key',
        PATH: process.env.PATH ?? '',
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
          CODEX_HOME: parentCodexHome,
          PATH: process.env.PATH ?? '',
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
  const spawnOptions = {
    cwd: request.workingDirectory,
    env: request.environment,
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
