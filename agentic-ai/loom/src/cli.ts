#!/usr/bin/env bun
import { CliInvocationKind, LoomCommandLine } from './cli-invocation.ts';
import { ResponsePhase } from './codec/enums.ts';
import {
  TOOLS_LIST_INVOKE,
  LoomRequestExamples,
} from './codec/example-documents.ts';
import { YamlDocument } from './codec/yaml.ts';
import { UntrustedYamlBoundary } from './lib/guards.ts';
import { RepositoryRequestPath, BunExecutable } from './lib/repo.ts';
import { LoomRequestDispatch } from './tools/dispatch.ts';

import type { ParseCliInvocationArgs } from './cli-invocation.ts';
import type { ResolveRequestPathArgs } from './lib/repo.ts';
import type { UntrustedYamlNode } from './lib/guards.ts';

const HELP = `Loom — mechanical cortex rites (domain YAML protocol)

Usage:
  loom <request.yaml>
  loom --default <prePush|toolsList|cortexAudit|cortexSessionClean|dependencyPopularity>
  loom help

Domain request example:
  prePush:
    stageHostUpdates: true
    fetchOriginMain: true

Discover request kinds:
  task loom:tools-list

Stdout is YAML only. On decode errors, exit 2 and read errors[].path.
`;

export class LoomCli {
  private constructor(private readonly request: readonly string[]) {}

  static main(arguments_: readonly string[] = process.argv): Promise<number> {
    return new LoomCli(arguments_).execute();
  }

  private async execute(): Promise<number> {
    const arguments_ = this.request;
    const executable = BunExecutable.discover();
    if (executable.isErr()) {
      console.error(executable.error.message);
      return 2;
    }

    const parseCliInvocationArgs: ParseCliInvocationArgs = {
      argv: arguments_.slice(2),
    };
    const invocation = LoomCommandLine.parse(parseCliInvocationArgs);
    if (invocation.kind === CliInvocationKind.Help) {
      console.error(HELP);
      return typeof arguments_[2] === 'string' ? 0 : 2;
    }
    if (invocation.kind === CliInvocationKind.UsageError) {
      console.error(HELP);
      const usageErrorYamlArgs = { message: invocation.message };
      console.log(
        YamlDocument.stringify(LoomCli.usageErrorYaml(usageErrorYamlArgs)),
      );
      return 2;
    }
    if (invocation.kind === CliInvocationKind.DefaultFamily) {
      const requestNode = LoomRequestExamples.exampleDocumentNode(
        invocation.entry.document,
      );
      const outcome = await LoomRequestDispatch.dispatchValue(requestNode);
      console.log(
        YamlDocument.stringify(LoomRequestDispatch.encodedOutcome(outcome)),
      );
      return outcome.exitCode;
    }

    const requestPathArgs: ResolveRequestPathArgs = {
      requestPath: invocation.requestPath,
    };
    const resolved = new RepositoryRequestPath(requestPathArgs).resolve();
    if (resolved.isErr()) {
      console.error(resolved.error.message);
      return 2;
    }
    const requestPath = resolved.value;

    const outcome = await LoomRequestDispatch.dispatchRequestFile(requestPath);
    console.log(
      YamlDocument.stringify(LoomRequestDispatch.encodedOutcome(outcome)),
    );
    return outcome.exitCode;
  }

  private static usageErrorYaml(args: UsageErrorYamlArgs): UntrustedYamlNode {
    const encoded = {
      ok: false,
      isError: true,
      phase: ResponsePhase.Decode,
      errors: [
        {
          path: '',
          message: args.message,
        },
      ],
      recover: {
        toolsListRequest: TOOLS_LIST_INVOKE,
        hint: 'run task loom:tools-list, then retry with a valid domain request object',
      },
    };
    return UntrustedYamlBoundary.fromHost(encoded as UntrustedYamlNode);
  }
}

type UsageErrorYamlArgs = {
  readonly message: string;
};

const exitCode = await LoomCli.main();
process.exit(exitCode);
