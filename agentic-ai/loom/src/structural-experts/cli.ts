#!/usr/bin/env bun
import { parseArgs } from 'node:util';

import { resolve } from 'node:path';

import { StructuralExpertContract } from './audit.ts';

export class StructuralExpertCommandLine {
  constructor(private readonly request: readonly string[]) {}
  static parse(argv: readonly string[]): StructuralExpertCommand | false {
    return new StructuralExpertCommandLine(argv).execute();
  }
  async main(): Promise<number> {
    const command = this.execute();
    if (!command) {
      console.error(HELP);
      return 2;
    }
    const auditRequest = { repoRoot: command.workingDirectory };
    const result =
      StructuralExpertContract.auditStructuralExperts(auditRequest);
    console.log(JSON.stringify(result));
    return result.auditOk ? 0 : 1;
  }

  private execute(): StructuralExpertCommand | false {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...this.request],
        options: {
          'working-directory': { type: 'string' },
        },
        allowPositionals: true,
        strict: false,
        tokens: true,
      });
    } catch {
      return false;
    }
    const { values, positionals, tokens } = parsed;
    const [command] = positionals;
    const directory = values['working-directory'];
    const expected = ['working-directory'];
    if (
      positionals.length !== 1 ||
      tokens.length !== expected.length + 1 ||
      tokens[0]?.kind !== 'positional' ||
      Array.from(tokens.slice(1).entries()).some((entry) => {
        const [index, token] = entry;
        return (
          token.kind !== 'option' ||
          token.name !== expected[index] ||
          token.inlineValue ||
          token.index !== index * 2 + 1
        );
      }) ||
      typeof directory !== 'string' ||
      !directory ||
      directory.startsWith('--')
    )
      return false;
    return command === StructuralExpertCommandKind.Validate
      ? {
          kind: StructuralExpertCommandKind.Validate,
          workingDirectory: resolve(directory),
        }
      : false;
  }
}

const HELP = `Loom structural experts

Usage:
  loom-structural-experts validate --working-directory <repo-root>
`;

enum StructuralExpertCommandKind {
  Validate = 'validate',
}

type ValidateCommand = {
  readonly kind: StructuralExpertCommandKind.Validate;
  readonly workingDirectory: string;
};

type StructuralExpertCommand = ValidateCommand;

if (import.meta.main) {
  try {
    process.exit(
      await new StructuralExpertCommandLine(process.argv.slice(2)).main(),
    );
  } catch {
    console.error('Structural expert command failed.');
    process.exit(1);
  }
}
