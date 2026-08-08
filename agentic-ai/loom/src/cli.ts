#!/usr/bin/env bun
import { ResponsePhase } from './codec/enums.ts';
import { stringifyYaml } from './codec/yaml.ts';
import { resolveRequestPath, requireBun } from './lib/repo.ts';
import { LoomFailure } from './loom-failure.ts';
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
  try {
    requireBun();
  } catch (error) {
    console.error(error instanceof LoomFailure ? error.message : String(error));
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
    console.log(
      stringifyYaml({
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
      }),
    );
    return 2;
  }

  let requestPath: string;
  try {
    requestPath = resolveRequestPath({ requestPath: token });
  } catch (error) {
    console.error(error instanceof LoomFailure ? error.message : String(error));
    return 2;
  }

  const outcome = await dispatchRequestFile(requestPath);
  console.log(stringifyYaml(encodedOutcome(outcome)));
  return outcome.exitCode;
}

const exitCode = await main();
process.exit(exitCode);
