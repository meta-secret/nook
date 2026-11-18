import { readFile } from 'node:fs/promises';
import { ModuleDeliveryPlanDecoder } from './validation.ts';
import {
  MODULE_DELIVERY_PLAN_VERSION,
  ModuleDeliveryValidationStatus,
} from './domain.ts';
import type {
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

type ModuleDeliveryCliOutput =
  AcceptedModuleDeliveryCliOutput | RejectedModuleDeliveryPlan;

export class ModuleDeliveryCli {
  private constructor(private readonly request: ModuleDeliveryCliArguments) {}

  static runModuleDeliveryCli(
    argv: ModuleDeliveryCliArguments,
  ): Promise<number> {
    return new ModuleDeliveryCli(argv).execute();
  }

  private async execute(): Promise<number> {
    const argv = this.request;
    const planPath = ModuleDeliveryCli.parsePlanPath(argv);
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
    const result = ModuleDeliveryPlanDecoder.decodeAndValidate(serialized);
    const output = ModuleDeliveryCli.moduleDeliveryCliOutput(result);
    const rendered = `${JSON.stringify(output)}\n`;
    process.stdout.write(rendered);
    return output.status === ModuleDeliveryValidationStatus.Accepted ? 0 : 1;
  }

  private static moduleDeliveryCliOutput(
    result: ModuleDeliveryPlanValidation,
  ): ModuleDeliveryCliOutput {
    if (result.status === ModuleDeliveryValidationStatus.Rejected)
      return result;
    return {
      status: result.status,
      inputVersion: result.inputVersion,
      planDigest: result.planDigest,
      topologicalOrder: result.topologicalOrder,
      waves: result.waves,
    };
  }

  private static parsePlanPath(
    argv: ModuleDeliveryCliArguments,
  ): string | false {
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
}

if (import.meta.main) {
  process.exitCode = await ModuleDeliveryCli.runModuleDeliveryCli(Bun.argv);
}
