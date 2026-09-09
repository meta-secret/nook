import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {
  LoomFailureCode,
  type LoomFailureDetailArgs,
  LoomFailure,
} from '../loom-failure.ts';
import { type UntrustedYamlNode, UntrustedYamlBoundary } from './guards.ts';
import { type CommandOutput, type RunCommandArgs, HostCommand } from './run.ts';

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

/** Owns the vale file diagnostics registry and its capability transitions. */
export class ValeFileDiagnostics {
  private constructor() {}
  private static readonly VALE_ALERT_EXIT_CODE = 1;

  private static readonly REQUIRED_VALE_VERSION = 'vale version 3.19.0';

  private static readonly JSON_NULL = JSON.parse('null') as UntrustedYamlNode;

  static runValeFiles(args: RunValeFilesArgs): ValeFilesResult {
    ValeFileDiagnostics.validateRequest(args);
    const versionArgs: RunCommandArgs = {
      command: 'vale',
      args: ['--version'],
      cwd: args.repoRoot,
    };
    const version = HostCommand.run(versionArgs);
    if (!ValeFileDiagnostics.isRequiredValeVersion(version)) {
      ValeFileDiagnostics.fail(
        'Vale 3.19.0 is required for exact-file linting.',
      );
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
    const output = HostCommand.run(commandArgs);
    if (output.signaled) {
      ValeFileDiagnostics.fail(
        'Vale exact-file lint terminated from a signal.',
      );
    }
    if (output.stderr.length > 0) {
      ValeFileDiagnostics.fail(
        `Vale exact-file lint wrote to stderr: ${output.stderr}`,
      );
    }
    if (
      output.exitCode !== 0 &&
      output.exitCode !== ValeFileDiagnostics.VALE_ALERT_EXIT_CODE
    ) {
      ValeFileDiagnostics.fail(
        `Vale exact-file lint failed with exit code ${output.exitCode}.`,
      );
    }
    const result = ValeFileDiagnostics.parseValeFilesOutput({
      files: args.files,
      stdout: output.stdout,
    });
    const expectedExitCode =
      result.alerts.length > 0 ? ValeFileDiagnostics.VALE_ALERT_EXIT_CODE : 0;
    if (output.exitCode !== expectedExitCode) {
      ValeFileDiagnostics.fail(
        'Vale exact-file lint exit code did not match its native alerts.',
      );
    }
    return result;
  }

  static isRequiredValeVersion(output: CommandOutput): boolean {
    return (
      !output.signaled &&
      output.exitCode === 0 &&
      output.stderr.length === 0 &&
      output.stdout.trim() === ValeFileDiagnostics.REQUIRED_VALE_VERSION
    );
  }

  static parseValeFilesOutput(args: ParseValeFilesOutputArgs): ValeFilesResult {
    let parsed: UntrustedYamlNode;
    try {
      parsed = UntrustedYamlBoundary.fromHost(
        JSON.parse(args.stdout) as UntrustedYamlNode,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ValeFileDiagnostics.fail(
        `Vale exact-file lint returned invalid JSON: ${message}`,
      );
    }
    if (!UntrustedYamlBoundary.isRecord(parsed)) {
      ValeFileDiagnostics.fail('Vale exact-file lint JSON must be an object.');
    }
    const admittedFiles = new Set(args.files);
    const alerts: ValeNativeAlert[] = [];
    for (const [file, untrustedAlerts] of Object.entries(parsed)) {
      if (!admittedFiles.has(file)) {
        ValeFileDiagnostics.fail(
          `Vale exact-file lint returned an unexpected file: ${file}`,
        );
      }
      if (!Array.isArray(untrustedAlerts)) {
        ValeFileDiagnostics.fail(
          `Vale exact-file lint alerts must be an array: ${file}`,
        );
      }
      for (const untrustedAlert of untrustedAlerts) {
        const alertArgs: ParseAlertArgs = { file, value: untrustedAlert };
        alerts.push(ValeFileDiagnostics.parseAlert(alertArgs));
      }
    }
    return { alerts };
  }

  private static validateRequest(args: RunValeFilesArgs): void {
    ValeFileDiagnostics.validateRepositoryFile({
      file: args.configPath,
      label: 'Vale config',
      repoRoot: args.repoRoot,
    });
    if (args.files.length === 0) {
      ValeFileDiagnostics.fail(
        'Vale exact-file lint requires at least one Markdown file.',
      );
    }
    const files = new Set<string>();
    for (const file of args.files) {
      ValeFileDiagnostics.validateRepositoryFile({
        file,
        label: 'Vale Markdown input',
        repoRoot: args.repoRoot,
      });
      if (path.extname(file) !== '.md') {
        ValeFileDiagnostics.fail(
          `Vale exact-file lint input must end in .md: ${file}`,
        );
      }
      if (files.has(file)) {
        ValeFileDiagnostics.fail(
          `Vale exact-file lint input is duplicated: ${file}`,
        );
      }
      files.add(file);
    }
  }

  private static validateRepositoryFile(
    args: ValidateRepositoryFileArgs,
  ): void {
    const { file, label, repoRoot } = args;
    if (!path.isAbsolute(repoRoot) || !path.isAbsolute(file)) {
      ValeFileDiagnostics.fail(
        `${label} and repository root must be absolute paths.`,
      );
    }
    let realRepoRoot: string;
    let realFile: string;
    try {
      realRepoRoot = realpathSync(repoRoot);
      realFile = realpathSync(file);
    } catch {
      ValeFileDiagnostics.fail(
        `${label} must resolve to a regular repository file: ${file}`,
      );
    }
    const insideArgs: IsInsideArgs = {
      candidate: realFile,
      repoRoot: realRepoRoot,
    };
    if (
      path.normalize(file) !== file ||
      realRepoRoot !== repoRoot ||
      realFile !== file ||
      !ValeFileDiagnostics.isInside(insideArgs)
    ) {
      ValeFileDiagnostics.fail(
        `${label} must be a canonical path inside the repository: ${file}`,
      );
    }
    try {
      const metadata = lstatSync(file);
      if (metadata.isFile() && !metadata.isSymbolicLink()) return;
    } catch {
      // The bounded failure below owns missing and unreadable paths.
    }
    ValeFileDiagnostics.fail(`${label} must be a regular file: ${file}`);
  }

  private static isInside(args: IsInsideArgs): boolean {
    const relative = path.relative(args.repoRoot, args.candidate);
    return (
      relative.length > 0 &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  }

  private static parseAlert(args: ParseAlertArgs): ValeNativeAlert {
    if (!UntrustedYamlBoundary.isRecord(args.value)) {
      ValeFileDiagnostics.fail(
        `Vale exact-file lint alert must be an object: ${args.file}`,
      );
    }
    ValeFileDiagnostics.requireExactFields({
      actual: Object.keys(args.value),
      expected: Object.values(ValeAlertField),
      label: 'alert',
    });
    const action = args.value[ValeAlertField.Action] as UntrustedYamlNode;
    const span = args.value[ValeAlertField.Span] as UntrustedYamlNode;
    if (!UntrustedYamlBoundary.isRecord(action)) {
      ValeFileDiagnostics.fail(
        `Vale exact-file lint alert Action is invalid: ${args.file}`,
      );
    }
    ValeFileDiagnostics.requireExactFields({
      actual: Object.keys(action),
      expected: Object.values(ValeActionField),
      label: 'alert Action',
    });
    if (
      typeof action[ValeActionField.Name] !== 'string' ||
      action[ValeActionField.Params] !== ValeFileDiagnostics.JSON_NULL
    ) {
      ValeFileDiagnostics.fail(
        `Vale exact-file lint alert Action shape is invalid: ${args.file}`,
      );
    }
    if (
      !Array.isArray(span) ||
      span.length !== 2 ||
      !span.every((value) => Number.isSafeInteger(value) && Number(value) >= 1)
    ) {
      ValeFileDiagnostics.fail(
        `Vale exact-file lint alert Span is invalid: ${args.file}`,
      );
    }
    const Check = args.value[ValeAlertField.Check];
    const Description = args.value[ValeAlertField.Description];
    const Line = args.value[ValeAlertField.Line];
    const Link = args.value[ValeAlertField.Link];
    const Match = args.value[ValeAlertField.Match];
    const Message = args.value[ValeAlertField.Message];
    const Severity = args.value[ValeAlertField.Severity];
    if (typeof Check !== 'string' || Check.length === 0) {
      ValeFileDiagnostics.fail(
        `Vale exact-file lint alert Check is invalid: ${args.file}`,
      );
    }
    if (!Number.isSafeInteger(Line) || Number(Line) < 1) {
      ValeFileDiagnostics.fail(
        `Vale exact-file lint alert Line is invalid: ${args.file}`,
      );
    }
    if (typeof Message !== 'string' || Message.length === 0) {
      ValeFileDiagnostics.fail(
        `Vale exact-file lint alert Message is invalid: ${args.file}`,
      );
    }
    if (
      typeof Severity !== 'string' ||
      !ValeFileDiagnostics.isSeverity(Severity)
    ) {
      ValeFileDiagnostics.fail(
        `Vale exact-file lint alert Severity is invalid: ${args.file}`,
      );
    }
    if (
      typeof Description !== 'string' ||
      typeof Link !== 'string' ||
      typeof Match !== 'string'
    ) {
      ValeFileDiagnostics.fail(
        `Vale exact-file lint alert text fields are invalid: ${args.file}`,
      );
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

  private static requireExactFields(args: RequireExactFieldsArgs): void {
    const actual = [...args.actual].sort();
    const expected = [...args.expected].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      ValeFileDiagnostics.fail(
        `Vale exact-file lint ${args.label} fields are invalid.`,
      );
    }
  }

  private static isSeverity(value: string): value is ValeAlertSeverity {
    return (
      value === ValeAlertSeverity.Error ||
      value === ValeAlertSeverity.Suggestion ||
      value === ValeAlertSeverity.Warning
    );
  }

  private static fail(text: string): never {
    const detailArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.CortexAuditFailed,
      text,
    };
    return LoomFailure.detail(detailArgs);
  }
}

type RequireExactFieldsArgs = {
  readonly actual: readonly string[];
  readonly expected: readonly string[];
  readonly label: string;
};
