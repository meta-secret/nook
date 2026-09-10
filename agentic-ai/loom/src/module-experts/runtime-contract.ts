import { err, ok, type Result } from 'neverthrow';
import {
  ExpertIsolationFailureKind,
  type ExpertIsolationFailure,
} from './isolation-failure.ts';
import {
  RepositorySnapshot,
  SnapshotContextFiles,
  type RepositorySnapshotRequest,
  type SnapshotContextFilesRequest,
} from './repository-snapshot.ts';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';
import { MODULE_EXPERT_CATALOG } from './catalog.ts';
import type { ModuleExpertProfile } from './catalog.ts';
import { ModuleExpertContextAdmission } from './context-selection.ts';
import type { ModuleExpertContextSelection } from './context-selection.ts';
import {
  MODULE_EXPERT_READ_CONTEXT_TOOLS,
  ModuleExpertRepositoryContext,
} from './read-context-mcp.ts';
import type { ModuleExpertReadContextServer } from './read-context-mcp.ts';

/** Owns the module expert isolation registry and its capability transitions. */
export class ModuleExpertIsolation {
  private constructor() {}
  private static readonly ISOLATED_CODEX_HOME_PREFIX =
    'nook-module-expert-codex-';

  private static readonly AUTH_BROKER_SOCKET_NAME = 'authentication.sock';

  private static readonly ISOLATED_WORKSPACE_NAME = 'workspace';

  static async createModuleExpertRuntimeIsolation(
    request: ModuleExpertRuntimeIsolationRequest,
  ): Promise<Result<ModuleExpertRuntimeIsolation, ExpertIsolationFailure>> {
    const profileResult = ModuleExpertIsolation.moduleExpertProfile(
      request.expertName,
    );
    if (profileResult.isErr()) return err(profileResult.error);
    const profile = profileResult.value;
    const contextSelection: ModuleExpertContextSelection = {
      expertName: request.expertName,
      selectedContextPaths: request.selectedContextPaths,
    };
    const selectedContextPaths =
      ModuleExpertContextAdmission.validate(contextSelection);
    const snapshotRequest: ModuleExpertSnapshotPathsRequest = {
      profile,
      selectedContextPaths,
    };
    const sharedRequest: ReadOnlyExpertRuntimeIsolationRequest = {
      expertName: request.expertName,
      parentEnvironment: request.parentEnvironment,
      snapshot: {
        excludedPaths: profile.excludedPaths,
        optionalScopePaths: profile.generatedScopePaths.map(
          (scope) => scope.path,
        ),
        scopePaths:
          ModuleExpertIsolation.moduleExpertSnapshotPaths(snapshotRequest),
        contextFiles: [],
      },
      sourceCommit: request.sourceCommit,
      workingDirectory: request.workingDirectory,
      ...(request.temporaryRoot
        ? { temporaryRoot: request.temporaryRoot }
        : {}),
    };
    const isolation =
      await ModuleExpertIsolation.createReadOnlyExpertRuntimeIsolation(
        sharedRequest,
      );
    if (isolation.isErr()) return err(isolation.error);
    return ok(
      ModuleExpertRuntimeIsolation.admit({
        key: ISOLATION_TRANSITION,
        isolation: isolation.value,
        selectedContextPaths,
      }),
    );
  }

  static async createReadOnlyExpertRuntimeIsolation(
    request: ReadOnlyExpertRuntimeIsolationRequest,
  ): Promise<Result<ReadOnlyExpertRuntimeIsolation, ExpertIsolationFailure>> {
    const source = ModuleExpertIsolation.assertSourceCommit(
      request.sourceCommit,
    );
    if (source.isErr()) return err(source.error);
    const [temporaryRoot = tmpdir()] = [request.temporaryRoot];
    let codexHome;
    try {
      codexHome = mkdtempSync(
        join(temporaryRoot, ModuleExpertIsolation.ISOLATED_CODEX_HOME_PREFIX),
      );
    } catch {
      return err({
        kind: ExpertIsolationFailureKind.Storage,
        message: 'Expert isolation directory could not be created.',
      });
    }
    let setup = IsolationSetup.Pending;
    let authenticationBroker: ModuleExpertAuthenticationBroker | false = false;
    let contextServer: ModuleExpertReadContextServer | false = false;
    try {
      const processEnvironment = ModuleExpertIsolation.allowlistedEnvironment(
        request.parentEnvironment,
      );
      const credentialResult = ModuleExpertIsolation.supportedEnvironmentAuth(
        request.parentEnvironment,
      );
      if (credentialResult.isErr()) return err(credentialResult.error);
      const credential = credentialResult.value;
      const repositorySnapshotRequest: RepositorySnapshotRequest = {
        codexHome,
        environment: processEnvironment,
        sourceCommit: request.sourceCommit,
        excludedPaths: request.snapshot.excludedPaths,
        optionalScopePaths: request.snapshot.optionalScopePaths,
        scopePaths: request.snapshot.scopePaths,
        workingDirectory: request.workingDirectory,
      };
      const snapshot = new RepositorySnapshot(
        repositorySnapshotRequest,
      ).materialize();
      if (snapshot.isErr()) return err(snapshot.error);
      const repositorySnapshot = snapshot.value;
      const contextWriteRequest: SnapshotContextFilesRequest = {
        contextFiles: request.snapshot.contextFiles,
        repositorySnapshot,
      };
      const written = new SnapshotContextFiles(
        contextWriteRequest,
      ).materialize();
      if (written.isErr()) return err(written.error);
      const isolatedWorkspace = join(
        codexHome,
        ModuleExpertIsolation.ISOLATED_WORKSPACE_NAME,
      );
      try {
        mkdirSync(isolatedWorkspace);
      } catch {
        return err({
          kind: ExpertIsolationFailureKind.Storage,
          message: 'Expert isolated workspace could not be created.',
        });
      }
      const authenticationBrokerRequest: ModuleExpertAuthenticationBrokerRequest =
        {
          codexHome,
          credential,
        };
      authenticationBroker = ModuleExpertIsolation.createAuthenticationBroker(
        authenticationBrokerRequest,
      );
      const contextServerRequest = { repositoryRoot: repositorySnapshot };
      contextServer =
        ModuleExpertRepositoryContext.createModuleExpertReadContextServer(
          contextServerRequest,
        );
      processEnvironment.CODEX_HOME = codexHome;
      const codexOptionsRequest: ModuleExpertCodexOptionsRequest = {
        authenticationCommandArgs: authenticationBroker.commandArgs,
        contextServerUrl: contextServer.url,
        processEnvironment,
      };
      const codexOptions =
        ModuleExpertIsolation.buildModuleExpertCodexOptions(
          codexOptionsRequest,
        );
      const isolatedThreadOptionsRequest: ModuleExpertThreadOptionsArgs = {
        workingDirectory: isolatedWorkspace,
      };
      const threadOptions =
        ModuleExpertIsolation.moduleExpertIsolatedThreadOptions(
          isolatedThreadOptionsRequest,
        );
      const admitted = ReadOnlyExpertRuntimeIsolation.admit({
        key: ISOLATION_TRANSITION,
        resources: {
          codexHome,
          codexOptions,
          repositorySnapshot,
          threadOptions,
          dispose: async () => {
            try {
              if (authenticationBroker) authenticationBroker.dispose();
            } finally {
              try {
                if (contextServer) await contextServer.dispose();
              } finally {
                const removeOptions: RmOptions = {
                  recursive: true,
                  force: true,
                };
                rmSync(codexHome, removeOptions);
              }
            }
          },
        },
      });
      setup = IsolationSetup.Admitted;
      return ok(admitted);
    } finally {
      if (setup === IsolationSetup.Pending) {
        try {
          if (authenticationBroker) authenticationBroker.dispose();
        } catch {
          // Preserve the setup failure while continuing fail-safe cleanup.
        } finally {
          try {
            if (contextServer) await contextServer.dispose();
          } finally {
            try {
              rmSync(codexHome, { recursive: true, force: true });
            } catch {
              return err({
                kind: ExpertIsolationFailureKind.Storage,
                message: 'Expert isolation directory could not be removed.',
              });
            }
          }
        }
      }
    }
  }

  static async withModuleExpertRuntimeIsolation<TResult, TFailure>(
    use: ModuleExpertRuntimeIsolationUse<TResult, TFailure>,
  ): Promise<Result<TResult, TFailure | ExpertIsolationFailure>> {
    const isolation =
      await ModuleExpertIsolation.createModuleExpertRuntimeIsolation(
        use.isolationRequest,
      );
    if (isolation.isErr()) return err(isolation.error);
    try {
      return await use.run(isolation.value);
    } finally {
      await isolation.value.dispose();
    }
  }

  static moduleExpertThreadOptions(
    args: ModuleExpertThreadOptionsArgs,
  ): ThreadOptions {
    return {
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      sandboxMode: 'read-only',
      webSearchMode: 'disabled',
      workingDirectory: args.workingDirectory,
    };
  }

  static moduleExpertIsolatedThreadOptions(
    args: ModuleExpertThreadOptionsArgs,
  ): ThreadOptions {
    return {
      ...ModuleExpertIsolation.moduleExpertThreadOptions(args),
      skipGitRepoCheck: true,
    };
  }

  static buildModuleExpertCodexOptions(
    request: ModuleExpertCodexOptionsRequest,
  ) {
    const provider =
      MODULE_EXPERT_CODEX_OPTIONS.config.model_providers[
        MODULE_EXPERT_AUTH_PROVIDER
      ];
    return {
      config: {
        ...MODULE_EXPERT_CODEX_OPTIONS.config,
        model_providers: {
          [MODULE_EXPERT_AUTH_PROVIDER]: {
            ...provider,
            auth: {
              ...provider.auth,
              args: [...request.authenticationCommandArgs],
            },
          },
        },
        mcp_servers: {
          [MODULE_EXPERT_CONTEXT_MCP]: {
            default_tools_approval_mode: 'approve',
            enabled: true,
            enabled_tools: [...MODULE_EXPERT_READ_CONTEXT_TOOLS],
            required: true,
            startup_timeout_sec: 5,
            tool_timeout_sec: 10,
            url: request.contextServerUrl,
          },
        },
        shell_environment_policy: {
          ...MODULE_EXPERT_CODEX_OPTIONS.config.shell_environment_policy,
          set: ModuleExpertIsolation.allowlistedEnvironment(
            request.processEnvironment,
          ),
        },
      },
      env: request.processEnvironment,
    } satisfies CodexOptions;
  }

  private static allowlistedEnvironment(
    parentEnvironment: NodeJS.ProcessEnv,
  ): NonNullable<CodexOptions['env']> {
    const environment: NonNullable<CodexOptions['env']> = {};
    for (const key of MODULE_EXPERT_PROCESS_ENVIRONMENT_KEYS) {
      const value = parentEnvironment[key];
      if (typeof value === 'string') environment[key] = value;
    }
    return environment;
  }

  private static supportedEnvironmentAuth(
    parentEnvironment: NodeJS.ProcessEnv,
  ): Result<string, ExpertIsolationFailure> {
    const credential = parentEnvironment.CODEX_API_KEY?.trim();
    if (credential) return ok(credential);
    return err({
      kind: ExpertIsolationFailureKind.Authentication,
      message: 'Module expert runtime requires CODEX_API_KEY authentication.',
    });
  }

  private static createAuthenticationBroker(
    request: ModuleExpertAuthenticationBrokerRequest,
  ): ModuleExpertAuthenticationBroker {
    const socketPath = join(
      request.codexHome,
      ModuleExpertIsolation.AUTH_BROKER_SOCKET_NAME,
    );
    const state: AuthenticationBrokerState = {
      credential: Buffer.from(request.credential, 'utf8'),
      nonce: randomBytes(32).toString('hex'),
      requests: new Map(),
    };
    const listenerOptions: Bun.UnixSocketOptions<AuthenticationBrokerState> = {
      data: state,
      unix: socketPath,
      socket: {
        binaryType: 'buffer',
        data: (...parameters: AuthenticationBrokerSocketData) => {
          const [socket, data] = parameters;
          const redemption: AuthenticationCredentialRedemption = {
            data,
            socket,
          };
          ModuleExpertIsolation.redeemAuthenticationCredential(redemption);
        },
        close: (socket) => {
          state.requests.delete(socket);
        },
        error: (socket) => {
          state.requests.delete(socket);
          socket.close();
        },
      },
    };
    const listener = Bun.listen(listenerOptions);
    return ModuleExpertAuthenticationBroker.admit({
      key: ISOLATION_TRANSITION,
      resources: {
        commandArgs: [
          '-e',
          MODULE_EXPERT_AUTH_BROKER_CLIENT_SOURCE,
          '--',
          socketPath,
          state.nonce,
        ],
        dispose: () => {
          if (state.credential) state.credential.fill(0);
          state.credential = false;
          state.requests.clear();
          listener.stop(true);
          const removeOptions: RmOptions = { force: true };
          rmSync(socketPath, removeOptions);
        },
      },
    });
  }

  private static redeemAuthenticationCredential(
    redemption: AuthenticationCredentialRedemption,
  ): void {
    const state = redemption.socket.data;
    const [previous = Buffer.alloc(0)] = [
      state.requests.get(redemption.socket),
    ];
    const request = Buffer.concat([previous, redemption.data]);
    if (request.byteLength > 128) {
      state.requests.delete(redemption.socket);
      redemption.socket.close();
      return;
    }
    const delimiter = request.indexOf(10);
    if (delimiter < 0) {
      state.requests.set(redemption.socket, request);
      return;
    }
    state.requests.delete(redemption.socket);
    const requestNonce = request.subarray(0, delimiter);
    const expectedNonce = Buffer.from(state.nonce, 'utf8');
    const validNonce =
      requestNonce.byteLength === expectedNonce.byteLength &&
      timingSafeEqual(requestNonce, expectedNonce);
    if (
      !state.credential ||
      !validNonce ||
      delimiter !== request.byteLength - 1
    ) {
      redemption.socket.close();
      return;
    }
    const credential = state.credential;
    state.credential = false;
    const response = Buffer.alloc(credential.byteLength + 1);
    credential.copy(response);
    response[response.byteLength - 1] = 10;
    credential.fill(0);
    redemption.socket.end(response);
  }

  private static assertSourceCommit(
    sourceCommit: string,
  ): Result<void, ExpertIsolationFailure> {
    if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
      return err({
        kind: ExpertIsolationFailureKind.SourceCommit,
        message: 'Module expert source commit must be a full Git SHA.',
      });
    }
    return ok();
  }

  private static moduleExpertProfile(
    expertName: string,
  ): Result<ModuleExpertProfile, ExpertIsolationFailure> {
    const profile = MODULE_EXPERT_CATALOG.find(
      (candidate) => candidate.name === expertName,
    );
    if (!profile)
      return err({
        kind: ExpertIsolationFailureKind.Profile,
        message: 'Module expert runtime requires a registered expert.',
      });
    return ok(profile);
  }

  private static moduleExpertSnapshotPaths(
    request: ModuleExpertSnapshotPathsRequest,
  ): readonly string[] {
    const generatedProducerPaths = request.profile.generatedScopePaths.map(
      (scope) => scope.producerPath,
    );
    return [
      ...new Set([
        '.cortex/knowledge-graph.md',
        ...request.profile.boundaryScopePaths,
        ...request.profile.canonicalContextPaths,
        ...request.profile.moduleRoots,
        ...request.profile.scopePaths,
        ...request.selectedContextPaths,
        ...generatedProducerPaths,
        ...request.profile.publicEntryPoints,
        ...request.profile.authorityPaths,
        ...request.profile.skillPaths,
      ]),
    ];
  }
}

export const MODULE_EXPERT_AUTH_BROKER_CLIENT_SOURCE = [
  'const socketPath = process.argv[1];',
  'const nonce = process.argv[2];',
  'if (!socketPath || !nonce) process.exit(1);',
  "let credential = '';",
  'const socketOptions = {',
  '  unix: socketPath,',
  '  socket: {',
  "    binaryType: 'buffer',",
  '    data: (socket, data) => {',
  "      credential += data.toString('utf8');",
  '      if (credential.length > 16384) {',
  "        credential = '';",
  '        socket.close();',
  '        process.exitCode = 1;',
  '      }',
  '    },',
  '    end: () => {',
  '      const normalizedCredential = credential.trim();',
  "      credential = '';",
  '      if (!normalizedCredential) {',
  '        process.exitCode = 1;',
  '        return;',
  '      }',
  '      process.stdout.write(`${normalizedCredential}\\n`);',
  '    },',
  '    error: () => {',
  "      credential = '';",
  '      process.exitCode = 1;',
  '    },',
  '    open: (socket) => {',
  '      socket.write(`${nonce}\\n`);',
  '    },',
  '  },',
  '};',
  'try {',
  '  await Bun.connect(socketOptions);',
  '} catch {',
  "  credential = '';",
  '  process.exitCode = 1;',
  '}',
].join('\n');

export const MODULE_EXPERT_AUTH_PROVIDER = 'nook_module_expert';
export const MODULE_EXPERT_CONTEXT_MCP = 'nook_module_context';
export const MODULE_EXPERT_AUTH_ENVIRONMENT_KEYS = ['CODEX_API_KEY'] as const;
export const MODULE_EXPERT_PROCESS_ENVIRONMENT_KEYS = [
  'COMSPEC',
  'PATH',
  'Path',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
] as const;

export const MODULE_EXPERT_CODEX_OPTIONS = {
  config: {
    allow_login_shell: false,
    cli_auth_credentials_store: 'file',
    model_provider: MODULE_EXPERT_AUTH_PROVIDER,
    model_providers: {
      [MODULE_EXPERT_AUTH_PROVIDER]: {
        name: 'Nook module expert OpenAI provider',
        base_url: 'https://api.openai.com/v1',
        wire_api: 'responses',
        auth: {
          command: process.execPath,
          args: ['-e', MODULE_EXPERT_AUTH_BROKER_CLIENT_SOURCE, '--'],
          refresh_interval_ms: 0,
          timeout_ms: 5_000,
        },
      },
    },
    agents: {
      enabled: false,
      max_depth: 0,
    },
    features: {
      apps: false,
      code_mode: { enabled: false },
      goals: false,
      hooks: false,
      memories: false,
      multi_agent: false,
      multi_agent_v2: false,
      network_proxy: false,
      plugins: false,
      shell_snapshot: false,
      shell_tool: false,
      skill_mcp_dependency_install: false,
      unified_exec: false,
      view_image: false,
    },
    shell_environment_policy: {
      ignore_default_excludes: false,
      inherit: 'none',
    },
    tools: {
      view_image: false,
      web_search: false,
    },
    web_search: 'disabled',
  },
} as const satisfies CodexOptions;

export type ModuleExpertRuntimeIsolationRequest = {
  readonly expertName: string;
  readonly parentEnvironment: NodeJS.ProcessEnv;
  readonly sourceCommit: string;
  readonly selectedContextPaths: readonly string[];
  readonly temporaryRoot?: string;
  readonly workingDirectory: string;
};

export type ReadOnlyExpertContextFile = {
  readonly path: string;
  readonly content: string;
};

export type ReadOnlyExpertSnapshot = {
  readonly excludedPaths: readonly string[];
  readonly optionalScopePaths: readonly string[];
  readonly scopePaths: readonly string[];
  readonly contextFiles: readonly ReadOnlyExpertContextFile[];
};

export type ReadOnlyExpertRuntimeIsolationRequest = {
  readonly expertName: string;
  readonly parentEnvironment: NodeJS.ProcessEnv;
  readonly snapshot: ReadOnlyExpertSnapshot;
  readonly sourceCommit: string;
  readonly temporaryRoot?: string;
  readonly workingDirectory: string;
};

type ReadOnlyIsolationResources = {
  readonly codexHome: string;
  readonly codexOptions: ModuleExpertCodexOptions;
  readonly repositorySnapshot: string;
  readonly threadOptions: ThreadOptions;
  readonly dispose: () => Promise<void>;
};

export type ModuleExpertRuntimeIsolationUse<
  TResult,
  TFailure = ExpertIsolationFailure,
> = {
  readonly isolationRequest: ModuleExpertRuntimeIsolationRequest;
  readonly run: (
    isolation: ModuleExpertRuntimeIsolation,
  ) => Promise<Result<TResult, TFailure>>;
};

type AuthenticationBrokerResources = {
  readonly commandArgs: readonly string[];
  readonly dispose: () => void;
};

type ModuleExpertAuthenticationBrokerRequest = {
  readonly codexHome: string;
  readonly credential: string;
};

type AuthenticationBrokerState = {
  credential: Buffer | false;
  readonly nonce: string;
  readonly requests: Map<Bun.Socket<AuthenticationBrokerState>, Buffer>;
};

type AuthenticationBrokerSocketData = [
  Bun.Socket<AuthenticationBrokerState>,
  Buffer,
];

export type ModuleExpertCodexOptionsRequest = {
  readonly authenticationCommandArgs: readonly string[];
  readonly contextServerUrl: string;
  readonly processEnvironment: NonNullable<CodexOptions['env']>;
};

export type ModuleExpertCodexOptions = ReturnType<
  typeof ModuleExpertIsolation.buildModuleExpertCodexOptions
>;

export type ModuleExpertThreadOptionsArgs = {
  readonly workingDirectory: string;
};

type AuthenticationCredentialRedemption = {
  readonly data: Buffer;
  readonly socket: Bun.Socket<AuthenticationBrokerState>;
};

type ModuleExpertSnapshotPathsRequest = {
  readonly profile: ModuleExpertProfile;
  readonly selectedContextPaths: readonly string[];
};

enum IsolationSetup {
  Pending = 'pending',
  Admitted = 'admitted',
}

const ISOLATION_TRANSITION = Symbol('expert-isolation-transition');
enum IsolationLifetime {
  Live = 'live',
  Releasing = 'releasing',
  Released = 'released',
}
type IsolationRelease =
  | { readonly phase: IsolationLifetime.Live }
  | {
      readonly phase: IsolationLifetime.Releasing | IsolationLifetime.Released;
      readonly completion: Promise<void>;
    };
type AdmitReadOnlyIsolation = {
  readonly key: typeof ISOLATION_TRANSITION;
  readonly resources: ReadOnlyIsolationResources;
};
/** Only the successful setup transition can issue live SDK configuration. */
export class ReadOnlyExpertRuntimeIsolation {
  private lifetime: IsolationRelease = { phase: IsolationLifetime.Live };
  private constructor(private readonly resources: ReadOnlyIsolationResources) {}
  static admit(
    request: AdmitReadOnlyIsolation,
  ): ReadOnlyExpertRuntimeIsolation {
    if (request.key !== ISOLATION_TRANSITION)
      throw new Error('Invalid isolation transition.');
    return new ReadOnlyExpertRuntimeIsolation(request.resources);
  }
  private assertLive(): void {
    if (this.lifetime.phase !== IsolationLifetime.Live)
      throw new Error('Expert isolation has been disposed.');
  }
  get codexHome(): string {
    this.assertLive();
    return this.resources.codexHome;
  }
  get codexOptions(): ModuleExpertCodexOptions {
    this.assertLive();
    return this.resources.codexOptions;
  }
  get repositorySnapshot(): string {
    this.assertLive();
    return this.resources.repositorySnapshot;
  }
  get threadOptions(): ThreadOptions {
    this.assertLive();
    return this.resources.threadOptions;
  }
  dispose(): Promise<void> {
    if (this.lifetime.phase !== IsolationLifetime.Live)
      return this.lifetime.completion;
    const completion = Promise.resolve()
      .then(() => this.resources.dispose())
      .finally(() => {
        this.lifetime = { phase: IsolationLifetime.Released, completion };
      });
    this.lifetime = { phase: IsolationLifetime.Releasing, completion };
    return completion;
  }
}
type AdmitModuleIsolation = {
  readonly key: typeof ISOLATION_TRANSITION;
  readonly isolation: ReadOnlyExpertRuntimeIsolation;
  readonly selectedContextPaths: readonly string[];
};
export class ModuleExpertRuntimeIsolation {
  private constructor(private readonly admitted: AdmitModuleIsolation) {}
  static admit(request: AdmitModuleIsolation): ModuleExpertRuntimeIsolation {
    if (request.key !== ISOLATION_TRANSITION)
      throw new Error('Invalid module isolation transition.');
    return new ModuleExpertRuntimeIsolation(request);
  }
  get selectedContextPaths(): readonly string[] {
    return this.admitted.selectedContextPaths;
  }
  get codexHome(): string {
    return this.admitted.isolation.codexHome;
  }
  get codexOptions(): ModuleExpertCodexOptions {
    return this.admitted.isolation.codexOptions;
  }
  get repositorySnapshot(): string {
    return this.admitted.isolation.repositorySnapshot;
  }
  get threadOptions(): ThreadOptions {
    return this.admitted.isolation.threadOptions;
  }
  dispose(): Promise<void> {
    return this.admitted.isolation.dispose();
  }
}
type AdmitAuthenticationBroker = {
  readonly key: typeof ISOLATION_TRANSITION;
  readonly resources: AuthenticationBrokerResources;
};
class ModuleExpertAuthenticationBroker {
  private phase = IsolationLifetime.Live;
  private constructor(
    private readonly resources: AuthenticationBrokerResources,
  ) {}
  static admit(
    request: AdmitAuthenticationBroker,
  ): ModuleExpertAuthenticationBroker {
    if (request.key !== ISOLATION_TRANSITION)
      throw new Error('Invalid authentication broker transition.');
    return new ModuleExpertAuthenticationBroker(request.resources);
  }
  get commandArgs(): readonly string[] {
    if (this.phase !== IsolationLifetime.Live)
      throw new Error('Authentication broker has been disposed.');
    return this.resources.commandArgs;
  }
  dispose(): void {
    if (this.phase !== IsolationLifetime.Live) return;
    this.phase = IsolationLifetime.Released;
    this.resources.dispose();
  }
}
