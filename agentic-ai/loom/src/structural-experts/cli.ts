#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';

import { resolve } from 'node:path';

import { TaskTerminalKind } from '../agent-workflow/domain.ts';

import { StructuralExpertContract } from './audit.ts';

import { StructuralExpertInvocation } from './invoke.ts';

import { StructuralExpertRequestDecoder } from './request-codec.ts';

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
    if (command.kind === StructuralExpertCommandKind.Validate) {
      const auditRequest = { repoRoot: command.workingDirectory };
      const report =
        StructuralExpertContract.auditStructuralExperts(auditRequest);
      console.log(JSON.stringify(report));
      return report.auditOk ? 0 : 1;
    }
    const serialized = await readFile(command.requestPath, 'utf8');
    const request =
      StructuralExpertRequestDecoder.decodeStructuralExpertInvocationRequest(
        serialized,
      );
    const invocationRequest = {
      repoRoot: command.workingDirectory,
      request,
      signal: AbortSignal.timeout(300_000),
    };
    const result =
      await StructuralExpertInvocation.invokeStructuralExpert(
        invocationRequest,
      );
    console.log(JSON.stringify(result));
    return result.terminal.kind === TaskTerminalKind.Completed ? 0 : 1;
  }

  private execute(): StructuralExpertCommand | false {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...this.request],
        options: {
          request: { type: 'string' },
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
    const expected =
      command === StructuralExpertCommandKind.Invoke
        ? ['request', 'working-directory']
        : ['working-directory'];
    if (
      positionals.length !== 1 ||
      tokens.length !== expected.length + 1 ||
      tokens[0]?.kind !== 'positional' ||
      tokens
        .slice(1)
        .some(
          (token, index) =>
            token.kind !== 'option' ||
            token.name !== expected[index] ||
            token.inlineValue ||
            token.index !== index * 2 + 1,
        ) ||
      typeof directory !== 'string' ||
      !directory ||
      directory.startsWith('--')
    )
      return false;
    if (
      command === StructuralExpertCommandKind.Invoke &&
      typeof values.request === 'string' &&
      values.request &&
      !values.request.startsWith('--')
    ) {
      return {
        kind: StructuralExpertCommandKind.Invoke,
        requestPath: resolve(values.request),
        workingDirectory: resolve(directory),
      };
    }
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
