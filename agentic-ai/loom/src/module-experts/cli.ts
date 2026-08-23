#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TaskTerminalKind } from '../agent-workflow/domain.ts';
import { auditModuleExperts } from './audit.ts';
import type { AuditModuleExpertsArgs } from './audit.ts';
import {
  decodeModuleExpertInvocationRequest,
  invokeModuleExpert,
} from './invoke.ts';
import type { InvokeModuleExpertArgs } from './invoke.ts';

const HELP = `Loom named module experts

Usage:
  loom-module-experts validate --working-directory <repo-root>
  loom-module-experts invoke --request <request.json> --working-directory <repo-root>
`;

enum ModuleExpertCommandKind {
  Validate = 'validate',
  Invoke = 'invoke',
}

export type ValidateModuleExpertCommandLine = {
  readonly kind: ModuleExpertCommandKind.Validate;
  readonly workingDirectory: string;
};

export type InvokeModuleExpertCommandLine = {
  readonly kind: ModuleExpertCommandKind.Invoke;
  readonly requestPath: string;
  readonly workingDirectory: string;
};

export type ModuleExpertCommandLine =
  ValidateModuleExpertCommandLine | InvokeModuleExpertCommandLine;

async function main(): Promise<number> {
  const commandLine = parseModuleExpertCommandLine(process.argv.slice(2));
  if (!commandLine) {
    console.error(HELP);
    return 2;
  }
  if (commandLine.kind === ModuleExpertCommandKind.Invoke) {
    const serialized = await readFile(commandLine.requestPath, 'utf8');
    const request = decodeModuleExpertInvocationRequest(serialized);
    const invokeArgs: InvokeModuleExpertArgs = {
      repoRoot: commandLine.workingDirectory,
      request,
      signal: AbortSignal.timeout(300_000),
    };
    const result = await invokeModuleExpert(invokeArgs);
    console.log(JSON.stringify(result));
    return result.terminal.kind === TaskTerminalKind.Completed ? 0 : 1;
  }
  const auditArgs: AuditModuleExpertsArgs = {
    repoRoot: commandLine.workingDirectory,
  };
  const report = auditModuleExperts(auditArgs);
  console.log(JSON.stringify(report));
  return report.auditOk ? 0 : 1;
}

export function parseModuleExpertCommandLine(
  argv: readonly string[],
): ModuleExpertCommandLine | false {
  if (
    argv.length === 5 &&
    argv[0] === ModuleExpertCommandKind.Invoke &&
    argv[1] === '--request' &&
    argv[2] &&
    !argv[2].startsWith('--') &&
    argv[3] === '--working-directory' &&
    argv[4] &&
    !argv[4].startsWith('--')
  ) {
    return {
      kind: ModuleExpertCommandKind.Invoke,
      requestPath: resolve(argv[2]),
      workingDirectory: resolve(argv[4]),
    };
  }
  if (
    argv.length !== 3 ||
    argv[0] !== ModuleExpertCommandKind.Validate ||
    argv[1] !== '--working-directory' ||
    !argv[2] ||
    argv[2].startsWith('--')
  ) {
    return false;
  }
  return {
    kind: ModuleExpertCommandKind.Validate,
    workingDirectory: resolve(argv[2]),
  };
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch {
    console.error('Module expert command failed.');
    process.exit(1);
  }
}
