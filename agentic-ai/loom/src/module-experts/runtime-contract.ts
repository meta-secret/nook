import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import type { RmOptions } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';

const AUTH_FILE_NAME = 'auth.json';
const ISOLATED_CODEX_HOME_PREFIX = 'nook-module-expert-codex-';
export const MODULE_EXPERT_AUTH_ENVIRONMENT_KEYS = [
  'CODEX_API_KEY',
  'CODEX_ACCESS_TOKEN',
] as const;
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
    agents: {
      enabled: false,
      max_depth: 0,
    },
    features: {
      apps: false,
      multi_agent: false,
      multi_agent_v2: false,
      plugins: false,
      skill_mcp_dependency_install: false,
    },
    shell_environment_policy: {
      ignore_default_excludes: false,
      inherit: 'none',
    },
  },
} as const satisfies CodexOptions;

export type ModuleExpertRuntimeIsolationRequest = {
  readonly parentEnvironment: NodeJS.ProcessEnv;
  readonly temporaryRoot?: string;
};

export type ModuleExpertRuntimeIsolation = {
  readonly codexHome: string;
  readonly codexOptions: ModuleExpertCodexOptions;
  readonly dispose: () => void;
};

export type ModuleExpertCodexOptions = {
  readonly config: typeof MODULE_EXPERT_CODEX_OPTIONS.config & {
    readonly shell_environment_policy: (typeof MODULE_EXPERT_CODEX_OPTIONS.config)['shell_environment_policy'] & {
      readonly set: Readonly<Record<string, string>>;
    };
  };
  readonly env: NonNullable<CodexOptions['env']>;
};

export type ModuleExpertRuntimeIsolationUse<TResult> = {
  readonly isolationRequest: ModuleExpertRuntimeIsolationRequest;
  readonly run: (isolation: ModuleExpertRuntimeIsolation) => Promise<TResult>;
};

export function createModuleExpertRuntimeIsolation(
  request: ModuleExpertRuntimeIsolationRequest,
): ModuleExpertRuntimeIsolation {
  const temporaryRoot = request.temporaryRoot ?? tmpdir();
  const codexHome = mkdtempSync(
    join(temporaryRoot, ISOLATED_CODEX_HOME_PREFIX),
  );
  try {
    const environment = allowlistedEnvironment(request.parentEnvironment);
    const shellEnvironment = allowlistedEnvironment(request.parentEnvironment);
    const authenticationStage: ModuleExpertAuthenticationStage = {
      codexHome,
      environment,
      parentEnvironment: request.parentEnvironment,
    };
    stageAuthentication(authenticationStage);
    environment.CODEX_HOME = codexHome;
    const codexOptions: ModuleExpertCodexOptions = {
      config: {
        ...MODULE_EXPERT_CODEX_OPTIONS.config,
        shell_environment_policy: {
          ...MODULE_EXPERT_CODEX_OPTIONS.config.shell_environment_policy,
          set: shellEnvironment,
        },
      },
      env: environment,
    };
    let disposed = false;
    return {
      codexHome,
      codexOptions,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const removeOptions: RmOptions = { recursive: true, force: true };
        rmSync(codexHome, removeOptions);
      },
    };
  } catch (error) {
    const removeOptions: RmOptions = { recursive: true, force: true };
    rmSync(codexHome, removeOptions);
    throw error;
  }
}

export async function withModuleExpertRuntimeIsolation<TResult>(
  use: ModuleExpertRuntimeIsolationUse<TResult>,
): Promise<TResult> {
  const isolation = createModuleExpertRuntimeIsolation(use.isolationRequest);
  try {
    return await use.run(isolation);
  } finally {
    isolation.dispose();
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

type ModuleExpertAuthenticationStage = {
  readonly codexHome: string;
  readonly environment: NonNullable<CodexOptions['env']>;
  readonly parentEnvironment: NodeJS.ProcessEnv;
};

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

function stageAuthentication(stage: ModuleExpertAuthenticationStage): void {
  const sourceCodexHome =
    stage.parentEnvironment.CODEX_HOME ?? join(homedir(), '.codex');
  const sourceAuthPath = join(sourceCodexHome, AUTH_FILE_NAME);
  if (existsSync(sourceAuthPath)) {
    const isolatedAuthPath = join(stage.codexHome, AUTH_FILE_NAME);
    copyFileSync(sourceAuthPath, isolatedAuthPath);
    chmodSync(isolatedAuthPath, 0o600);
    return;
  }
  const environmentAuth = supportedEnvironmentAuth(stage.parentEnvironment);
  if (environmentAuth) {
    stage.environment[environmentAuth.key] = environmentAuth.value;
    return;
  }
  throw new Error(
    'Module expert runtime requires isolated CLI authentication material.',
  );
}

type SupportedEnvironmentAuth = {
  readonly key: (typeof MODULE_EXPERT_AUTH_ENVIRONMENT_KEYS)[number];
  readonly value: string;
};

function supportedEnvironmentAuth(
  parentEnvironment: NodeJS.ProcessEnv,
): SupportedEnvironmentAuth | false {
  for (const key of MODULE_EXPERT_AUTH_ENVIRONMENT_KEYS) {
    const value = parentEnvironment[key]?.trim();
    if (value) return { key, value };
  }
  return false;
}
