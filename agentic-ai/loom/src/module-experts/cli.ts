#!/usr/bin/env bun
import { parseArgs } from 'node:util';

import { resolve } from 'node:path';

import { ModuleExpertContract } from './audit.ts';

import type { AuditModuleExpertsArgs } from './audit.ts';

export class ModuleExpertCommandParser {
  constructor(private readonly request: readonly string[]) {}
  static parse(argv: readonly string[]): ModuleExpertCommandLine | false {
    return new ModuleExpertCommandParser(argv).execute();
  }
  async main(): Promise<number> {
    const commandLine = this.execute();
    if (!commandLine) {
      console.error(HELP);
      return 2;
    }
    const auditArgs: AuditModuleExpertsArgs = {
      repoRoot: commandLine.workingDirectory,
    };
    const report = ModuleExpertContract.auditModuleExperts(auditArgs);
    console.log(JSON.stringify(report));
    return report.auditOk ? 0 : 1;
  }

  private execute(): ModuleExpertCommandLine | false {
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
    return command === ModuleExpertCommandKind.Validate
      ? {
          kind: ModuleExpertCommandKind.Validate,
          workingDirectory: resolve(directory),
        }
      : false;
  }
}

const HELP = `Loom named module experts

Usage:
  loom-module-experts validate --working-directory <repo-root>
`;

enum ModuleExpertCommandKind {
  Validate = 'validate',
}

export type ValidateModuleExpertCommandLine = {
  readonly kind: ModuleExpertCommandKind.Validate;
  readonly workingDirectory: string;
};

export type ModuleExpertCommandLine = ValidateModuleExpertCommandLine;

if (import.meta.main) {
  try {
    process.exit(
      await new ModuleExpertCommandParser(process.argv.slice(2)).main(),
    );
  } catch {
    console.error('Module expert command failed.');
    process.exit(1);
  }
}
