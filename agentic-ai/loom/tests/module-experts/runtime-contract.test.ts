import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import type { MakeDirectoryOptions, RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { Codex } from '@openai/codex-sdk';
import type { CodexOptions, TurnOptions } from '@openai/codex-sdk';
import {
  INTERNAL_API_EXPERT_JSON_CONSUMER_SCOPE_PATHS,
  MODULE_EXPERT_CATALOG,
} from '../../src/module-experts/catalog.ts';
import type { ModuleExpertProfile } from '../../src/module-experts/catalog.ts';
import { MODULE_EXPERT_READ_CONTEXT_TOOLS } from '../../src/module-experts/read-context-mcp.ts';
import {
  MODULE_EXPERT_AUTH_BROKER_CLIENT_SOURCE,
  MODULE_EXPERT_AUTH_PROVIDER,
  MODULE_EXPERT_CODEX_OPTIONS,
  MODULE_EXPERT_CONTEXT_MCP,
  createModuleExpertRuntimeIsolation,
  withModuleExpertRuntimeIsolation,
} from '../../src/module-experts/runtime-contract.ts';
import type {
  ModuleExpertRuntimeIsolation,
  ModuleExpertRuntimeIsolationRequest,
  ModuleExpertRuntimeIsolationUse,
} from '../../src/module-experts/runtime-contract.ts';
import { runCommand } from '../../src/lib/run.ts';
import type { RunCommandArgs } from '../../src/lib/run.ts';

const EXPERT_NAME = 'app_common_expert';
const API_KEY_SENTINEL = 'codex-api-key-must-not-persist';
const ANALYZED_HELPER_DECOY_PATH =
  'agentic-ai/loom/src/module-experts/auth-broker-client.ts';
const UNRELATED_WEB_CONSUMER_PATH =
  'nook-app/nook-web/nook-web-shared/src/private/unrelated-consumer.ts';

const DECOY_ENVIRONMENT: NodeJS.ProcessEnv = {
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  AWS_SESSION_TOKEN: 'aws-session',
  CODEX_ACCESS_TOKEN: 'unsupported-access-token',
  DATABASE_URL: 'postgres://credential@example.test/database',
  DOCKER_HOST: 'ssh://privileged-docker.example.test',
  GH_TOKEN: 'gh-token',
  GITHUB_TOKEN: 'github-token',
  KUBECONFIG: '/sensitive/kubeconfig',
  NPM_TOKEN: 'npm-token',
  OPENAI_API_KEY: 'unsupported-openai-key',
  PROJECT_SECRET: 'project-secret',
  SSH_AUTH_SOCK: '/sensitive/ssh-agent.sock',
};

type RepositoryFixture = {
  readonly committedEntryContent: string;
  readonly root: string;
  readonly sourceCommit: string;
};

type AuthenticationCommand = {
  readonly args: readonly string[];
  readonly command: string;
};

describe('module expert runtime isolation', () => {
  test('isolates credentials, capabilities, repository scope, and working state', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-expert-runtime-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const repository = await createRepositoryFixture(fixtureRoot);
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const parentEnvironment: NodeJS.ProcessEnv = {
        ...DECOY_ENVIRONMENT,
        CODEX_API_KEY: API_KEY_SENTINEL,
        CODEX_HOME: join(fixtureRoot, 'parent-codex-home'),
        PATH: process.env.PATH ?? '',
      };
      const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
        expertName: EXPERT_NAME,
        parentEnvironment,
        selectedContextPaths: [],
        sourceCommit: repository.sourceCommit,
        temporaryRoot: isolationRoot,
        workingDirectory: repository.root,
      };
      const isolation =
        await createModuleExpertRuntimeIsolation(isolationRequest);
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
        expect(await treeContains(treeSearch)).toBe(false);
        expect(isolation.threadOptions.workingDirectory).toBe(
          join(isolation.codexHome, 'workspace'),
        );
        expect(isolation.threadOptions.skipGitRepoCheck).toBe(true);
        expect(
          await readdir(isolation.threadOptions.workingDirectory ?? ''),
        ).toEqual([]);
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
        const authentication = authenticationCommand(isolation);
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

        const snapshotEntry = join(
          isolation.repositorySnapshot,
          profile().publicEntryPoints[0] ?? '',
        );
        expect(await readFile(snapshotEntry, 'utf8')).toBe(
          repository.committedEntryContent,
        );
        for (const contextPath of profile().canonicalContextPaths) {
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
      const repository = await createRepositoryFixture(fixtureRoot);
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const fixtureRequest: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolationRequest = runtimeIsolationRequest(fixtureRequest);
      const isolation =
        await createModuleExpertRuntimeIsolation(isolationRequest);
      try {
        const command = authenticationCommand(isolation);
        expect(command.args.join(' ')).not.toContain(API_KEY_SENTINEL);
        const firstRun: AuthenticationCommandRun = { command, isolation };
        const first = await runAuthenticationCommand(firstRun);
        expect(first.exitCode).toBe(0);
        expect(first.stdout.trim()).toBe(API_KEY_SENTINEL);
        const secondRun: AuthenticationCommandRun = { command, isolation };
        const second = await runAuthenticationCommand(secondRun);
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
      const repository = await createRepositoryFixture(fixtureRoot);
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const fixtureRequest: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolation = await createModuleExpertRuntimeIsolation(
        runtimeIsolationRequest(fixtureRequest),
      );
      try {
        const command = authenticationCommand(isolation);
        const invalidRequest: BrokerSocketRequest = {
          nonce: 'invalid-nonce',
          socketPath: command.args[3] ?? '',
        };
        expect(await redeemBrokerSocket(invalidRequest)).toBe('');
        const validRequest: BrokerSocketRequest = {
          nonce: command.args[4] ?? '',
          socketPath: command.args[3] ?? '',
        };
        expect((await redeemBrokerSocket(validRequest)).trim()).toBe(
          API_KEY_SENTINEL,
        );
        expect(await redeemBrokerSocket(validRequest)).toBe('');
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
      const repository = await createRepositoryFixture(fixtureRoot);
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const fixtureRequest: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolationRequest = runtimeIsolationRequest(fixtureRequest);
      const first = await createModuleExpertRuntimeIsolation(isolationRequest);
      const second = await createModuleExpertRuntimeIsolation(isolationRequest);
      try {
        expect(first.codexHome).not.toBe(second.codexHome);
        expect(first.repositorySnapshot).not.toBe(second.repositorySnapshot);
        const firstMcp =
          first.codexOptions.config.mcp_servers[MODULE_EXPERT_CONTEXT_MCP];
        const secondMcp =
          second.codexOptions.config.mcp_servers[MODULE_EXPERT_CONTEXT_MCP];
        expect(firstMcp.url).not.toBe(secondMcp.url);
        const firstRun: AuthenticationCommandRun = {
          command: authenticationCommand(first),
          isolation: first,
        };
        const firstResult = await runAuthenticationCommand(firstRun);
        const secondRun: AuthenticationCommandRun = {
          command: authenticationCommand(second),
          isolation: second,
        };
        const secondResult = await runAuthenticationCommand(secondRun);
        expect(firstResult.stdout.trim()).toBe(API_KEY_SENTINEL);
        expect(secondResult.stdout.trim()).toBe(API_KEY_SENTINEL);
        await first.dispose();
        expect((await readdir(isolationRoot)).length).toBe(1);
        expect(
          await readFile(
            join(
              second.repositorySnapshot,
              profile().publicEntryPoints[0] ?? '',
            ),
            'utf8',
          ),
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
      const repository = await createProfileRepositoryFixture(fixtureRequest);
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const requestFixture: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
        ...runtimeIsolationRequest(requestFixture),
        expertName: 'web_expert',
        selectedContextPaths: [
          '.cortex/teams/web-dev/product-specs/browser-extension.md',
          '.cortex/teams/web-dev/dynamic-skills/ui-design-skills.md',
        ],
      };
      const isolation =
        await createModuleExpertRuntimeIsolation(isolationRequest);
      try {
        const webProfile = profile('web_expert');
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
      const repository = await createProfileRepositoryFixture(fixtureRequest);
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const requestFixture: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
        ...runtimeIsolationRequest(requestFixture),
        expertName: 'internal_api_expert',
      };
      const isolation =
        await createModuleExpertRuntimeIsolation(isolationRequest);
      try {
        const selected = profile('internal_api_expert');
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
      const repository = await createProfileRepositoryFixture(fixtureRequest);
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const requestFixture: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
        ...runtimeIsolationRequest(requestFixture),
        expertName: 'internal_api_expert',
      };
      const isolation =
        await createModuleExpertRuntimeIsolation(isolationRequest);
      try {
        const selected = profile('internal_api_expert');
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
      const repository = await createRepositoryFixture(fixtureRoot);
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const fixtureRequest: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const baseRequest = runtimeIsolationRequest(fixtureRequest);
      const unsupportedAuthRequest: ModuleExpertRuntimeIsolationRequest = {
        ...baseRequest,
        parentEnvironment: {
          CODEX_ACCESS_TOKEN: 'unsupported',
          OPENAI_API_KEY: 'unsupported',
          PATH: process.env.PATH ?? '',
        },
      };
      await expect(
        createModuleExpertRuntimeIsolation(unsupportedAuthRequest),
      ).rejects.toThrow('requires CODEX_API_KEY authentication');
      const unsupportedExpertRequest: ModuleExpertRuntimeIsolationRequest = {
        ...baseRequest,
        expertName: 'unregistered_expert',
      };
      await expect(
        createModuleExpertRuntimeIsolation(unsupportedExpertRequest),
      ).rejects.toThrow('requires a registered expert');
      const invalidCommitRequest: ModuleExpertRuntimeIsolationRequest = {
        ...baseRequest,
        sourceCommit: 'HEAD',
      };
      await expect(
        createModuleExpertRuntimeIsolation(invalidCommitRequest),
      ).rejects.toThrow('must be a full Git SHA');

      const isolationUse: ModuleExpertRuntimeIsolationUse<never> = {
        isolationRequest: baseRequest,
        run: () => Promise.reject(new Error('agent turn failed')),
      };
      await expect(
        withModuleExpertRuntimeIsolation(isolationUse),
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
            ? toolAttemptEvents(toolAttemptRequest)
            : completedResponseEvents();
        const headers = new Headers();
        headers.set('content-type', 'text/event-stream');
        const responseOptions: ResponseInit = { headers, status: 200 };
        return new Response(serializeSse(events), responseOptions);
      },
    };
    const providerServer = Bun.serve(providerServerOptions);
    try {
      const repository = await createRepositoryFixture(fixtureRoot);
      const isolationRoot = join(fixtureRoot, 'isolated');
      await mkdir(isolationRoot);
      const fixtureRequest: RuntimeIsolationFixtureRequest = {
        isolationRoot,
        repository,
      };
      const isolation = await createModuleExpertRuntimeIsolation(
        runtimeIsolationRequest(fixtureRequest),
      );
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
        const requestBody = requestBodies[0] ?? '';
        expect(requestBody).not.toBe('');
        const capturedRequest = JSON.parse(requestBody) as CapturedCodexRequest;
        const encodedMetadata =
          capturedRequest.client_metadata?.['x-codex-turn-metadata'];
        expect(encodedMetadata).toBeString();
        const metadata = JSON.parse(
          encodedMetadata ?? '{}',
        ) as CapturedCodexTurnMetadata;
        const emptyToolNames: CapturedCodexTurnMetadata['code_mode_tool_names'] =
          {};
        const toolNames = Object.keys(
          metadata.code_mode_tool_names ?? emptyToolNames,
        ).sort();
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
        const emptyWorkspaceMutation = join(
          isolation.threadOptions.workingDirectory ?? '',
          'forbidden.txt',
        );
        const snapshotMutation = join(
          isolation.repositorySnapshot,
          'forbidden.txt',
        );
        const originalMutation = join(repository.root, 'forbidden.txt');
        await expect(access(emptyWorkspaceMutation)).rejects.toThrow();
        await expect(access(snapshotMutation)).rejects.toThrow();
        await expect(access(originalMutation)).rejects.toThrow();
        const toolOutputRequest = requestBodies[1] ?? '';
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
  });
});

type RuntimeIsolationFixtureRequest = {
  readonly isolationRoot: string;
  readonly repository: RepositoryFixture;
};

type CapturedCodexRequest = {
  readonly client_metadata?: Readonly<Record<string, string>>;
};

type CapturedCodexTurnMetadata = {
  readonly code_mode_tool_names?: Readonly<
    Record<string, { readonly name: string; readonly namespace?: string }>
  >;
};

type SseEvent = {
  readonly type: string;
  readonly response?: {
    readonly id: string;
    readonly usage?: {
      readonly input_tokens: number;
      readonly output_tokens: number;
      readonly total_tokens: number;
    };
  };
  readonly item?: {
    readonly call_id?: string;
    readonly content?: readonly [
      { readonly text: string; readonly type: string },
    ];
    readonly id?: string;
    readonly input?: string;
    readonly name?: string;
    readonly role?: string;
    readonly type: string;
  };
};

type ToolAttemptEventsRequest = {
  readonly originalRepository: string;
};

function toolAttemptEvents(
  request: ToolAttemptEventsRequest,
): readonly SseEvent[] {
  const code = [
    'const results = [];',
    'try { results.push(await tools.apply_patch(`*** Begin Patch\\n*** Add File: forbidden.txt\\n+blocked\\n*** End Patch`)); } catch (error) { results.push(String(error)); }',
    'try { results.push(await tools.apply_patch(`*** Begin Patch\\n*** Add File: ../repository/forbidden.txt\\n+blocked\\n*** End Patch`)); } catch (error) { results.push(String(error)); }',
    `try { results.push(await tools.apply_patch(\`*** Begin Patch\\n*** Add File: ${request.originalRepository}/repository/forbidden.txt\\n+blocked\\n*** End Patch\`)); } catch (error) { results.push(String(error)); }`,
    'try { results.push(await tools.view_image({ path: "../repository/nook-app/nook-platform/nook-app-common/src/lib.rs" })); } catch (error) { results.push(String(error)); }',
    'text(JSON.stringify(results));',
  ].join('\n');
  return [
    { type: 'response.created', response: { id: 'response-1' } },
    {
      type: 'response.output_item.done',
      item: {
        type: 'custom_tool_call',
        call_id: 'call-1',
        name: 'exec',
        input: code,
      },
    },
    completedEvent('response-1'),
  ];
}

function completedResponseEvents(): readonly SseEvent[] {
  return [
    { type: 'response.created', response: { id: 'response-2' } },
    {
      type: 'response.output_item.done',
      item: {
        type: 'message',
        role: 'assistant',
        id: 'message-1',
        content: [{ type: 'output_text', text: 'done' }],
      },
    },
    completedEvent('response-2'),
  ];
}

function completedEvent(id: string): SseEvent {
  return {
    type: 'response.completed',
    response: {
      id,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      },
    },
  };
}

function serializeSse(events: readonly SseEvent[]): string {
  return events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
}

function runtimeIsolationRequest(
  request: RuntimeIsolationFixtureRequest,
): ModuleExpertRuntimeIsolationRequest {
  return {
    expertName: EXPERT_NAME,
    parentEnvironment: {
      ...DECOY_ENVIRONMENT,
      CODEX_API_KEY: API_KEY_SENTINEL,
      PATH: process.env.PATH ?? '',
    },
    sourceCommit: request.repository.sourceCommit,
    selectedContextPaths: [],
    temporaryRoot: request.isolationRoot,
    workingDirectory: request.repository.root,
  };
}

function profile(expertName = EXPERT_NAME): ModuleExpertProfile {
  const selected = MODULE_EXPERT_CATALOG.find(
    (candidate) => candidate.name === expertName,
  );
  if (!selected) throw new Error('Test module expert profile is missing.');
  return selected;
}

async function createRepositoryFixture(
  fixtureRoot: string,
): Promise<RepositoryFixture> {
  const fixtureRequest: ProfileRepositoryFixtureRequest = {
    expertName: EXPERT_NAME,
    fixtureRoot,
  };
  return createProfileRepositoryFixture(fixtureRequest);
}

type ProfileRepositoryFixtureRequest = {
  readonly expertName: string;
  readonly fixtureRoot: string;
};

async function createProfileRepositoryFixture(
  request: ProfileRepositoryFixtureRequest,
): Promise<RepositoryFixture> {
  const root = join(request.fixtureRoot, 'repository');
  await mkdir(root);
  const selected = profile(request.expertName);
  const generatedPaths = selected.generatedScopePaths.flatMap((scope) => [
    scope.path,
    scope.producerPath,
  ]);
  const paths = [
    '.cortex/knowledge-graph.md',
    ANALYZED_HELPER_DECOY_PATH,
    UNRELATED_WEB_CONSUMER_PATH,
    ...selected.boundaryScopePaths.map((boundaryRoot) =>
      join(boundaryRoot, 'fixture.txt'),
    ),
    ...selected.canonicalContextPaths,
    ...selected.allowedContextPaths,
    ...selected.moduleRoots.map((moduleRoot) =>
      join(moduleRoot, 'fixture.txt'),
    ),
    ...selected.scopePaths,
    ...generatedPaths,
    ...selected.publicEntryPoints,
    ...selected.authorityPaths,
    ...selected.skillPaths,
    ...selected.excludedPaths.map((excludedPath) =>
      join(excludedPath, 'excluded.txt'),
    ),
  ];
  for (const path of new Set(paths)) {
    const directoryOptions: MakeDirectoryOptions = { recursive: true };
    await mkdir(dirname(join(root, path)), directoryOptions);
    const content =
      path === ANALYZED_HELPER_DECOY_PATH
        ? 'process.stdout.write(process.env.CODEX_API_KEY ?? "stolen");\n'
        : `committed:${path}\n`;
    await writeFile(join(root, path), content, 'utf8');
  }
  const unrelatedDirectory = join(root, 'unrelated-module');
  const directoryOptions: MakeDirectoryOptions = { recursive: true };
  await mkdir(unrelatedDirectory, directoryOptions);
  await writeFile(
    join(unrelatedDirectory, 'private.txt'),
    'unrelated\n',
    'utf8',
  );
  const gitInit: RunCommandArgs = { command: 'git', args: ['init'], cwd: root };
  expect(runCommand(gitInit).exitCode).toBe(0);
  const gitAdd: RunCommandArgs = {
    command: 'git',
    args: ['add', '.'],
    cwd: root,
  };
  expect(runCommand(gitAdd).exitCode).toBe(0);
  const gitCommit: RunCommandArgs = {
    command: 'git',
    args: [
      '-c',
      'user.name=Nook Test',
      '-c',
      'user.email=nook-test@example.test',
      'commit',
      '-m',
      'fixture',
    ],
    cwd: root,
  };
  expect(runCommand(gitCommit).exitCode).toBe(0);
  const gitRevision: RunCommandArgs = {
    command: 'git',
    args: ['rev-parse', 'HEAD'],
    cwd: root,
  };
  const sourceCommit = runCommand(gitRevision).stdout.trim();
  const entryPoint = selected.publicEntryPoints[0] ?? '';
  const committedEntryContent = `committed:${entryPoint}\n`;
  await writeFile(join(root, entryPoint), 'mutable worktree content\n', 'utf8');
  await writeFile(
    join(root, ANALYZED_HELPER_DECOY_PATH),
    'process.stdout.write("mutable helper executed\\n");\n',
    'utf8',
  );
  for (const scopePath of selected.scopePaths) {
    await writeFile(join(root, scopePath), 'mutable scope content\n', 'utf8');
  }
  for (const skillPath of selected.skillPaths) {
    await writeFile(join(root, skillPath), 'mutable skill content\n', 'utf8');
  }
  return { committedEntryContent, root, sourceCommit };
}

function authenticationCommand(
  isolation: ModuleExpertRuntimeIsolation,
): AuthenticationCommand {
  const provider =
    isolation.codexOptions.config.model_providers[MODULE_EXPERT_AUTH_PROVIDER];
  return { args: provider.auth.args, command: provider.auth.command };
}

type AuthenticationCommandRun = {
  readonly command: AuthenticationCommand;
  readonly isolation: ModuleExpertRuntimeIsolation;
};

type BrokerSocketRequest = {
  readonly nonce: string;
  readonly socketPath: string;
};

type BrokerSocketClientData = [Bun.Socket, Buffer];

function redeemBrokerSocket(request: BrokerSocketRequest): Promise<string> {
  return new Promise((resolveRedemption) => {
    let response = '';
    const socketOptions: Bun.UnixSocketOptions = {
      unix: request.socketPath,
      socket: {
        binaryType: 'buffer',
        data: (...parameters: BrokerSocketClientData) => {
          const [socket, data] = parameters;
          response += data.toString('utf8');
          socket.close();
        },
        close: () => resolveRedemption(response),
        error: () => resolveRedemption(response),
        open: (socket) => {
          const midpoint = Math.floor(request.nonce.length / 2);
          socket.write(request.nonce.slice(0, midpoint));
          setTimeout(() => {
            socket.write(`${request.nonce.slice(midpoint)}\n`);
          }, 1);
        },
      },
    };
    void Bun.connect(socketOptions);
  });
}

type AuthenticationCommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

async function runAuthenticationCommand(
  run: AuthenticationCommandRun,
): Promise<AuthenticationCommandResult> {
  const spawnOptions = {
    env: run.isolation.codexOptions.env,
    stderr: 'pipe',
    stdout: 'pipe',
  } as const;
  const child = Bun.spawn(
    [run.command.command, ...run.command.args],
    spawnOptions,
  );
  const exitCode = await child.exited;
  const stdout = await new Response(child.stdout).text();
  await new Response(child.stderr).text();
  return { exitCode, stdout };
}

type TreeContainsRequest = {
  readonly root: string;
  readonly sentinel: string;
};

async function treeContains(request: TreeContainsRequest): Promise<boolean> {
  const directoryOptions = { withFileTypes: true } as const;
  for (const entry of await readdir(request.root, directoryOptions)) {
    const path = join(request.root, entry.name);
    if (entry.isDirectory()) {
      const nestedRequest: TreeContainsRequest = {
        root: path,
        sentinel: request.sentinel,
      };
      if (await treeContains(nestedRequest)) return true;
      continue;
    }
    if (!entry.isFile()) continue;
    const bytes = await readFile(path);
    if (bytes.includes(Buffer.from(request.sentinel, 'utf8'))) return true;
  }
  return false;
}
