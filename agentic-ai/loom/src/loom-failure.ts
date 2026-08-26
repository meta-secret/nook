export enum LoomFailureCode {
  BunNotFound = 'bunNotFound',
  RepoRootNotFound = 'repoRootNotFound',
  CommandFailedToStart = 'commandFailedToStart',
  CommandFailed = 'commandFailed',
  ValidationFailed = 'validationFailed',
  FileReadFailed = 'fileReadFailed',
  YamlStringifyFailed = 'yamlStringifyFailed',
  ScratchLogInvalid = 'scratchLogInvalid',
  PrMetadataInvalid = 'prMetadataInvalid',
  StatsFilenameInvalid = 'statsFilenameInvalid',
  SkillScaffoldFailed = 'skillScaffoldFailed',
  CortexAuditFailed = 'cortexAuditFailed',
  ExecutableSkillRuntimeFailed = 'executableSkillRuntimeFailed',
}

export enum LoomFailureDetailKind {
  None = 'none',
  Text = 'text',
}

export type LoomFailureDetail =
  | { readonly kind: LoomFailureDetailKind.None }
  | { readonly kind: LoomFailureDetailKind.Text; readonly text: string };

export type LoomFailureArgs = {
  readonly code: LoomFailureCode;
  readonly detail: LoomFailureDetail;
};

export class LoomFailure extends Error {
  readonly code: LoomFailureCode;
  readonly detail: LoomFailureDetail;

  constructor(args: LoomFailureArgs) {
    const { code, detail } = args;
    super(
      detail.kind === LoomFailureDetailKind.Text
        ? detail.text
        : defaultMessage(code),
    );
    this.name = 'LoomFailure';
    this.code = code;
    this.detail = detail;
  }
}

function defaultMessage(code: LoomFailureCode): string {
  switch (code) {
    case LoomFailureCode.BunNotFound:
      return 'Bun is not installed or not on PATH. Install Bun, then re-run Loom.';
    case LoomFailureCode.RepoRootNotFound:
      return 'Could not find Nook repository root from the current directory';
    case LoomFailureCode.CommandFailedToStart:
      return 'Command failed to start';
    case LoomFailureCode.CommandFailed:
      return 'Command failed';
    case LoomFailureCode.ValidationFailed:
      return 'Validation failed';
    case LoomFailureCode.FileReadFailed:
      return 'File read failed';
    case LoomFailureCode.YamlStringifyFailed:
      return 'Failed to stringify YAML';
    case LoomFailureCode.ScratchLogInvalid:
      return 'Scratch event log is invalid';
    case LoomFailureCode.PrMetadataInvalid:
      return 'PR metadata is invalid';
    case LoomFailureCode.StatsFilenameInvalid:
      return 'Stats filename must be <pr-number>.yaml';
    case LoomFailureCode.SkillScaffoldFailed:
      return 'Skill scaffold failed';
    case LoomFailureCode.CortexAuditFailed:
      return 'Cortex audit failed';
    case LoomFailureCode.ExecutableSkillRuntimeFailed:
      return 'Executable skill runtime failed';
  }
}

export function loomFailure(code: LoomFailureCode): never {
  const loomFailureArgs2: LoomFailureArgs = {
    code,
    detail: { kind: LoomFailureDetailKind.None },
  };
  throw new LoomFailure(loomFailureArgs2);
}

export type LoomFailureDetailArgs = {
  readonly code: LoomFailureCode;
  readonly text: string;
};

export function loomFailureDetail(args: LoomFailureDetailArgs): never {
  const { code, text } = args;

  const loomFailureArgs: LoomFailureArgs = {
    code,
    detail: {
      kind: LoomFailureDetailKind.Text,
      text,
    },
  };
  throw new LoomFailure(loomFailureArgs);
}
