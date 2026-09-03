import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {
  LoomFailureCode,
  loomFailureDetail,
  type LoomFailureDetailArgs,
} from '../loom-failure.ts';
import {
  asUntrustedYamlNode,
  isRecord,
  type UntrustedYamlNode,
} from './guards.ts';
import { runCommand, type CommandOutput, type RunCommandArgs } from './run.ts';

export enum ValeAlertSeverity {
  Error = 'error',
  Suggestion = 'suggestion',
  Warning = 'warning',
}

enum ValeAlertField {
  Action = 'Action',
  Check = 'Check',
  Description = 'Description',
  Line = 'Line',
  Link = 'Link',
  Match = 'Match',
  Message = 'Message',
  Severity = 'Severity',
  Span = 'Span',
}

enum ValeActionField {
  Name = 'Name',
  Params = 'Params',
}

export type ValeNativeAlert = {
  readonly check: string;
  readonly file: string;
  readonly line: number;
  readonly match: string;
  readonly message: string;
  readonly severity: ValeAlertSeverity;
};

export type ValeFilesResult = {
  readonly alerts: readonly ValeNativeAlert[];
};

export type RunValeFilesArgs = {
  readonly configPath: string;
  readonly files: readonly string[];
  readonly repoRoot: string;
};

type ParseValeFilesOutputArgs = {
  readonly files: readonly string[];
  readonly stdout: string;
};

type ValidateRepositoryFileArgs = {
  readonly file: string;
  readonly label: string;
  readonly repoRoot: string;
};

type IsInsideArgs = {
  readonly candidate: string;
  readonly repoRoot: string;
};

type ParseAlertArgs = {
  readonly file: string;
  readonly value: UntrustedYamlNode;
};

const VALE_ALERT_EXIT_CODE = 1;
const REQUIRED_VALE_VERSION = 'vale version 3.19.0';
const JSON_NULL = JSON.parse('null') as UntrustedYamlNode;

export function runValeFiles(args: RunValeFilesArgs): ValeFilesResult {
  validateRequest(args);
  const versionArgs: RunCommandArgs = {
    command: 'vale',
    args: ['--version'],
    cwd: args.repoRoot,
  };
  const version = runCommand(versionArgs);
  if (!isRequiredValeVersion(version)) {
    fail('Vale 3.19.0 is required for exact-file linting.');
  }
  const commandArgs: RunCommandArgs = {
    command: 'vale',
    args: [
      '--no-global',
      `--config=${args.configPath}`,
      '--output=JSON',
      ...args.files,
    ],
    cwd: args.repoRoot,
  };
  const output = runCommand(commandArgs);
  if (output.signaled) {
    fail('Vale exact-file lint terminated from a signal.');
  }
  if (output.stderr.length > 0) {
    fail(`Vale exact-file lint wrote to stderr: ${output.stderr}`);
  }
  if (output.exitCode !== 0 && output.exitCode !== VALE_ALERT_EXIT_CODE) {
    fail(`Vale exact-file lint failed with exit code ${output.exitCode}.`);
  }
  const result = parseValeFilesOutput({
    files: args.files,
    stdout: output.stdout,
  });
  const expectedExitCode = result.alerts.length > 0 ? VALE_ALERT_EXIT_CODE : 0;
  if (output.exitCode !== expectedExitCode) {
    fail('Vale exact-file lint exit code did not match its native alerts.');
  }
  return result;
}

export function isRequiredValeVersion(output: CommandOutput): boolean {
  return (
    !output.signaled &&
    output.exitCode === 0 &&
    output.stderr.length === 0 &&
    output.stdout.trim() === REQUIRED_VALE_VERSION
  );
}

export function parseValeFilesOutput(
  args: ParseValeFilesOutputArgs,
): ValeFilesResult {
  let parsed: UntrustedYamlNode;
  try {
    parsed = asUntrustedYamlNode(JSON.parse(args.stdout) as UntrustedYamlNode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`Vale exact-file lint returned invalid JSON: ${message}`);
  }
  if (!isRecord(parsed)) {
    fail('Vale exact-file lint JSON must be an object.');
  }
  const admittedFiles = new Set(args.files);
  const alerts: ValeNativeAlert[] = [];
  for (const [file, untrustedAlerts] of Object.entries(parsed)) {
    if (!admittedFiles.has(file)) {
      fail(`Vale exact-file lint returned an unexpected file: ${file}`);
    }
    if (!Array.isArray(untrustedAlerts)) {
      fail(`Vale exact-file lint alerts must be an array: ${file}`);
    }
    for (const untrustedAlert of untrustedAlerts) {
      const alertArgs: ParseAlertArgs = { file, value: untrustedAlert };
      alerts.push(parseAlert(alertArgs));
    }
  }
  return { alerts };
}

function validateRequest(args: RunValeFilesArgs): void {
  validateRepositoryFile({
    file: args.configPath,
    label: 'Vale config',
    repoRoot: args.repoRoot,
  });
  if (args.files.length === 0) {
    fail('Vale exact-file lint requires at least one Markdown file.');
  }
  const files = new Set<string>();
  for (const file of args.files) {
    validateRepositoryFile({
      file,
      label: 'Vale Markdown input',
      repoRoot: args.repoRoot,
    });
    if (path.extname(file) !== '.md') {
      fail(`Vale exact-file lint input must end in .md: ${file}`);
    }
    if (files.has(file)) {
      fail(`Vale exact-file lint input is duplicated: ${file}`);
    }
    files.add(file);
  }
}

function validateRepositoryFile(args: ValidateRepositoryFileArgs): void {
  const { file, label, repoRoot } = args;
  if (!path.isAbsolute(repoRoot) || !path.isAbsolute(file)) {
    fail(`${label} and repository root must be absolute paths.`);
  }
  let realRepoRoot: string;
  let realFile: string;
  try {
    realRepoRoot = realpathSync(repoRoot);
    realFile = realpathSync(file);
  } catch {
    fail(`${label} must resolve to a regular repository file: ${file}`);
  }
  const insideArgs: IsInsideArgs = {
    candidate: realFile,
    repoRoot: realRepoRoot,
  };
  if (
    path.normalize(file) !== file ||
    realRepoRoot !== repoRoot ||
    realFile !== file ||
    !isInside(insideArgs)
  ) {
    fail(`${label} must be a canonical path inside the repository: ${file}`);
  }
  try {
    const metadata = lstatSync(file);
    if (metadata.isFile() && !metadata.isSymbolicLink()) return;
  } catch {
    // The bounded failure below owns missing and unreadable paths.
  }
  fail(`${label} must be a regular file: ${file}`);
}

function isInside(args: IsInsideArgs): boolean {
  const relative = path.relative(args.repoRoot, args.candidate);
  return (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function parseAlert(args: ParseAlertArgs): ValeNativeAlert {
  if (!isRecord(args.value)) {
    fail(`Vale exact-file lint alert must be an object: ${args.file}`);
  }
  requireExactFields({
    actual: Object.keys(args.value),
    expected: Object.values(ValeAlertField),
    label: 'alert',
  });
  const action = args.value[ValeAlertField.Action] as UntrustedYamlNode;
  const span = args.value[ValeAlertField.Span] as UntrustedYamlNode;
  if (!isRecord(action)) {
    fail(`Vale exact-file lint alert Action is invalid: ${args.file}`);
  }
  requireExactFields({
    actual: Object.keys(action),
    expected: Object.values(ValeActionField),
    label: 'alert Action',
  });
  if (
    typeof action[ValeActionField.Name] !== 'string' ||
    action[ValeActionField.Params] !== JSON_NULL
  ) {
    fail(`Vale exact-file lint alert Action shape is invalid: ${args.file}`);
  }
  if (
    !Array.isArray(span) ||
    span.length !== 2 ||
    !span.every((value) => Number.isSafeInteger(value) && Number(value) >= 1)
  ) {
    fail(`Vale exact-file lint alert Span is invalid: ${args.file}`);
  }
  const Check = args.value[ValeAlertField.Check];
  const Description = args.value[ValeAlertField.Description];
  const Line = args.value[ValeAlertField.Line];
  const Link = args.value[ValeAlertField.Link];
  const Match = args.value[ValeAlertField.Match];
  const Message = args.value[ValeAlertField.Message];
  const Severity = args.value[ValeAlertField.Severity];
  if (typeof Check !== 'string' || Check.length === 0) {
    fail(`Vale exact-file lint alert Check is invalid: ${args.file}`);
  }
  if (!Number.isSafeInteger(Line) || Number(Line) < 1) {
    fail(`Vale exact-file lint alert Line is invalid: ${args.file}`);
  }
  if (typeof Message !== 'string' || Message.length === 0) {
    fail(`Vale exact-file lint alert Message is invalid: ${args.file}`);
  }
  if (typeof Severity !== 'string' || !isSeverity(Severity)) {
    fail(`Vale exact-file lint alert Severity is invalid: ${args.file}`);
  }
  if (
    typeof Description !== 'string' ||
    typeof Link !== 'string' ||
    typeof Match !== 'string'
  ) {
    fail(`Vale exact-file lint alert text fields are invalid: ${args.file}`);
  }
  return {
    check: Check,
    file: args.file,
    line: Number(Line),
    match: Match,
    message: Message,
    severity: Severity,
  };
}

type RequireExactFieldsArgs = {
  readonly actual: readonly string[];
  readonly expected: readonly string[];
  readonly label: string;
};

function requireExactFields(args: RequireExactFieldsArgs): void {
  const actual = [...args.actual].sort();
  const expected = [...args.expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`Vale exact-file lint ${args.label} fields are invalid.`);
  }
}

function isSeverity(value: string): value is ValeAlertSeverity {
  return (
    value === ValeAlertSeverity.Error ||
    value === ValeAlertSeverity.Suggestion ||
    value === ValeAlertSeverity.Warning
  );
}

function fail(text: string): never {
  const detailArgs: LoomFailureDetailArgs = {
    code: LoomFailureCode.CortexAuditFailed,
    text,
  };
  return loomFailureDetail(detailArgs);
}
