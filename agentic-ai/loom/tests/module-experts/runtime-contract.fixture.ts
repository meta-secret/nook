import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

import type { MakeDirectoryOptions } from 'node:fs';

import { dirname, join } from 'node:path';

import { expect } from 'bun:test';

import { MODULE_EXPERT_CATALOG } from '../../src/module-experts/catalog.ts';

import type { ModuleExpertProfile } from '../../src/module-experts/catalog.ts';

import { MODULE_EXPERT_AUTH_PROVIDER } from '../../src/module-experts/runtime-contract.ts';

import type {
  ModuleExpertRuntimeIsolation,
  ModuleExpertRuntimeIsolationRequest,
} from '../../src/module-experts/runtime-contract.ts';

import { HostCommand } from '../../src/lib/run.ts';

import type { RunCommandArgs } from '../../src/lib/run.ts';
export class ModuleExpertsRuntimeContractScenario {
  private constructor(
    private readonly request: RuntimeIsolationFixtureRequest,
  ) {}

  static toolAttemptEvents(
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
      ModuleExpertsRuntimeContractScenario.completedEvent('response-1'),
    ];
  }

  static completedResponseEvents(): readonly SseEvent[] {
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
      ModuleExpertsRuntimeContractScenario.completedEvent('response-2'),
    ];
  }

  static completedEvent(id: string): SseEvent {
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

  static serializeSse(events: readonly SseEvent[]): string {
    return events
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join('');
  }

  static runtimeIsolationRequest(
    request: RuntimeIsolationFixtureRequest,
  ): ModuleExpertRuntimeIsolationRequest {
    return new ModuleExpertsRuntimeContractScenario(request).execute();
  }

  private execute(): ModuleExpertRuntimeIsolationRequest {
    const request = this.request;
    const [defaulted12 = ''] = [process.env.PATH];
    return {
      expertName: EXPERT_NAME,
      parentEnvironment: {
        ...DECOY_ENVIRONMENT,
        CODEX_API_KEY: API_KEY_SENTINEL,
        PATH: defaulted12,
      },
      sourceCommit: request.repository.sourceCommit,
      selectedContextPaths: [],
      temporaryRoot: request.isolationRoot,
      workingDirectory: request.repository.root,
    };
  }

  static profile(expertName = EXPERT_NAME): ModuleExpertProfile {
    const selected = MODULE_EXPERT_CATALOG.find(
      (candidate) => candidate.name === expertName,
    );
    if (!selected) throw new Error('Test module expert profile is missing.');
    return selected;
  }

  static async createRepositoryFixture(
    fixtureRoot: string,
  ): Promise<RepositoryFixture> {
    const fixtureRequest: ProfileRepositoryFixtureRequest = {
      expertName: EXPERT_NAME,
      fixtureRoot,
    };
    return ModuleExpertsRuntimeContractScenario.createProfileRepositoryFixture(
      fixtureRequest,
    );
  }

  static async createProfileRepositoryFixture(
    request: ProfileRepositoryFixtureRequest,
  ): Promise<RepositoryFixture> {
    const root = join(request.fixtureRoot, 'repository');
    await mkdir(root);
    const selected = ModuleExpertsRuntimeContractScenario.profile(
      request.expertName,
    );
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
          ? 'process.stdout.write(process.env.CODEX_API_KEY);\n'
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
    const gitInit: RunCommandArgs = {
      command: 'git',
      args: ['init'],
      cwd: root,
    };
    expect(HostCommand.run(gitInit).exitCode).toBe(0);
    const gitAdd: RunCommandArgs = {
      command: 'git',
      args: ['add', '.'],
      cwd: root,
    };
    expect(HostCommand.run(gitAdd).exitCode).toBe(0);
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
    expect(HostCommand.run(gitCommit).exitCode).toBe(0);
    const gitRevision: RunCommandArgs = {
      command: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd: root,
    };
    const sourceCommit = HostCommand.run(gitRevision).stdout.trim();
    const [entryPoint = ''] = [selected.publicEntryPoints[0]];
    const committedEntryContent = `committed:${entryPoint}\n`;
    await writeFile(
      join(root, entryPoint),
      'mutable worktree content\n',
      'utf8',
    );
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

  static authenticationCommand(
    isolation: ModuleExpertRuntimeIsolation,
  ): AuthenticationCommand {
    const provider =
      isolation.codexOptions.config.model_providers[
        MODULE_EXPERT_AUTH_PROVIDER
      ];
    return { args: provider.auth.args, command: provider.auth.command };
  }

  static redeemBrokerSocket(request: BrokerSocketRequest): Promise<string> {
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

  static async runAuthenticationCommand(
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

  static async treeContains(request: TreeContainsRequest): Promise<boolean> {
    const directoryOptions = { withFileTypes: true } as const;
    for (const entry of await readdir(request.root, directoryOptions)) {
      const path = join(request.root, entry.name);
      if (entry.isDirectory()) {
        const nestedRequest: TreeContainsRequest = {
          root: path,
          sentinel: request.sentinel,
        };
        if (
          await ModuleExpertsRuntimeContractScenario.treeContains(nestedRequest)
        )
          return true;
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = await readFile(path);
      if (bytes.includes(Buffer.from(request.sentinel, 'utf8'))) return true;
    }
    return false;
  }
}

export const EXPERT_NAME = 'app_common_expert';

export const API_KEY_SENTINEL = 'codex-api-key-must-not-persist';

export const ANALYZED_HELPER_DECOY_PATH =
  'agentic-ai/loom/src/module-experts/auth-broker-client.ts';

export const UNRELATED_WEB_CONSUMER_PATH =
  'nook-app/nook-web/nook-web-shared/src/private/unrelated-consumer.ts';

export const DECOY_ENVIRONMENT: NodeJS.ProcessEnv = {
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

export type RepositoryFixture = {
  readonly committedEntryContent: string;
  readonly root: string;
  readonly sourceCommit: string;
};

export type AuthenticationCommand = {
  readonly args: readonly string[];
  readonly command: string;
};

export type RuntimeIsolationFixtureRequest = {
  readonly isolationRoot: string;
  readonly repository: RepositoryFixture;
};

export type SseEvent = {
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

export type ToolAttemptEventsRequest = {
  readonly originalRepository: string;
};

export type ProfileRepositoryFixtureRequest = {
  readonly expertName: string;
  readonly fixtureRoot: string;
};

export type AuthenticationCommandRun = {
  readonly command: AuthenticationCommand;
  readonly isolation: ModuleExpertRuntimeIsolation;
};

export type BrokerSocketRequest = {
  readonly nonce: string;
  readonly socketPath: string;
};

export type BrokerSocketClientData = [Bun.Socket, Buffer];

export type AuthenticationCommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

export type TreeContainsRequest = {
  readonly root: string;
  readonly sentinel: string;
};
