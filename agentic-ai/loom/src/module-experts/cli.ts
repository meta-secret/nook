#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';

import { resolve } from 'node:path';

import { TaskTerminalKind } from '../agent-workflow/domain.ts';

import { ModuleExpertContract } from './audit.ts';

import type { AuditModuleExpertsArgs } from './audit.ts';

import {
  ModuleExpertInvocation,
  ModuleExpertRequestDecoder,
} from './invoke.ts';

import type { InvokeModuleExpertArgs } from './invoke.ts';

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
    if (commandLine.kind === ModuleExpertCommandKind.Invoke) {
      const serialized = await readFile(commandLine.requestPath, 'utf8');
      const request =
        ModuleExpertRequestDecoder.decodeModuleExpertInvocationRequest(
          serialized,
        );
      const invokeArgs: InvokeModuleExpertArgs = {
        repoRoot: commandLine.workingDirectory,
        request,
        signal: AbortSignal.timeout(300_000),
      };
      const result =
        await ModuleExpertInvocation.invokeModuleExpert(invokeArgs);
      console.log(JSON.stringify(result));
      return result.terminal.kind === TaskTerminalKind.Completed ? 0 : 1;
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
      command === ModuleExpertCommandKind.Invoke
        ? ['request', 'working-directory']
        : ['working-directory'];
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
    if (
      command === ModuleExpertCommandKind.Invoke &&
      typeof values.request === 'string' &&
      values.request &&
      !values.request.startsWith('--')
    ) {
      return {
        kind: ModuleExpertCommandKind.Invoke,
        requestPath: resolve(values.request),
        workingDirectory: resolve(directory),
      };
    }
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
