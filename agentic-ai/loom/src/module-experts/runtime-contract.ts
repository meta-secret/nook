import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';
import { MODULE_EXPERT_CATALOG } from './catalog.ts';
import type { ModuleExpertProfile } from './catalog.ts';
import {
  MODULE_EXPERT_READ_CONTEXT_TOOLS,
  createModuleExpertReadContextServer,
} from './read-context-mcp.ts';
import type { ModuleExpertReadContextServer } from './read-context-mcp.ts';

const ISOLATED_CODEX_HOME_PREFIX = 'nook-module-expert-codex-';
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
const AUTH_BROKER_SOCKET_NAME = 'authentication.sock';
const REPOSITORY_ARCHIVE_NAME = 'repository.tar';
const REPOSITORY_SNAPSHOT_NAME = 'repository';
const ISOLATED_WORKSPACE_NAME = 'workspace';
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

export type ModuleExpertRuntimeIsolation = {
  readonly codexHome: string;
  readonly codexOptions: ModuleExpertCodexOptions;
  readonly repositorySnapshot: string;
  readonly threadOptions: ThreadOptions;
  readonly dispose: () => Promise<void>;
};

export type ModuleExpertRuntimeIsolationUse<TResult> = {
  readonly isolationRequest: ModuleExpertRuntimeIsolationRequest;
  readonly run: (isolation: ModuleExpertRuntimeIsolation) => Promise<TResult>;
};

type ModuleExpertAuthenticationBroker = {
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
  typeof buildModuleExpertCodexOptions
>;

export async function createModuleExpertRuntimeIsolation(
  request: ModuleExpertRuntimeIsolationRequest,
): Promise<ModuleExpertRuntimeIsolation> {
  const profile = moduleExpertProfile(request.expertName);
  const sharedRequest: ReadOnlyExpertRuntimeIsolationRequest = {
    expertName: request.expertName,
    parentEnvironment: request.parentEnvironment,
    snapshot: {
      excludedPaths: profile.excludedPaths,
      optionalScopePaths: profile.generatedScopePaths.map(
        (scope) => scope.path,
      ),
      scopePaths: moduleExpertSnapshotPaths(profile),
      contextFiles: [],
    },
    sourceCommit: request.sourceCommit,
    workingDirectory: request.workingDirectory,
    ...(request.temporaryRoot ? { temporaryRoot: request.temporaryRoot } : {}),
  };
  return createReadOnlyExpertRuntimeIsolation(sharedRequest);
}

export async function createReadOnlyExpertRuntimeIsolation(
  request: ReadOnlyExpertRuntimeIsolationRequest,
): Promise<ModuleExpertRuntimeIsolation> {
  assertSourceCommit(request.sourceCommit);
  const temporaryRoot = request.temporaryRoot ?? tmpdir();
  const codexHome = mkdtempSync(
    join(temporaryRoot, ISOLATED_CODEX_HOME_PREFIX),
  );
  let authenticationBroker: ModuleExpertAuthenticationBroker | false = false;
  let contextServer: ModuleExpertReadContextServer | false = false;
  try {
    const processEnvironment = allowlistedEnvironment(
      request.parentEnvironment,
    );
    const credential = supportedEnvironmentAuth(request.parentEnvironment);
    const repositorySnapshotRequest: RepositorySnapshotRequest = {
      codexHome,
      environment: processEnvironment,
      sourceCommit: request.sourceCommit,
      excludedPaths: request.snapshot.excludedPaths,
      optionalScopePaths: request.snapshot.optionalScopePaths,
      scopePaths: request.snapshot.scopePaths,
      workingDirectory: request.workingDirectory,
    };
    const contextOnlyRequest: MaterializeContextOnlySnapshotRequest = {
      codexHome,
    };
    const repositorySnapshot =
      request.snapshot.scopePaths.length > 0
        ? materializeRepositorySnapshot(repositorySnapshotRequest)
        : materializeContextOnlySnapshot(contextOnlyRequest);
    const contextWriteRequest: WriteReadOnlyExpertContextFilesRequest = {
      contextFiles: request.snapshot.contextFiles,
      repositorySnapshot,
    };
    writeReadOnlyExpertContextFiles(contextWriteRequest);
    const isolatedWorkspace = join(codexHome, ISOLATED_WORKSPACE_NAME);
    mkdirSync(isolatedWorkspace);
    const authenticationBrokerRequest: ModuleExpertAuthenticationBrokerRequest =
      {
        codexHome,
        credential,
      };
    authenticationBroker = createAuthenticationBroker(
      authenticationBrokerRequest,
    );
    const contextServerRequest = { repositoryRoot: repositorySnapshot };
    contextServer = createModuleExpertReadContextServer(contextServerRequest);
    processEnvironment.CODEX_HOME = codexHome;
    const codexOptionsRequest: ModuleExpertCodexOptionsRequest = {
      authenticationCommandArgs: authenticationBroker.commandArgs,
      contextServerUrl: contextServer.url,
      processEnvironment,
    };
    const codexOptions = buildModuleExpertCodexOptions(codexOptionsRequest);
    const isolatedThreadOptionsRequest: ModuleExpertThreadOptionsArgs = {
      workingDirectory: isolatedWorkspace,
    };
    const threadOptions = moduleExpertIsolatedThreadOptions(
      isolatedThreadOptionsRequest,
    );
    let disposed = false;
    return {
      codexHome,
      codexOptions,
      repositorySnapshot,
      threadOptions,
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        try {
          if (authenticationBroker) authenticationBroker.dispose();
        } finally {
          try {
            if (contextServer) await contextServer.dispose();
          } finally {
            const removeOptions: RmOptions = { recursive: true, force: true };
            rmSync(codexHome, removeOptions);
          }
        }
      },
    };
  } catch (error) {
    try {
      if (authenticationBroker) authenticationBroker.dispose();
    } catch {
      // Preserve the setup failure while continuing fail-safe cleanup.
    } finally {
      try {
        if (contextServer) await contextServer.dispose();
      } finally {
        const removeOptions: RmOptions = { recursive: true, force: true };
        rmSync(codexHome, removeOptions);
      }
    }
    throw error;
  }
}

export async function withModuleExpertRuntimeIsolation<TResult>(
  use: ModuleExpertRuntimeIsolationUse<TResult>,
): Promise<TResult> {
  const isolation = await createModuleExpertRuntimeIsolation(
    use.isolationRequest,
  );
  try {
    return await use.run(isolation);
  } finally {
    await isolation.dispose();
  }
}

export type ModuleExpertThreadOptionsArgs = {
  readonly workingDirectory: string;
};

export function moduleExpertThreadOptions(
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

export function moduleExpertIsolatedThreadOptions(
  args: ModuleExpertThreadOptionsArgs,
): ThreadOptions {
  return {
    ...moduleExpertThreadOptions(args),
    skipGitRepoCheck: true,
  };
}

export function buildModuleExpertCodexOptions(
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
        set: allowlistedEnvironment(request.processEnvironment),
      },
    },
    env: request.processEnvironment,
  } satisfies CodexOptions;
}

function allowlistedEnvironment(
  parentEnvironment: NodeJS.ProcessEnv,
): NonNullable<CodexOptions['env']> {
  const environment: NonNullable<CodexOptions['env']> = {};
  for (const key of MODULE_EXPERT_PROCESS_ENVIRONMENT_KEYS) {
    const value = parentEnvironment[key];
    if (typeof value === 'string') environment[key] = value;
  }
  return environment;
}

function supportedEnvironmentAuth(
  parentEnvironment: NodeJS.ProcessEnv,
): string {
  const credential = parentEnvironment.CODEX_API_KEY?.trim();
  if (credential) return credential;
  throw new Error(
    'Module expert runtime requires CODEX_API_KEY authentication.',
  );
}

function createAuthenticationBroker(
  request: ModuleExpertAuthenticationBrokerRequest,
): ModuleExpertAuthenticationBroker {
  const socketPath = join(request.codexHome, AUTH_BROKER_SOCKET_NAME);
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
        const redemption: AuthenticationCredentialRedemption = { data, socket };
        redeemAuthenticationCredential(redemption);
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
  let disposed = false;
  return {
    commandArgs: [
      '-e',
      MODULE_EXPERT_AUTH_BROKER_CLIENT_SOURCE,
      '--',
      socketPath,
      state.nonce,
    ],
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (state.credential) state.credential.fill(0);
      state.credential = false;
      state.requests.clear();
      listener.stop(true);
      const removeOptions: RmOptions = { force: true };
      rmSync(socketPath, removeOptions);
    },
  };
}

type AuthenticationCredentialRedemption = {
  readonly data: Buffer;
  readonly socket: Bun.Socket<AuthenticationBrokerState>;
};

function redeemAuthenticationCredential(
  redemption: AuthenticationCredentialRedemption,
): void {
  const state = redemption.socket.data;
  const previous = state.requests.get(redemption.socket) ?? Buffer.alloc(0);
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

type RepositorySnapshotRequest = {
  readonly codexHome: string;
  readonly environment: NonNullable<CodexOptions['env']>;
  readonly excludedPaths: readonly string[];
  readonly optionalScopePaths: readonly string[];
  readonly sourceCommit: string;
  readonly scopePaths: readonly string[];
  readonly workingDirectory: string;
};

type MaterializeContextOnlySnapshotRequest = {
  readonly codexHome: string;
};

function materializeContextOnlySnapshot(
  request: MaterializeContextOnlySnapshotRequest,
): string {
  const snapshotPath = join(request.codexHome, REPOSITORY_SNAPSHOT_NAME);
  mkdirSync(snapshotPath);
  return snapshotPath;
}

type WriteReadOnlyExpertContextFilesRequest = {
  readonly contextFiles: readonly ReadOnlyExpertContextFile[];
  readonly repositorySnapshot: string;
};

function writeReadOnlyExpertContextFiles(
  request: WriteReadOnlyExpertContextFilesRequest,
): void {
  let totalBytes = 0;
  for (const file of request.contextFiles) {
    totalBytes += Buffer.byteLength(file.content, 'utf8');
  }
  if (request.contextFiles.length > 64 || totalBytes > 1_048_576) {
    throw new Error('Read-only expert context files exceed their bounds.');
  }
  for (const file of request.contextFiles) {
    if (
      file.path === '' ||
      file.path.startsWith('/') ||
      file.path.includes('\\') ||
      file.path.includes('\u0000') ||
      file.path.split('/').includes('..') ||
      Buffer.byteLength(file.content, 'utf8') > 131_072
    ) {
      throw new Error('Read-only expert context file is unsafe.');
    }
    const target = join(request.repositorySnapshot, file.path);
    const directoryOptions = { recursive: true } as const;
    mkdirSync(join(target, '..'), directoryOptions);
    const writeOptions = { encoding: 'utf8', flag: 'wx' } as const;
    writeFileSync(target, file.content, writeOptions);
  }
}

function materializeRepositorySnapshot(
  request: RepositorySnapshotRequest,
): string {
  const archivePath = join(request.codexHome, REPOSITORY_ARCHIVE_NAME);
  const snapshotPath = join(request.codexHome, REPOSITORY_SNAPSHOT_NAME);
  mkdirSync(snapshotPath);
  const optionalScopePaths = trackedOptionalSnapshotPaths(request);
  const archiveArguments = [
    'archive',
    '--format=tar',
    `--output=${archivePath}`,
    request.sourceCommit,
    '--',
    ...request.scopePaths,
    ...optionalScopePaths,
  ];
  const archiveCommand: IsolatedCommandRequest = {
    args: archiveArguments,
    command: 'git',
    cwd: request.workingDirectory,
    environment: request.environment,
  };
  runIsolatedCommand(archiveCommand);
  const extractArguments = [
    '--extract',
    `--file=${archivePath}`,
    `--directory=${snapshotPath}`,
  ];
  const extractCommand: IsolatedCommandRequest = {
    args: extractArguments,
    command: 'tar',
    cwd: request.codexHome,
    environment: request.environment,
  };
  runIsolatedCommand(extractCommand);
  removeExcludedSnapshotPaths(request);
  const removeOptions: RmOptions = { force: true };
  rmSync(archivePath, removeOptions);
  return snapshotPath;
}

function trackedOptionalSnapshotPaths(
  request: RepositorySnapshotRequest,
): readonly string[] {
  if (request.optionalScopePaths.length === 0) return [];
  const treeCommand: IsolatedCommandRequest = {
    args: [
      'ls-tree',
      '--name-only',
      '-z',
      request.sourceCommit,
      '--',
      ...request.optionalScopePaths,
    ],
    command: 'git',
    cwd: request.workingDirectory,
    environment: request.environment,
  };
  const trackedPaths = captureIsolatedCommand(treeCommand)
    .split('\u0000')
    .filter((path) => path.length > 0);
  return [
    ...new Set(
      trackedPaths.filter((path) => request.optionalScopePaths.includes(path)),
    ),
  ];
}

function removeExcludedSnapshotPaths(request: RepositorySnapshotRequest): void {
  const snapshotPath = join(request.codexHome, REPOSITORY_SNAPSHOT_NAME);
  for (const excludedPath of request.excludedPaths) {
    if (
      excludedPath.includes('\u0000') ||
      excludedPath.includes('\\') ||
      excludedPath.startsWith('/') ||
      excludedPath.split('/').includes('..')
    ) {
      throw new Error('Module expert snapshot exclusion is unsafe.');
    }
    const absolutePath = join(snapshotPath, excludedPath);
    const removeOptions: RmOptions = { recursive: true, force: true };
    rmSync(absolutePath, removeOptions);
  }
}

type IsolatedCommandRequest = {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly environment: NonNullable<CodexOptions['env']>;
};

function runIsolatedCommand(request: IsolatedCommandRequest): void {
  captureIsolatedCommand(request);
}

function captureIsolatedCommand(request: IsolatedCommandRequest): string {
  const options: SpawnSyncOptionsWithStringEncoding = {
    cwd: request.cwd,
    encoding: 'utf8',
    env: request.environment,
  };
  const result = spawnSync(request.command, [...request.args], options);
  if (result.error || result.status !== 0) {
    throw new Error(
      'Module expert repository snapshot materialization failed.',
    );
  }
  return result.stdout;
}

function assertSourceCommit(sourceCommit: string): void {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error('Module expert source commit must be a full Git SHA.');
  }
}

function moduleExpertProfile(expertName: string): ModuleExpertProfile {
  const profile = MODULE_EXPERT_CATALOG.find(
    (candidate) => candidate.name === expertName,
  );
  if (!profile)
    throw new Error('Module expert runtime requires a registered expert.');
  return profile;
}

function moduleExpertSnapshotPaths(
  profile: ModuleExpertProfile,
): readonly string[] {
  const generatedProducerPaths = profile.generatedScopePaths.map(
    (scope) => scope.producerPath,
  );
  return [
    ...new Set([
      '.cortex/knowledge-graph.md',
      profile.agentDefinitionPath,
      ...profile.boundaryScopePaths,
      ...profile.canonicalContextPaths,
      ...profile.moduleRoots,
      ...profile.scopePaths,
      ...generatedProducerPaths,
      ...profile.publicEntryPoints,
      ...profile.authorityPaths,
      ...profile.skillPaths,
    ]),
  ];
}
