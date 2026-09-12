import assert from 'node:assert/strict';

import {
  UntrustedYamlBoundary,
  type UntrustedYamlNode,
} from '../../src/lib/guards.ts';
import {
  ModuleExpertsRuntimeContractScenario,
  EXPERT_NAME,
  DECOY_ENVIRONMENT,
  API_KEY_SENTINEL,
  ANALYZED_HELPER_DECOY_PATH,
  UNRELATED_WEB_CONSUMER_PATH,
} from './runtime-contract.fixture.ts';
import type {
  RuntimeIsolationFixtureRequest,
  ToolAttemptEventsRequest,
  ProfileRepositoryFixtureRequest,
  BrokerSocketRequest,
  AuthenticationCommandRun,
  TreeContainsRequest,
} from './runtime-contract.fixture.ts';
export { ModuleExpertsRuntimeContractScenario } from './runtime-contract.fixture.ts';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';

import type { RmOptions } from 'node:fs';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { Codex } from '@openai/codex-sdk';

import type { CodexOptions, TurnOptions } from '@openai/codex-sdk';

import { INTERNAL_API_EXPERT_JSON_CONSUMER_SCOPE_PATHS } from '../../src/module-experts/catalog.ts';

import { MODULE_EXPERT_READ_CONTEXT_TOOLS } from '../../src/module-experts/read-context-mcp.ts';

import {
  MODULE_EXPERT_AUTH_BROKER_CLIENT_SOURCE,
  MODULE_EXPERT_AUTH_PROVIDER,
  MODULE_EXPERT_CODEX_OPTIONS,
  MODULE_EXPERT_CONTEXT_MCP,
  ModuleExpertIsolation,
} from '../../src/module-experts/runtime-contract.ts';

import type {
  ModuleExpertRuntimeIsolationRequest,
  ModuleExpertRuntimeIsolationUse,
} from '../../src/module-experts/runtime-contract.ts';

describe('module expert runtime isolation', () => {
  test('isolates credentials, capabilities, repository scope, and working state', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-expert-runtime-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const repository =
        await ModuleExpertsRuntimeContractScenario.createRepositoryFixture(
          fixtureRoot,
        );
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const [defaulted1 = ''] = [process.env.PATH];
      const parentEnvironment: NodeJS.ProcessEnv = {
        ...DECOY_ENVIRONMENT,
        CODEX_API_KEY: API_KEY_SENTINEL,
        CODEX_HOME: join(fixtureRoot, 'parent-codex-home'),
        PATH: defaulted1,
      };
      const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
        expertName: EXPERT_NAME,
        parentEnvironment,
        selectedContextPaths: [],
        sourceCommit: repository.sourceCommit,
        temporaryRoot: isolationRoot,
        workingDirectory: repository.root,
      };
      const isolationResult =
        await ModuleExpertIsolation.createModuleExpertRuntimeIsolation(
          isolationRequest,
        );
      assert(isolationResult.isOk());
      const isolation = isolationResult.value;
      try {
        expect(Object.keys(isolation.codexOptions.env).sort()).toEqual([
          'CODEX_HOME',
          'PATH',
        ]);
        const serializedOptions = JSON.stringify(isolation.codexOptions);
        expect(serializedOptions).not.toContain(API_KEY_SENTINEL);
        expect(serializedOptions).not.toContain('CODEX_API_KEY');
        const treeSearch: TreeContainsRequest = {
          root: isolation.codexHome,
          sentinel: API_KEY_SENTINEL,
        };
        expect(
          await ModuleExpertsRuntimeContractScenario.treeContains(treeSearch),
        ).toBe(false);
        expect(isolation.threadOptions.workingDirectory).toBe(
          join(isolation.codexHome, 'workspace'),
        );
        expect(isolation.threadOptions.skipGitRepoCheck).toBe(true);
        const [defaulted2 = ''] = [isolation.threadOptions.workingDirectory];
        expect(await readdir(defaulted2)).toEqual([]);
        expect(MODULE_EXPERT_CODEX_OPTIONS.config.features.shell_tool).toBe(
          false,
        );
        expect(MODULE_EXPERT_CODEX_OPTIONS.config.features.unified_exec).toBe(
          false,
        );
        expect(MODULE_EXPERT_CODEX_OPTIONS.config.features.shell_snapshot).toBe(
          false,
        );
        expect(MODULE_EXPERT_CODEX_OPTIONS.config.features.hooks).toBe(false);
        expect(
          MODULE_EXPERT_CODEX_OPTIONS.config.features.code_mode.enabled,
        ).toBe(false);
        expect(MODULE_EXPERT_CODEX_OPTIONS.config.agents.enabled).toBe(false);
        expect(
          isolation.codexOptions.config.mcp_servers[MODULE_EXPERT_CONTEXT_MCP]
            .required,
        ).toBe(true);
        expect(
          isolation.codexOptions.config.mcp_servers[MODULE_EXPERT_CONTEXT_MCP]
            .enabled_tools,
        ).toEqual(['list_files', 'read_file', 'search_text']);
        const authentication =
          ModuleExpertsRuntimeContractScenario.authenticationCommand(isolation);
        expect(authentication.args.slice(0, 3)).toEqual([
          '-e',
          MODULE_EXPERT_AUTH_BROKER_CLIENT_SOURCE,
          '--',
        ]);
        await expect(
          access(
            join(isolation.repositorySnapshot, ANALYZED_HELPER_DECOY_PATH),
          ),
        ).rejects.toThrow();

        const [defaulted3 = ''] = [
          ModuleExpertsRuntimeContractScenario.profile().publicEntryPoints[0],
        ];
        const snapshotEntry = join(isolation.repositorySnapshot, defaulted3);
        expect(await readFile(snapshotEntry, 'utf8')).toBe(
          repository.committedEntryContent,
        );
        for (const contextPath of ModuleExpertsRuntimeContractScenario.profile()
          .canonicalContextPaths) {
          expect(
            await readFile(
              join(isolation.repositorySnapshot, contextPath),
              'utf8',
            ),
          ).toBe(`committed:${contextPath}\n`);
        }
        const unrelatedPath = join(
          isolation.repositorySnapshot,
          'unrelated-module/private.txt',
        );
        await expect(access(unrelatedPath)).rejects.toThrow();
      } finally {
        await isolation.dispose();
      }
      expect(await readdir(isolationRoot)).toEqual([]);
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('redeems the command-backed credential exactly once', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-expert-auth-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const repository =
        await ModuleExpertsRuntimeContractScenario.createRepositoryFixture(
          fixtureRoot,
        );
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const fixtureRequest: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolationRequest =
        ModuleExpertsRuntimeContractScenario.runtimeIsolationRequest(
          fixtureRequest,
        );
      const isolationResult =
        await ModuleExpertIsolation.createModuleExpertRuntimeIsolation(
          isolationRequest,
        );
      assert(isolationResult.isOk());
      const isolation = isolationResult.value;
      try {
        const command =
          ModuleExpertsRuntimeContractScenario.authenticationCommand(isolation);
        expect(command.args.join(' ')).not.toContain(API_KEY_SENTINEL);
        const firstRun: AuthenticationCommandRun = { command, isolation };
        const first =
          await ModuleExpertsRuntimeContractScenario.runAuthenticationCommand(
            firstRun,
          );
        expect(first.exitCode).toBe(0);
        expect(first.stdout.trim()).toBe(API_KEY_SENTINEL);
        const secondRun: AuthenticationCommandRun = { command, isolation };
        const second =
          await ModuleExpertsRuntimeContractScenario.runAuthenticationCommand(
            secondRun,
          );
        expect(second.exitCode).not.toBe(0);
        expect(second.stdout).not.toContain(API_KEY_SENTINEL);
      } finally {
        await isolation.dispose();
      }
      expect(await readdir(isolationRoot)).toEqual([]);
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('accepts fragmented nonces without letting invalid requests consume auth', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-expert-auth-stream-'),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const repository =
        await ModuleExpertsRuntimeContractScenario.createRepositoryFixture(
          fixtureRoot,
        );
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const fixtureRequest: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolationResult =
        await ModuleExpertIsolation.createModuleExpertRuntimeIsolation(
          ModuleExpertsRuntimeContractScenario.runtimeIsolationRequest(
            fixtureRequest,
          ),
        );
      assert(isolationResult.isOk());
      const isolation = isolationResult.value;
      try {
        const command =
          ModuleExpertsRuntimeContractScenario.authenticationCommand(isolation);
        const [defaulted4 = ''] = [command.args[3]];
        const invalidRequest: BrokerSocketRequest = {
          nonce: 'invalid-nonce',
          socketPath: defaulted4,
        };
        expect(
          await ModuleExpertsRuntimeContractScenario.redeemBrokerSocket(
            invalidRequest,
          ),
        ).toBe('');
        const [defaulted5 = ''] = [command.args[4]];
        const [defaulted6 = ''] = [command.args[3]];
        const validRequest: BrokerSocketRequest = {
          nonce: defaulted5,
          socketPath: defaulted6,
        };
        expect(
          (
            await ModuleExpertsRuntimeContractScenario.redeemBrokerSocket(
              validRequest,
            )
          ).trim(),
        ).toBe(API_KEY_SENTINEL);
        expect(
          await ModuleExpertsRuntimeContractScenario.redeemBrokerSocket(
            validRequest,
          ),
        ).toBe('');
      } finally {
        await isolation.dispose();
      }
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('keeps concurrent brokers, snapshots, and cleanup independent', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-expert-concurrent-'),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const repository =
        await ModuleExpertsRuntimeContractScenario.createRepositoryFixture(
          fixtureRoot,
        );
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const fixtureRequest: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolationRequest =
        ModuleExpertsRuntimeContractScenario.runtimeIsolationRequest(
          fixtureRequest,
        );
      const firstResult =
        await ModuleExpertIsolation.createModuleExpertRuntimeIsolation(
          isolationRequest,
        );
      assert(firstResult.isOk());
      const first = firstResult.value;
      const secondResult =
        await ModuleExpertIsolation.createModuleExpertRuntimeIsolation(
          isolationRequest,
        );
      assert(secondResult.isOk());
      const second = secondResult.value;
      try {
        expect(first.codexHome).not.toBe(second.codexHome);
        expect(first.repositorySnapshot).not.toBe(second.repositorySnapshot);
        const firstMcp =
          first.codexOptions.config.mcp_servers[MODULE_EXPERT_CONTEXT_MCP];
        const secondMcp =
          second.codexOptions.config.mcp_servers[MODULE_EXPERT_CONTEXT_MCP];
        expect(firstMcp.url).not.toBe(secondMcp.url);
        const firstRun: AuthenticationCommandRun = {
          command:
            ModuleExpertsRuntimeContractScenario.authenticationCommand(first),
          isolation: first,
        };
        const firstResult =
          await ModuleExpertsRuntimeContractScenario.runAuthenticationCommand(
            firstRun,
          );
        const secondRun: AuthenticationCommandRun = {
          command:
            ModuleExpertsRuntimeContractScenario.authenticationCommand(second),
          isolation: second,
        };
        const secondResult =
          await ModuleExpertsRuntimeContractScenario.runAuthenticationCommand(
            secondRun,
          );
        expect(firstResult.stdout.trim()).toBe(API_KEY_SENTINEL);
        expect(secondResult.stdout.trim()).toBe(API_KEY_SENTINEL);
        await first.dispose();
        expect((await readdir(isolationRoot)).length).toBe(1);
        const [defaulted7 = ''] = [
          ModuleExpertsRuntimeContractScenario.profile().publicEntryPoints[0],
        ];
        expect(
          await readFile(join(second.repositorySnapshot, defaulted7), 'utf8'),
        ).toBe(repository.committedEntryContent);
      } finally {
        await first.dispose();
        await second.dispose();
      }
      expect(await readdir(isolationRoot)).toEqual([]);
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('removes catalog exclusions from broad module snapshots', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-expert-exclusions-'),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const fixtureRequest: ProfileRepositoryFixtureRequest = {
        expertName: 'web_expert',
        fixtureRoot,
      };
      const repository =
        await ModuleExpertsRuntimeContractScenario.createProfileRepositoryFixture(
          fixtureRequest,
        );
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const requestFixture: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
        ...ModuleExpertsRuntimeContractScenario.runtimeIsolationRequest(
          requestFixture,
        ),
        expertName: 'web_expert',
        selectedContextPaths: [
          '.cortex/teams/web-dev/product-specs/browser-extension.md',
          '.cortex/teams/web-dev/dynamic-skills/ui-design-skills.md',
        ],
      };
      const isolationResult =
        await ModuleExpertIsolation.createModuleExpertRuntimeIsolation(
          isolationRequest,
        );
      assert(isolationResult.isOk());
      const isolation = isolationResult.value;
      try {
        const webProfile =
          ModuleExpertsRuntimeContractScenario.profile('web_expert');
        for (const skillPath of webProfile.skillPaths) {
          expect(
            await readFile(
              join(isolation.repositorySnapshot, skillPath),
              'utf8',
            ),
          ).toBe(`committed:${skillPath}\n`);
        }
        for (const contextPath of webProfile.canonicalContextPaths) {
          expect(
            await readFile(
              join(isolation.repositorySnapshot, contextPath),
              'utf8',
            ),
          ).toBe(`committed:${contextPath}\n`);
        }
        for (const excludedPath of webProfile.excludedPaths) {
          await expect(
            access(join(isolation.repositorySnapshot, excludedPath)),
          ).rejects.toThrow();
        }
        expect(
          await readFile(
            join(
              isolation.repositorySnapshot,
              'nook-app/nook-web/nook-web-shared/fixture.txt',
            ),
            'utf8',
          ),
        ).toContain('committed:');
      } finally {
        await isolation.dispose();
      }
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('includes generated scope entries tracked at the selected commit', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-expert-generated-scope-'),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const fixtureRequest: ProfileRepositoryFixtureRequest = {
        expertName: 'internal_api_expert',
        fixtureRoot,
      };
      const repository =
        await ModuleExpertsRuntimeContractScenario.createProfileRepositoryFixture(
          fixtureRequest,
        );
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const requestFixture: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
        ...ModuleExpertsRuntimeContractScenario.runtimeIsolationRequest(
          requestFixture,
        ),
        expertName: 'internal_api_expert',
      };
      const isolationResult =
        await ModuleExpertIsolation.createModuleExpertRuntimeIsolation(
          isolationRequest,
        );
      assert(isolationResult.isOk());
      const isolation = isolationResult.value;
      try {
        const selected = ModuleExpertsRuntimeContractScenario.profile(
          'internal_api_expert',
        );
        for (const generatedScope of selected.generatedScopePaths) {
          expect(
            await readFile(
              join(isolation.repositorySnapshot, generatedScope.path),
              'utf8',
            ),
          ).toBe(`committed:${generatedScope.path}\n`);
        }
      } finally {
        await isolation.dispose();
      }
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('materializes exact authored binding consumers and configs without unrelated web code', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-expert-consumer-scope-'),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const fixtureRequest: ProfileRepositoryFixtureRequest = {
        expertName: 'internal_api_expert',
        fixtureRoot,
      };
      const repository =
        await ModuleExpertsRuntimeContractScenario.createProfileRepositoryFixture(
          fixtureRequest,
        );
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const requestFixture: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
        ...ModuleExpertsRuntimeContractScenario.runtimeIsolationRequest(
          requestFixture,
        ),
        expertName: 'internal_api_expert',
      };
      const isolationResult =
        await ModuleExpertIsolation.createModuleExpertRuntimeIsolation(
          isolationRequest,
        );
      assert(isolationResult.isOk());
      const isolation = isolationResult.value;
      try {
        const selected = ModuleExpertsRuntimeContractScenario.profile(
          'internal_api_expert',
        );
        for (const boundaryPath of selected.boundaryScopePaths) {
          expect(
            await readFile(
              join(isolation.repositorySnapshot, boundaryPath, 'fixture.txt'),
              'utf8',
            ),
          ).toBe(`committed:${join(boundaryPath, 'fixture.txt')}\n`);
        }
        for (const contextPath of selected.canonicalContextPaths) {
          expect(
            await readFile(
              join(isolation.repositorySnapshot, contextPath),
              'utf8',
            ),
          ).toBe(`committed:${contextPath}\n`);
        }
        for (const consumerPath of selected.scopePaths) {
          expect(
            await readFile(
              join(isolation.repositorySnapshot, consumerPath),
              'utf8',
            ),
          ).toBe(`committed:${consumerPath}\n`);
        }
        expect(
          selected.scopePaths.filter((path) => path.endsWith('.json')),
        ).toEqual([...INTERNAL_API_EXPERT_JSON_CONSUMER_SCOPE_PATHS]);
        await expect(
          access(
            join(isolation.repositorySnapshot, UNRELATED_WEB_CONSUMER_PATH),
          ),
        ).rejects.toThrow();
      } finally {
        await isolation.dispose();
      }
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('fails closed for unsupported auth, experts, commits, and guarded failures', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-expert-fail-closed-'),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const repository =
        await ModuleExpertsRuntimeContractScenario.createRepositoryFixture(
          fixtureRoot,
        );
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const fixtureRequest: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const baseRequest =
        ModuleExpertsRuntimeContractScenario.runtimeIsolationRequest(
          fixtureRequest,
        );
      const [defaulted8 = ''] = [process.env.PATH];
      const unsupportedAuthRequest: ModuleExpertRuntimeIsolationRequest = {
        ...baseRequest,
        parentEnvironment: {
          CODEX_ACCESS_TOKEN: 'unsupported',
          OPENAI_API_KEY: 'unsupported',
          PATH: defaulted8,
        },
      };
      const isolationFailure1 =
        await ModuleExpertIsolation.createModuleExpertRuntimeIsolation(
          unsupportedAuthRequest,
        );
      assert(isolationFailure1.isErr());
      expect(isolationFailure1.error.message).toContain(
        'requires CODEX_API_KEY authentication',
      );
      const unsupportedExpertRequest: ModuleExpertRuntimeIsolationRequest = {
        ...baseRequest,
        expertName: 'unregistered_expert',
      };
      const isolationFailure2 =
        await ModuleExpertIsolation.createModuleExpertRuntimeIsolation(
          unsupportedExpertRequest,
        );
      assert(isolationFailure2.isErr());
      expect(isolationFailure2.error.message).toContain(
        'requires a registered expert',
      );
      const invalidCommitRequest: ModuleExpertRuntimeIsolationRequest = {
        ...baseRequest,
        sourceCommit: 'HEAD',
      };
      const isolationFailure3 =
        await ModuleExpertIsolation.createModuleExpertRuntimeIsolation(
          invalidCommitRequest,
        );
      assert(isolationFailure3.isErr());
      expect(isolationFailure3.error.message).toContain(
        'must be a full Git SHA',
      );

      const isolationUse: ModuleExpertRuntimeIsolationUse<never> = {
        isolationRequest: baseRequest,
        run: () => Promise.reject(new Error('agent turn failed')),
      };
      await expect(
        ModuleExpertIsolation.withModuleExpertRuntimeIsolation(isolationUse),
      ).rejects.toThrow('agent turn failed');
      expect(await readdir(isolationRoot)).toEqual([]);
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('excludes model-controlled process tools from the pinned Codex CLI', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-expert-toolset-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    const requestBodies: string[] = [];
    let providerRequestCount = 0;
    const providerServerOptions: Bun.Serve.Options<never> = {
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => {
        const body = await request.text();
        if (!body) {
          const responseOptions: ResponseInit = { status: 404 };
          return new Response(
            'fixture endpoint requires a body',
            responseOptions,
          );
        }
        requestBodies[requestBodies.length] = body;
        providerRequestCount += 1;
        const toolAttemptRequest: ToolAttemptEventsRequest = {
          originalRepository: fixtureRoot,
        };
        const events =
          providerRequestCount === 1
            ? ModuleExpertsRuntimeContractScenario.toolAttemptEvents(
                toolAttemptRequest,
              )
            : ModuleExpertsRuntimeContractScenario.completedResponseEvents();
        const headers = new Headers();
        headers.set('content-type', 'text/event-stream');
        const responseOptions: ResponseInit = { headers, status: 200 };
        return new Response(
          ModuleExpertsRuntimeContractScenario.serializeSse(events),
          responseOptions,
        );
      },
    };
    const providerServer = Bun.serve(providerServerOptions);
    try {
      const repository =
        await ModuleExpertsRuntimeContractScenario.createRepositoryFixture(
          fixtureRoot,
        );
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const fixtureRequest: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolationResult =
        await ModuleExpertIsolation.createModuleExpertRuntimeIsolation(
          ModuleExpertsRuntimeContractScenario.runtimeIsolationRequest(
            fixtureRequest,
          ),
        );
      assert(isolationResult.isOk());
      const isolation = isolationResult.value;
      try {
        const provider =
          isolation.codexOptions.config.model_providers[
            MODULE_EXPERT_AUTH_PROVIDER
          ];
        const codexOptions: CodexOptions = {
          ...isolation.codexOptions,
          config: {
            ...isolation.codexOptions.config,
            model_providers: {
              [MODULE_EXPERT_AUTH_PROVIDER]: {
                ...provider,
                base_url: `http://127.0.0.1:${providerServer.port}/v1`,
              },
            },
          },
        };
        const codex = new Codex(codexOptions);
        const thread = codex.startThread(isolation.threadOptions);
        const turnOptions: TurnOptions = {
          signal: AbortSignal.timeout(15_000),
        };
        await thread.run('Inspect the assigned module.', turnOptions);
        const [requestBody = ''] = [requestBodies[0]];
        expect(requestBody).not.toBe('');
        const capturedRequest = capturedCodexRequestFromHost(
          UntrustedYamlBoundary.fromJson(JSON.parse(requestBody)),
        );
        const metadataValues = capturedRequest.client_metadata;
        if (!metadataValues) throw new Error('Expected Codex client metadata.');
        const encodedMetadata = metadataValues['x-codex-turn-metadata'];
        expect(encodedMetadata).toBeString();
        if (!encodedMetadata) throw new Error('Expected turn metadata.');
        const metadata = capturedCodexTurnMetadataFromHost(
          UntrustedYamlBoundary.fromJson(JSON.parse(encodedMetadata)),
        );
        const emptyToolNames: CapturedCodexTurnMetadata['code_mode_tool_names'] =
          {};
        const [defaulted10 = emptyToolNames] = [metadata.code_mode_tool_names];
        const toolNames = Object.keys(defaulted10).sort();
        for (const toolName of MODULE_EXPERT_READ_CONTEXT_TOOLS) {
          expect(toolNames).toContain(
            `mcp__${MODULE_EXPERT_CONTEXT_MCP}__${toolName}`,
          );
        }
        for (const forbiddenTool of [
          'exec_command',
          'shell',
          'spawn_agent',
          'unified_exec',
          'view_image',
          'web_search',
        ]) {
          expect(toolNames).not.toContain(forbiddenTool);
        }
        expect(requestBodies.length).toBeGreaterThanOrEqual(2);
        const [defaulted11 = ''] = [isolation.threadOptions.workingDirectory];
        const emptyWorkspaceMutation = join(defaulted11, 'forbidden.txt');
        const snapshotMutation = join(
          isolation.repositorySnapshot,
          'forbidden.txt',
        );
        const originalMutation = join(repository.root, 'forbidden.txt');
        await expect(access(emptyWorkspaceMutation)).rejects.toThrow();
        await expect(access(snapshotMutation)).rejects.toThrow();
        await expect(access(originalMutation)).rejects.toThrow();
        const [toolOutputRequest = ''] = [requestBodies[1]];
        expect(toolOutputRequest).toContain('read-only');
        expect(toolOutputRequest).toContain(
          'tools.view_image is not a function',
        );
        expect(toolOutputRequest).not.toContain(API_KEY_SENTINEL);
      } finally {
        await isolation.dispose();
      }
    } finally {
      await providerServer.stop(true);
      await rm(fixtureRoot, removeOptions);
    }
  }, 20_000);
});

type CapturedCodexRequest = {
  readonly client_metadata?: Readonly<Record<string, string>>;
};

type CapturedCodexTurnMetadata = {
  readonly code_mode_tool_names?: Readonly<
    Record<string, { readonly name: string; readonly namespace?: string }>
  >;
};

function capturedCodexRequestFromHost(
  value: UntrustedYamlNode,
): CapturedCodexRequest {
  if (!UntrustedYamlBoundary.isRecord(value))
    throw new Error('Expected a captured Codex request.');
  if (!('client_metadata' in value))
    throw new Error('Expected Codex client metadata.');
  const metadata = value.client_metadata;
  if (!UntrustedYamlBoundary.isRecord(metadata))
    throw new Error('Expected Codex client metadata.');
  const values: Record<string, string> = {};
  for (const [key, entry] of Object.entries(metadata)) {
    if (typeof entry !== 'string')
      throw new Error('Expected Codex client metadata values.');
    values[key] = entry;
  }
  return { client_metadata: values };
}

function capturedCodexTurnMetadataFromHost(
  value: UntrustedYamlNode,
): CapturedCodexTurnMetadata {
  if (!UntrustedYamlBoundary.isRecord(value))
    throw new Error('Expected Codex turn metadata.');
  if (!('code_mode_tool_names' in value)) return {};
  const toolValues = value.code_mode_tool_names;
  if (!UntrustedYamlBoundary.isRecord(toolValues))
    throw new Error('Expected Codex tool names.');
  const names: Record<string, { name: string; namespace?: string }> = {};
  for (const [key, entry] of Object.entries(toolValues)) {
    if (
      !UntrustedYamlBoundary.isRecord(entry) ||
      typeof entry.name !== 'string'
    )
      throw new Error('Expected Codex tool names.');
    const name: { name: string; namespace?: string } = { name: entry.name };
    if ('namespace' in entry) {
      if (typeof entry.namespace !== 'string')
        throw new Error('Expected Codex tool namespace.');
      name.namespace = entry.namespace;
    }
    names[key] = name;
  }
  return { code_mode_tool_names: names };
}
