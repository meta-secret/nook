import { readFile } from 'node:fs/promises';
import { decodeCompatibleModuleDeliveryPlan } from './codec.ts';
import { decodeAndValidateModuleDeliveryPlan } from './validation.ts';
import {
  MODULE_DELIVERY_PLAN_VERSION,
  ModuleDeliveryCompatibilityStatus,
  ModuleDeliveryIssueCode,
  ModuleDeliveryValidationStatus,
} from './domain.ts';
import type {
  ModuleDeliveryIssue,
  ModuleDeliveryPlanValidation,
  RejectedModuleDeliveryPlan,
} from './domain.ts';

type ModuleDeliveryCliArguments = readonly string[];

type AcceptedModuleDeliveryCliOutput = {
  readonly status: ModuleDeliveryValidationStatus.Accepted;
  readonly inputVersion: typeof MODULE_DELIVERY_PLAN_VERSION;
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
  const result = moduleDeliveryCliValidation(serialized);
  const output = moduleDeliveryCliOutput(result);
  const rendered = `${JSON.stringify(output)}\n`;
  process.stdout.write(rendered);
  return output.status === ModuleDeliveryValidationStatus.Accepted ? 0 : 1;
}

function moduleDeliveryCliValidation(
  serialized: string,
): ModuleDeliveryPlanValidation {
  const decoded = decodeCompatibleModuleDeliveryPlan(serialized);
  if (
    decoded.status === ModuleDeliveryCompatibilityStatus.Decoded &&
    decoded.inputVersion !== MODULE_DELIVERY_PLAN_VERSION
  ) {
    const issue: ModuleDeliveryIssue = {
      code: ModuleDeliveryIssueCode.InvalidField,
      path: '$.version',
      message: 'Canonical CLI admission requires plan version 2.',
    };
    const rejection: RejectedModuleDeliveryPlan = {
      status: ModuleDeliveryValidationStatus.Rejected,
      issues: [issue],
    };
    return rejection;
  }
  return decodeAndValidateModuleDeliveryPlan(serialized);
}

function moduleDeliveryCliOutput(
  result: ModuleDeliveryPlanValidation,
): ModuleDeliveryCliOutput {
  if (result.status === ModuleDeliveryValidationStatus.Rejected) return result;
  return {
    status: result.status,
    inputVersion: result.inputVersion,
    planDigest: result.planDigest,
    topologicalOrder: result.topologicalOrder,
    waves: result.waves,
  };
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
