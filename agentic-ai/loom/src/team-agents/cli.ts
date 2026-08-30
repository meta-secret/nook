import { readFile } from 'node:fs/promises';
import { admitCortexTeamTask } from './admission.ts';
import type { AdmitCortexTeamTaskRequest } from './admission.ts';
import { decodeCortexTeamTaskAdmissionRequest } from './codec.ts';

type CortexTeamTaskCliArguments = readonly string[];

async function runCortexTeamTaskCli(
  argv: CortexTeamTaskCliArguments,
): Promise<number> {
  const argumentsValue = parseArguments(argv);
  if (argumentsValue === false) {
    process.stderr.write(
      'Usage: loom-cortex-team-task --request <json-file> --working-directory <repository>\n',
    );
    return 2;
  }
  try {
    const serialized = await readFile(argumentsValue.requestPath, 'utf8');
    const task = decodeCortexTeamTaskAdmissionRequest(serialized);
    const admissionRequest: AdmitCortexTeamTaskRequest = {
      repositoryRoot: argumentsValue.workingDirectory,
      task,
    };
    const admission = admitCortexTeamTask(admissionRequest);
    process.stdout.write(`${JSON.stringify(admission)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

type CortexTeamTaskCliRequest = {
  readonly requestPath: string;
  readonly workingDirectory: string;
};

function parseArguments(
  argv: CortexTeamTaskCliArguments,
): CortexTeamTaskCliRequest | false {
  const tokens = argv.slice(2);
  if (
    tokens.length !== 4 ||
    tokens[0] !== '--request' ||
    !tokens[1] ||
    tokens[2] !== '--working-directory' ||
    !tokens[3] ||
    tokens[1].startsWith('--') ||
    tokens[3].startsWith('--')
  )
    return false;
  return { requestPath: tokens[1], workingDirectory: tokens[3] };
}

if (import.meta.main) {
  process.exitCode = await runCortexTeamTaskCli(Bun.argv);
}
