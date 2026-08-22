import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';

export const MODULE_EXPERT_CODEX_OPTIONS = {
  config: {
    agents: {
      enabled: false,
      max_depth: 0,
    },
    features: {
      apps: false,
      multi_agent: false,
      multi_agent_v2: false,
      plugins: false,
    },
  },
} as const satisfies CodexOptions;

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
