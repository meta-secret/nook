import { resolve } from 'node:path';

enum ExpertAuditCommandKind {
  Validate = 'validate',
}

export type ExpertValidationCommand = {
  readonly kind: ExpertAuditCommandKind.Validate;
  readonly workingDirectory: string;
};

export class ExpertValidationArguments {
  constructor(private readonly argv: readonly string[]) {}

  parse(): ExpertValidationCommand | false {
    const [command, option, directory] = this.argv;
    if (
      this.argv.length !== 3 ||
      command !== ExpertAuditCommandKind.Validate ||
      option !== '--working-directory' ||
      !directory ||
      directory.startsWith('--')
    )
      return false;
    return {
      kind: ExpertAuditCommandKind.Validate,
      workingDirectory: resolve(directory),
    };
  }
}
