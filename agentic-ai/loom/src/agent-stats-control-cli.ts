import {
  decodeAgentStatsAssemblePayload,
  decodeAgentStatsFilePayload,
  type AgentStatsAssembleRequest,
  type AgentStatsFileRequest,
} from './codec/args/agent-stats.ts';
import { AgentStatsOperation } from './codec/enums.ts';
import {
  DecodeStatus,
  fieldIssueMessage,
  type FieldError,
} from './codec/field-error.ts';
import {
  UntrustedYamlPropertyPresence,
  asUntrustedYamlNode,
  isRecord,
  untrustedYamlProperty,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
} from './lib/guards.ts';
import {
  runAgentStatsAssemble,
  runAgentStatsPublish,
  runAgentStatsValidate,
  type AgentStatsReport,
} from './commands/agent-stats.ts';
import { resolveAgentTempPath } from './lib/agent-temp-path.ts';
import {
  OptionalRecordKind,
  loadScratchEventLog,
} from './lib/agent-stats-assemble.ts';
import { findRepoRoot } from './lib/repo.ts';

export enum AgentStatsControlField {
  Operation = 'operation',
  Request = 'request',
}

export type AgentStatsControlRequest =
  | {
      readonly operation: AgentStatsOperation.Assemble;
      readonly request: AgentStatsAssembleRequest;
    }
  | {
      readonly operation:
        AgentStatsOperation.Validate | AgentStatsOperation.Publish;
      readonly request: AgentStatsFileRequest;
    };

export function decodeAgentStatsControlRequest(
  serialized: string,
): AgentStatsControlRequest {
  let parsed: UntrustedYamlNode;
  try {
    parsed = asUntrustedYamlNode(JSON.parse(serialized) as UntrustedYamlNode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Agent statistics control request must be valid JSON: ${message}`,
    );
  }
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).length !== 2 ||
    Object.keys(parsed).some(
      (key) =>
        key !== AgentStatsControlField.Operation &&
        key !== AgentStatsControlField.Request,
    )
  ) {
    throw new Error(
      'Agent statistics control request must contain exactly operation and request.',
    );
  }
  const operation = untrustedYamlProperty({
    record: parsed,
    key: AgentStatsControlField.Operation,
  });
  const request = untrustedYamlProperty({
    record: parsed,
    key: AgentStatsControlField.Request,
  });
  if (
    operation.presence === UntrustedYamlPropertyPresence.Absent ||
    request.presence === UntrustedYamlPropertyPresence.Absent
  ) {
    throw new Error(
      'Agent statistics control request requires operation and request.',
    );
  }
  switch (operation.value) {
    case AgentStatsOperation.Assemble: {
      const decoded = decodeAgentStatsAssemblePayload({
        value: request.value,
        path: AgentStatsControlField.Request,
      });
      if (decoded.status === DecodeStatus.Failed) {
        throw new Error(decodeFailure(decoded.errors));
      }
      if (decoded.value.includeTestInventory) {
        throw new Error(
          'Local test inventory collection is prohibited; supply hosted exact-head inventory in the scratch log.',
        );
      }
      return {
        operation: AgentStatsOperation.Assemble,
        request: decoded.value,
      };
    }
    case AgentStatsOperation.Validate:
    case AgentStatsOperation.Publish: {
      const decoded = decodeAgentStatsFilePayload({
        value: request.value,
        path: AgentStatsControlField.Request,
      });
      if (decoded.status === DecodeStatus.Failed) {
        throw new Error(decodeFailure(decoded.errors));
      }
      return { operation: operation.value, request: decoded.value };
    }
    default:
      throw new Error('Agent statistics control operation is not supported.');
  }
}

export async function executeAgentStatsControlRequest(
  request: AgentStatsControlRequest,
): Promise<AgentStatsReport> {
  switch (request.operation) {
    case AgentStatsOperation.Assemble:
      requireHostedTestInventory(request.request);
      return runAgentStatsAssemble(request.request);
    case AgentStatsOperation.Validate:
      return runAgentStatsValidate(request.request);
    case AgentStatsOperation.Publish:
      return runAgentStatsPublish(request.request);
  }
}

export function requireHostedTestInventory(
  request: AgentStatsAssembleRequest,
): void {
  const repoRoot = findRepoRoot();
  const scratchPath = resolveAgentTempPath({
    repoRoot,
    authoredPath: request.scratchPath,
  });
  const scratch = loadScratchEventLog(scratchPath);
  assertHostedTestInventory(
    scratch.test_inventory.kind === OptionalRecordKind.Present
      ? scratch.test_inventory.value
      : false,
  );
}

export function assertHostedTestInventory(
  inventory: UntrustedYamlMap | false,
): void {
  if (!inventory) {
    hostedTestInventoryFailure();
  }
}

function hostedTestInventoryFailure(): never {
  throw new Error(
    'Agent statistics assembly requires typed test_inventory from hosted exact-head validation.',
  );
}

function decodeFailure(errors: readonly FieldError[]): string {
  return errors
    .map((error) => `${error.path}: ${fieldIssueMessage(error)}`)
    .join('\n');
}

if (import.meta.main) {
  const serialized = await Bun.stdin.text();
  const request = decodeAgentStatsControlRequest(serialized);
  const report = await executeAgentStatsControlRequest(request);
  console.log(JSON.stringify(report));
}
