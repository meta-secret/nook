#!/usr/bin/env bun
import path from 'node:path';
import { stringifyYaml } from './codec/yaml.ts';
import { requireBun } from './lib/repo.ts';
import { ResultKind } from './result.ts';
import { dispatchRequestFile, encodedOutcome } from './tools/dispatch.ts';

const HELP = `Loom — mechanical cortex rites (YAML tool protocol)

Usage:
  loom <request.yaml>
  loom help

Request envelope:
  name: <tool>
  arguments: { ... }

Discover tools:
  loom agentic-ai/loom/params/tools-list/default.yaml

Stdout is YAML only. On decode/argument errors, exit 2 and read errors[].path.
`;

async function main(): Promise<number> {
  const bun = requireBun();
  if (bun.kind === ResultKind.Err) {
    console.error(bun.message);
    return 2;
  }

  const argv = process.argv.slice(2);
  const token = argv[0];
  if (typeof token !== 'string' || token === 'help' || token === '--help') {
    console.error(HELP);
    return typeof token === 'string' ? 0 : 2;
  }
  if (argv.length !== 1) {
    console.error(HELP);
    const yaml = stringifyYaml({
      ok: false,
      isError: true,
      phase: 'decode',
      errors: [
        {
          path: '',
          message: 'expected exactly one request YAML path argument',
        },
      ],
      recover: {
        toolsListRequest: 'agentic-ai/loom/params/tools-list/default.yaml',
        hint: 'run loom with a tools-list request, then retry with a valid request envelope',
      },
    });
    if (yaml.kind === ResultKind.Ok) {
      console.log(yaml.value);
    }
    return 2;
  }

  const requestPath = path.resolve(token);
  const outcome = await dispatchRequestFile(requestPath);
  const encoded = encodedOutcome(outcome);
  const yaml = stringifyYaml(encoded);
  if (yaml.kind === ResultKind.Err) {
    console.error(yaml.message);
    return 2;
  }
  console.log(yaml.value);
  return outcome.exitCode;
}

const exitCode = await main();
process.exit(exitCode);
