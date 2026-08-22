#!/usr/bin/env bun
import { resolve } from 'node:path';
import { auditModuleExperts } from './audit.ts';
import type { AuditModuleExpertsArgs } from './audit.ts';

const HELP = `Loom module expert catalog audit

Usage:
  loom-module-experts validate --working-directory <repo-root>
`;

type ModuleExpertCommandLine = {
  readonly workingDirectory: string;
};

function main(): number {
  const commandLine = parseCommandLine(process.argv.slice(2));
  if (!commandLine) {
    console.error(HELP);
    return 2;
  }
  const auditArgs: AuditModuleExpertsArgs = {
    repoRoot: commandLine.workingDirectory,
  };
  const report = auditModuleExperts(auditArgs);
  console.log(JSON.stringify(report));
  return report.auditOk ? 0 : 1;
}

function parseCommandLine(
  argv: readonly string[],
): ModuleExpertCommandLine | false {
  if (
    argv.length !== 3 ||
    argv[0] !== 'validate' ||
    argv[1] !== '--working-directory' ||
    !argv[2] ||
    argv[2].startsWith('--')
  ) {
    return false;
  }
  return { workingDirectory: resolve(argv[2]) };
}

process.exit(await Promise.resolve(main()));
