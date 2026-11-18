#!/usr/bin/env bun
import { ExpertValidationArguments } from '../lib/expert-validation-arguments.ts';
import type { ExpertValidationCommand } from '../lib/expert-validation-arguments.ts';

import { ModuleExpertContract } from './audit.ts';

import type { AuditModuleExpertsArgs } from './audit.ts';

export class ModuleExpertCommandParser {
  constructor(private readonly request: readonly string[]) {}
  static parse(argv: readonly string[]): ModuleExpertCommandLine | false {
    return new ExpertValidationArguments(argv).parse();
  }
  async main(): Promise<number> {
    const commandLine = ModuleExpertCommandParser.parse(this.request);
    if (!commandLine) {
      console.error(HELP);
      return 2;
    }
    const auditArgs: AuditModuleExpertsArgs = {
      repoRoot: commandLine.workingDirectory,
    };
    const report = await ModuleExpertContract.auditModuleExperts(auditArgs);
    console.log(JSON.stringify(report));
    return report.auditOk ? 0 : 1;
  }
}

const HELP = `Loom named module experts

Usage:
  loom-module-experts validate --working-directory <repo-root>
`;

export type ValidateModuleExpertCommandLine = ExpertValidationCommand;
export type ModuleExpertCommandLine = ExpertValidationCommand;

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
