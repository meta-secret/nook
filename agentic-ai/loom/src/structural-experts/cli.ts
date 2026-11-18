#!/usr/bin/env bun
import { ExpertValidationArguments } from '../lib/expert-validation-arguments.ts';
import type { ExpertValidationCommand } from '../lib/expert-validation-arguments.ts';

import { StructuralExpertContract } from './audit.ts';

export class StructuralExpertCommandLine {
  constructor(private readonly request: readonly string[]) {}
  static parse(argv: readonly string[]): ExpertValidationCommand | false {
    return new ExpertValidationArguments(argv).parse();
  }
  async main(): Promise<number> {
    const command = StructuralExpertCommandLine.parse(this.request);
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
}

const HELP = `Loom structural experts

Usage:
  loom-structural-experts validate --working-directory <repo-root>
`;

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
