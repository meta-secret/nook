#!/usr/bin/env bun
import { ResponsePhase } from './codec/enums.ts';
import { stringifyYaml } from './codec/yaml.ts';
import { requireBun, resolveRequestPath } from './lib/repo.ts';
import { ResultKind } from './result.ts';
import { dispatchRequestFile, encodedOutcome } from './tools/dispatch.ts';

const HELP = `Loom — mechanical cortex rites (domain YAML protocol)

Usage:
  loom <request.yaml>
  loom help

Domain request example:
  prePush:
    stageHostUpdates: true
    fetchOriginMain: true

Discover request kinds:
  loom agentic-ai/loom/params/tools-list/default.yaml

Stdout is YAML only. On decode errors, exit 2 and read errors[].path.
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
      phase: ResponsePhase.Decode,
      errors: [
        {
          path: '',
          message: 'expected exactly one request YAML path argument',
        },
      ],
      recover: {
        toolsListRequest: 'agentic-ai/loom/params/tools-list/default.yaml',
        hint: 'run loom with a toolsList request, then retry with a valid domain request object',
      },
    });
    if (yaml.kind === ResultKind.Ok) {
      console.log(yaml.value);
    }
    return 2;
  }

  const resolved = resolveRequestPath(token);
  if (resolved.kind === ResultKind.Err) {
    console.error(resolved.message);
    return 2;
  }
  const requestPath = resolved.value;
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
