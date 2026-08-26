import { readFile } from 'node:fs/promises';
import { decodeAndValidateModuleDeliveryPlan } from './validation.ts';
import { ModuleDeliveryValidationStatus } from './domain.ts';
import type { ModuleDeliveryIssue } from './domain.ts';

type ModuleDeliveryCliArguments = readonly string[];

type AcceptedModuleDeliveryCliOutput = {
  readonly status: ModuleDeliveryValidationStatus.Accepted;
  readonly planDigest: string;
  readonly topologicalOrder: readonly string[];
  readonly waves: readonly (readonly string[])[];
};

type RejectedModuleDeliveryCliOutput = {
  readonly status: ModuleDeliveryValidationStatus.Rejected;
  readonly issues: readonly ModuleDeliveryIssue[];
};

type ModuleDeliveryCliOutput =
  AcceptedModuleDeliveryCliOutput | RejectedModuleDeliveryCliOutput;

async function runModuleDeliveryCli(
  argv: ModuleDeliveryCliArguments,
): Promise<number> {
  const planPath = parsePlanPath(argv);
  if (planPath === false) {
    process.stderr.write('Usage: loom-module-delivery --plan <json-file>\n');
    return 2;
  }
  let serialized: string;
  try {
    serialized = await readFile(planPath, 'utf8');
  } catch {
    process.stderr.write('Unable to read module delivery plan.\n');
    return 2;
  }
  const result = decodeAndValidateModuleDeliveryPlan(serialized);
  const output: ModuleDeliveryCliOutput =
    result.status === ModuleDeliveryValidationStatus.Accepted
      ? {
          status: result.status,
          planDigest: result.planDigest,
          topologicalOrder: result.topologicalOrder,
          waves: result.waves,
        }
      : { status: result.status, issues: result.issues };
  const rendered = `${JSON.stringify(output)}\n`;
  process.stdout.write(rendered);
  return result.status === ModuleDeliveryValidationStatus.Accepted ? 0 : 1;
}

function parsePlanPath(argv: ModuleDeliveryCliArguments): string | false {
  const tokens = argv.slice(2);
  if (
    tokens.length !== 2 ||
    tokens[0] !== '--plan' ||
    !tokens[1] ||
    tokens[1].startsWith('--')
  ) {
    return false;
  }
  return tokens[1];
}

if (import.meta.main) {
  process.exitCode = await runModuleDeliveryCli(Bun.argv);
}
