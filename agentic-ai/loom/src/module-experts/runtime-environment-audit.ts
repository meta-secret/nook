import type { CodexOptions } from '@openai/codex-sdk';

type CodexConfigEntry = NonNullable<CodexOptions['config']>[string];

export type ValidateModuleExpertRuntimeEnvironmentArgs = {
  readonly actualProcessEnvironment: CodexOptions['env'];
  readonly actualShellEnvironment: CodexConfigEntry | false;
  readonly allowedShellKeys: readonly string[];
  readonly safeCodexEnvironment: Readonly<Record<string, string>>;
  readonly safeShellEnvironment: Readonly<Record<string, string>>;
};

type ExactEnvironmentMapValidation = {
  readonly actual: Readonly<Record<string, CodexConfigEntry>>;
  readonly expected: Readonly<Record<string, string>>;
};

export function validModuleExpertRuntimeEnvironment(
  args: ValidateModuleExpertRuntimeEnvironmentArgs,
): boolean {
  const actualShellEnvironment = environmentRecord(args.actualShellEnvironment);
  if (!args.actualProcessEnvironment || !actualShellEnvironment) return false;
  const codexMapValidation: ExactEnvironmentMapValidation = {
    actual: args.actualProcessEnvironment,
    expected: args.safeCodexEnvironment,
  };
  const shellMapValidation: ExactEnvironmentMapValidation = {
    actual: actualShellEnvironment,
    expected: args.safeShellEnvironment,
  };
  const allowedCodexKeys = ['CODEX_HOME', ...args.allowedShellKeys];
  return (
    Object.keys(args.safeCodexEnvironment).every((key) =>
      allowedCodexKeys.includes(key),
    ) &&
    Object.keys(args.safeShellEnvironment).every((key) =>
      args.allowedShellKeys.includes(key),
    ) &&
    exactEnvironmentMap(codexMapValidation) &&
    exactEnvironmentMap(shellMapValidation)
  );
}

function environmentRecord(
  value: CodexConfigEntry | false,
): Readonly<Record<string, CodexConfigEntry>> | false {
  if (typeof value !== 'object' || !value || Array.isArray(value)) return false;
  return value;
}

function exactEnvironmentMap(args: ExactEnvironmentMapValidation): boolean {
  const expectedKeys = Object.keys(args.expected).sort();
  const actualKeys = Object.keys(args.actual).sort();
  return (
    JSON.stringify(actualKeys) === JSON.stringify(expectedKeys) &&
    expectedKeys.every(
      (key) =>
        typeof args.actual[key] === 'string' &&
        args.actual[key] === args.expected[key],
    )
  );
}
