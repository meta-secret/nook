#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TaskTerminalKind } from '../agent-workflow/domain.ts';
import { auditStructuralExperts } from './audit.ts';
import { invokeStructuralExpert } from './invoke.ts';
import { decodeStructuralExpertInvocationRequest } from './request-codec.ts';

const HELP = `Loom structural experts

Usage:
  loom-structural-experts validate --working-directory <repo-root>
  loom-structural-experts invoke --request <request.json> --working-directory <repo-root>
`;

enum StructuralExpertCommandKind {
  Validate = 'validate',
  Invoke = 'invoke',
}

type ValidateCommand = {
  readonly kind: StructuralExpertCommandKind.Validate;
  readonly workingDirectory: string;
};

type InvokeCommand = {
  readonly kind: StructuralExpertCommandKind.Invoke;
  readonly requestPath: string;
  readonly workingDirectory: string;
};

type StructuralExpertCommand = ValidateCommand | InvokeCommand;

async function main(): Promise<number> {
  const command = parseStructuralExpertCommand(process.argv.slice(2));
  if (!command) {
    console.error(HELP);
    return 2;
  }
  if (command.kind === StructuralExpertCommandKind.Validate) {
    const auditRequest = { repoRoot: command.workingDirectory };
    const report = auditStructuralExperts(auditRequest);
    console.log(JSON.stringify(report));
    return report.auditOk ? 0 : 1;
  }
  const serialized = await readFile(command.requestPath, 'utf8');
  const request = decodeStructuralExpertInvocationRequest(serialized);
  const invocationRequest = {
    repoRoot: command.workingDirectory,
    request,
    signal: AbortSignal.timeout(300_000),
  };
  const result = await invokeStructuralExpert(invocationRequest);
  console.log(JSON.stringify(result));
  return result.terminal.kind === TaskTerminalKind.Completed ? 0 : 1;
}

export function parseStructuralExpertCommand(
  argv: readonly string[],
): StructuralExpertCommand | false {
  if (
    argv.length === 5 &&
    argv[0] === StructuralExpertCommandKind.Invoke &&
    argv[1] === '--request' &&
    argv[2] &&
    !argv[2].startsWith('--') &&
    argv[3] === '--working-directory' &&
    argv[4] &&
    !argv[4].startsWith('--')
  ) {
    return {
      kind: StructuralExpertCommandKind.Invoke,
      requestPath: resolve(argv[2]),
      workingDirectory: resolve(argv[4]),
    };
  }
  if (
    argv.length === 3 &&
    argv[0] === StructuralExpertCommandKind.Validate &&
    argv[1] === '--working-directory' &&
    argv[2] &&
    !argv[2].startsWith('--')
  ) {
    return {
      kind: StructuralExpertCommandKind.Validate,
      workingDirectory: resolve(argv[2]),
    };
  }
  return false;
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch {
    console.error('Structural expert command failed.');
    process.exit(1);
  }
}
