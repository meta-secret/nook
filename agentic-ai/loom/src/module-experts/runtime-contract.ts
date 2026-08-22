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
const AUTH_ENVIRONMENT_KEYS = [
  'CODEX_ACCESS_TOKEN',
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
] as const;

export const MODULE_EXPERT_CODEX_OPTIONS = {
  config: {
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
  },
} as const satisfies CodexOptions;

export type ModuleExpertRuntimeIsolationRequest = {
  readonly parentEnvironment: NodeJS.ProcessEnv;
  readonly temporaryRoot?: string;
};

export type ModuleExpertRuntimeIsolation = {
  readonly codexHome: string;
  readonly codexOptions: CodexOptions;
  readonly dispose: () => void;
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
    const environment = inheritedEnvironment(request.parentEnvironment);
    const authenticationStage: ModuleExpertAuthenticationStage = {
      codexHome,
      environment,
    };
    stageAuthentication(authenticationStage);
    environment.CODEX_HOME = codexHome;
    const codexOptions: CodexOptions = {
      ...MODULE_EXPERT_CODEX_OPTIONS,
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
};

function inheritedEnvironment(
  parentEnvironment: NodeJS.ProcessEnv,
): NonNullable<CodexOptions['env']> {
  const environment: NonNullable<CodexOptions['env']> = {};
  for (const [key, value] of Object.entries(parentEnvironment)) {
    if (typeof value === 'string') environment[key] = value;
  }
  return environment;
}

function stageAuthentication(stage: ModuleExpertAuthenticationStage): void {
  const sourceCodexHome =
    stage.environment.CODEX_HOME ?? join(homedir(), '.codex');
  const sourceAuthPath = join(sourceCodexHome, AUTH_FILE_NAME);
  if (existsSync(sourceAuthPath)) {
    const isolatedAuthPath = join(stage.codexHome, AUTH_FILE_NAME);
    copyFileSync(sourceAuthPath, isolatedAuthPath);
    chmodSync(isolatedAuthPath, 0o600);
    return;
  }
  const hasEnvironmentAuth = AUTH_ENVIRONMENT_KEYS.some(
    (key) => (stage.environment[key] ?? '').trim().length > 0,
  );
  if (!hasEnvironmentAuth) {
    throw new Error(
      'Module expert runtime requires isolated CLI authentication material.',
    );
  }
}
