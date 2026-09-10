import { z } from 'zod';
import type { HostCommandFailure } from './run.ts';
import { err, ok, type Result } from 'neverthrow';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { LoomFailureCode } from '../loom-failure.ts';
import { YamlNullBoundary } from '../codec/external.ts';
import { type UntrustedYamlNode, UntrustedYamlBoundary } from './guards.ts';
import { type CommandOutput, type RunCommandArgs, HostCommand } from './run.ts';

export enum ValeAlertSeverity {
  Error = 'error',
  Suggestion = 'suggestion',
  Warning = 'warning',
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
export class ValeFileDiagnostics {
  constructor(private readonly request: RunValeFilesArgs) {}
  execute(): Result<ValeFilesResult, ValeFailure> {
    const args = this.request;
    const admission = new ValeFileRequest(args).admit();
    if (admission.isErr()) return err(admission.error);
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
    const decoded = new ValeOutputDocument({
      files: args.files,
      stdout: output.stdout,
    }).decode();
    if (decoded.isErr()) return err(decoded.error);
    const result = decoded.value;
    const expectedExitCode =
      result.alerts.length > 0 ? VALE_ALERT_EXIT_CODE : 0;
    if (output.exitCode !== expectedExitCode) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message:
          'Vale exact-file lint exit code did not match its native alerts.',
      });
    }
    return decoded;
  }
}
export class ValeFileRequest {
  constructor(private readonly request: RunValeFilesArgs) {}
  admit(): Result<void, ValeFailure> {
    const args = this.request;
    const config = new ValeRepositoryFile({
      file: args.configPath,
      label: 'Vale config',
      repoRoot: args.repoRoot,
    }).admit();
    if (config.isErr()) return err(config.error);
    if (args.files.length === 0) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: 'Vale exact-file lint requires at least one Markdown file.',
      });
    }
    const files = new Set<string>();
    for (const file of args.files) {
      const input = new ValeRepositoryFile({
        file,
        label: 'Vale Markdown input',
        repoRoot: args.repoRoot,
      }).admit();
      if (input.isErr()) return err(input.error);
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

    return ok();
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
        const alert = new ValeAlertDocument(alertArgs).decode();
        if (alert.isErr()) return err(alert.error);
        alerts.push(alert.value);
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
      if (metadata.isFile() && !metadata.isSymbolicLink()) return ok();
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
const VALE_ALERT_SCHEMA = z.strictObject({
  Action: z.strictObject({
    Name: z.string(),
    Params: z.custom(YamlNullBoundary.matches),
  }),
  Span: z.tuple([z.int().positive(), z.int().positive()]),
  Check: z.string().min(1),
  Line: z.int().positive(),
  Message: z.string().min(1),
  Severity: z.enum(ValeAlertSeverity),
  Description: z.string(),
  Link: z.string(),
  Match: z.string(),
});

export class ValeAlertDocument {
  constructor(private readonly request: ParseAlertArgs) {}
  decode(): Result<ValeNativeAlert, ValeFailure> {
    const decoded = VALE_ALERT_SCHEMA.safeParse(this.request.value);
    if (!decoded.success) {
      const issue = decoded.error.issues[0];
      const fieldPresent = Boolean(issue && issue.path.length > 0);
      const field = fieldPresent ? issue!.path[0] : false;
      const label =
        field === 'Description' || field === 'Link' || field === 'Match'
          ? 'text fields'
          : field === 'Action' && issue.path.length > 1
            ? 'Action shape'
            : String(field);
      const message =
        issue && issue.code === 'unrecognized_keys'
          ? `Vale exact-file lint ${field === 'Action' ? 'alert Action' : 'alert'} fields are invalid.`
          : !fieldPresent
            ? `Vale exact-file lint alert must be an object: ${this.request.file}`
            : `Vale exact-file lint alert ${label} ${label === 'text fields' ? 'are' : 'is'} invalid: ${this.request.file}`;
      return err({ code: LoomFailureCode.CortexAuditFailed, message });
    }
    const alert = decoded.data;
    return ok({
      check: alert.Check,
      file: this.request.file,
      line: alert.Line,
      match: alert.Match,
      message: alert.Message,
      severity: alert.Severity,
    });
  }
}

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
