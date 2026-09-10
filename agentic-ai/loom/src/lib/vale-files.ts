import type { HostCommandFailure } from './run.ts';
import { err, ok, type Result } from 'neverthrow';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { LoomFailureCode } from '../loom-failure.ts';
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
const VALE_ALERT_EXIT_CODE = 1;
const REQUIRED_VALE_VERSION = 'vale version 3.19.0';
const JSON_NULL = JSON.parse('null') as UntrustedYamlNode;
export class ValeFileDiagnostics {
  constructor(private readonly request: RunValeFilesArgs) {}
  execute(): Result<ValeFilesResult, ValeFailure> {
    const args = this.request;
    new ValeFileRequest(args).admit();
    const versionArgs: RunCommandArgs = {
      command: 'vale',
      args: ['--version'],
      cwd: args.repoRoot,
    };
    const versionLaunch = new HostCommand(versionArgs).execute();
    if (versionLaunch.isErr()) return err(versionLaunch.error);
    const version = versionLaunch.value;
    if (
      new ValeVersionOutput(version).admission() ===
      ValeVersionAdmission.Rejected
    ) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: 'Vale 3.19.0 is required for exact-file linting.',
      });
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
    const outputLaunch = new HostCommand(commandArgs).execute();
    if (outputLaunch.isErr()) return err(outputLaunch.error);
    const output = outputLaunch.value;
    if (output.signaled) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: 'Vale exact-file lint terminated from a signal.',
      });
    }
    if (output.stderr.length > 0) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Vale exact-file lint wrote to stderr: ${output.stderr}`,
      });
    }
    if (output.exitCode !== 0 && output.exitCode !== VALE_ALERT_EXIT_CODE) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Vale exact-file lint failed with exit code ${output.exitCode}.`,
      });
    }
    const result = new ValeOutputDocument({
      files: args.files,
      stdout: output.stdout,
    }).decode();
    const expectedExitCode =
      result.alerts.length > 0 ? VALE_ALERT_EXIT_CODE : 0;
    if (output.exitCode !== expectedExitCode) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message:
          'Vale exact-file lint exit code did not match its native alerts.',
      });
    }
    return ok(result);
  }
}
export class ValeFileRequest {
  constructor(private readonly request: RunValeFilesArgs) {}
  admit(): Result<void, ValeFailure> {
    const args = this.request;
    new ValeRepositoryFile({
      file: args.configPath,
      label: 'Vale config',
      repoRoot: args.repoRoot,
    }).admit();
    if (args.files.length === 0) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: 'Vale exact-file lint requires at least one Markdown file.',
      });
    }
    const files = new Set<string>();
    for (const file of args.files) {
      new ValeRepositoryFile({
        file,
        label: 'Vale Markdown input',
        repoRoot: args.repoRoot,
      }).admit();
      if (path.extname(file) !== '.md') {
        return err({
          code: LoomFailureCode.CortexAuditFailed,
          message: `Vale exact-file lint input must end in .md: ${file}`,
        });
      }
      if (files.has(file)) {
        return err({
          code: LoomFailureCode.CortexAuditFailed,
          message: `Vale exact-file lint input is duplicated: ${file}`,
        });
      }
      files.add(file);
    }

    return ok(undefined);
  }
}
export class ValeVersionOutput {
  constructor(private readonly request: CommandOutput) {}
  admission(): ValeVersionAdmission {
    const output = this.request;
    return !output.signaled &&
      output.exitCode === 0 &&
      output.stderr.length === 0 &&
      output.stdout.trim() === REQUIRED_VALE_VERSION
      ? ValeVersionAdmission.Admitted
      : ValeVersionAdmission.Rejected;
  }
}
export class ValeOutputDocument {
  constructor(private readonly request: ParseValeFilesOutputArgs) {}
  decode(): Result<ValeFilesResult, ValeFailure> {
    const args = this.request;
    let parsed: UntrustedYamlNode;
    try {
      parsed = UntrustedYamlBoundary.fromHost(
        JSON.parse(args.stdout) as UntrustedYamlNode,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Vale exact-file lint returned invalid JSON: ${message}`,
      });
    }
    if (!UntrustedYamlBoundary.isRecord(parsed)) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: 'Vale exact-file lint JSON must be an object.',
      });
    }
    const admittedFiles = new Set(args.files);
    const alerts: ValeNativeAlert[] = [];
    for (const [file, untrustedAlerts] of Object.entries(parsed)) {
      if (!admittedFiles.has(file)) {
        return err({
          code: LoomFailureCode.CortexAuditFailed,
          message: `Vale exact-file lint returned an unexpected file: ${file}`,
        });
      }
      if (!Array.isArray(untrustedAlerts)) {
        return err({
          code: LoomFailureCode.CortexAuditFailed,
          message: `Vale exact-file lint alerts must be an array: ${file}`,
        });
      }
      for (const untrustedAlert of untrustedAlerts) {
        const alertArgs: ParseAlertArgs = { file, value: untrustedAlert };
        alerts.push(new ValeAlertDocument(alertArgs).decode());
      }
    }
    return ok({ alerts });
  }
}
export class ValeRepositoryFile {
  constructor(private readonly request: ValidateRepositoryFileArgs) {}
  admit(): Result<void, ValeFailure> {
    const args = this.request;
    const { file, label, repoRoot } = args;
    if (!path.isAbsolute(repoRoot) || !path.isAbsolute(file)) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `${label} and repository root must be absolute paths.`,
      });
    }
    let realRepoRoot: string;
    let realFile: string;
    try {
      realRepoRoot = realpathSync(repoRoot);
      realFile = realpathSync(file);
    } catch {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `${label} must resolve to a regular repository file: ${file}`,
      });
    }
    const insideArgs: IsInsideArgs = {
      candidate: realFile,
      repoRoot: realRepoRoot,
    };
    if (
      path.normalize(file) !== file ||
      realRepoRoot !== repoRoot ||
      realFile !== file ||
      new ValeRepositoryContainment(insideArgs).containment() ===
        ValePathContainment.Outside
    ) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `${label} must be a canonical path inside the repository: ${file}`,
      });
    }
    try {
      const metadata = lstatSync(file);
      if (metadata.isFile() && !metadata.isSymbolicLink()) return ok(undefined);
    } catch {
      // The bounded failure below owns missing and unreadable paths.
    }
    return err({
      code: LoomFailureCode.CortexAuditFailed,
      message: `${label} must be a regular file: ${file}`,
    });
  }
}
export class ValeRepositoryContainment {
  constructor(private readonly request: IsInsideArgs) {}
  containment(): ValePathContainment {
    const args = this.request;
    const relative = path.relative(args.repoRoot, args.candidate);
    return relative.length > 0 &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
      ? ValePathContainment.Inside
      : ValePathContainment.Outside;
  }
}
export class ValeAlertDocument {
  constructor(private readonly request: ParseAlertArgs) {}
  decode(): Result<ValeNativeAlert, ValeFailure> {
    const args = this.request;
    if (!UntrustedYamlBoundary.isRecord(args.value)) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Vale exact-file lint alert must be an object: ${args.file}`,
      });
    }
    new ValeExactFields({
      actual: Object.keys(args.value),
      expected: Object.values(ValeAlertField),
      label: 'alert',
    }).admit();
    const action = args.value[ValeAlertField.Action] as UntrustedYamlNode;
    const span = args.value[ValeAlertField.Span] as UntrustedYamlNode;
    if (!UntrustedYamlBoundary.isRecord(action)) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Vale exact-file lint alert Action is invalid: ${args.file}`,
      });
    }
    new ValeExactFields({
      actual: Object.keys(action),
      expected: Object.values(ValeActionField),
      label: 'alert Action',
    }).admit();
    if (
      typeof action[ValeActionField.Name] !== 'string' ||
      action[ValeActionField.Params] !== JSON_NULL
    ) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Vale exact-file lint alert Action shape is invalid: ${args.file}`,
      });
    }
    if (
      !Array.isArray(span) ||
      span.length !== 2 ||
      !span.every((value) => Number.isSafeInteger(value) && Number(value) >= 1)
    ) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Vale exact-file lint alert Span is invalid: ${args.file}`,
      });
    }
    const Check = args.value[ValeAlertField.Check];
    const Description = args.value[ValeAlertField.Description];
    const Line = args.value[ValeAlertField.Line];
    const Link = args.value[ValeAlertField.Link];
    const Match = args.value[ValeAlertField.Match];
    const Message = args.value[ValeAlertField.Message];
    const Severity = args.value[ValeAlertField.Severity];
    if (typeof Check !== 'string' || Check.length === 0) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Vale exact-file lint alert Check is invalid: ${args.file}`,
      });
    }
    if (!Number.isSafeInteger(Line) || Number(Line) < 1) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Vale exact-file lint alert Line is invalid: ${args.file}`,
      });
    }
    if (typeof Message !== 'string' || Message.length === 0) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Vale exact-file lint alert Message is invalid: ${args.file}`,
      });
    }
    if (typeof Severity !== 'string' || !this.isSeverity(Severity)) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Vale exact-file lint alert Severity is invalid: ${args.file}`,
      });
    }
    if (
      typeof Description !== 'string' ||
      typeof Link !== 'string' ||
      typeof Match !== 'string'
    ) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Vale exact-file lint alert text fields are invalid: ${args.file}`,
      });
    }
    return ok({
      check: Check,
      file: args.file,
      line: Number(Line),
      match: Match,
      message: Message,
      severity: Severity,
    });
  }
  private isSeverity(value: string): value is ValeAlertSeverity {
    return (
      value === ValeAlertSeverity.Error ||
      value === ValeAlertSeverity.Suggestion ||
      value === ValeAlertSeverity.Warning
    );
  }
}
export class ValeExactFields {
  constructor(private readonly request: RequireExactFieldsArgs) {}
  admit(): Result<void, ValeFailure> {
    const args = this.request;
    const actual = [...args.actual].sort();
    const expected = [...args.expected].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Vale exact-file lint ${args.label} fields are invalid.`,
      });
    }

    return ok(undefined);
  }
}

type RequireExactFieldsArgs = {
  readonly actual: readonly string[];
  readonly expected: readonly string[];
  readonly label: string;
};

export type ValeFailure =
  | HostCommandFailure
  | {
      readonly code: LoomFailureCode.CortexAuditFailed;
      readonly message: string;
    };

export enum ValeVersionAdmission {
  Admitted = 'admitted',
  Rejected = 'rejected',
}
export enum ValePathContainment {
  Inside = 'inside',
  Outside = 'outside',
}
