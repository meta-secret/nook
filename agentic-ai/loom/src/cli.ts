#!/usr/bin/env bun
import { CliInvocationKind, parseCliInvocation } from './cli-invocation.ts';
import { ResponsePhase } from './codec/enums.ts';
import {
  TOOLS_LIST_INVOKE,
  exampleDocumentNode,
} from './codec/example-documents.ts';
import { stringifyYaml } from './codec/yaml.ts';
import { asUntrustedYamlNode } from './lib/guards.ts';
import { resolveRequestPath, requireBun } from './lib/repo.ts';
import { LoomFailure } from './loom-failure.ts';
import {
  dispatchRequestFile,
  dispatchValue,
  encodedOutcome,
} from './tools/dispatch.ts';

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

async function main(): Promise<number> {
  try {
    requireBun();
  } catch (error) {
    console.error(error instanceof LoomFailure ? error.message : String(error));
    return 2;
  }

  const parseCliInvocationArgs: ParseCliInvocationArgs = {
    argv: process.argv.slice(2),
  };
  const invocation = parseCliInvocation(parseCliInvocationArgs);
  if (invocation.kind === CliInvocationKind.Help) {
    console.error(HELP);
    return typeof process.argv[2] === 'string' ? 0 : 2;
  }
  if (invocation.kind === CliInvocationKind.UsageError) {
    console.error(HELP);
    const usageErrorYamlArgs = { message: invocation.message };
    console.log(stringifyYaml(usageErrorYaml(usageErrorYamlArgs)));
    return 2;
  }
  if (invocation.kind === CliInvocationKind.DefaultFamily) {
    const requestNode = exampleDocumentNode(invocation.entry.document);
    const outcome = await dispatchValue(requestNode);
    console.log(stringifyYaml(encodedOutcome(outcome)));
    return outcome.exitCode;
  }

  let requestPath: string;
  try {
    const requestPathArgs: ResolveRequestPathArgs = {
      requestPath: invocation.requestPath,
    };
    requestPath = resolveRequestPath(requestPathArgs);
  } catch (error) {
    console.error(error instanceof LoomFailure ? error.message : String(error));
    return 2;
  }

  const outcome = await dispatchRequestFile(requestPath);
  console.log(stringifyYaml(encodedOutcome(outcome)));
  return outcome.exitCode;
}

type UsageErrorYamlArgs = {
  readonly message: string;
};

function usageErrorYaml(args: UsageErrorYamlArgs): UntrustedYamlNode {
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
  return asUntrustedYamlNode(encoded as UntrustedYamlNode);
}

const exitCode = await main();
process.exit(exitCode);
