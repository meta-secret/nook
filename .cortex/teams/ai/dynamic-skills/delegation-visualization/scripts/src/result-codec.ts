import {
  DelegationVisualizationContractKind,
  DELEGATION_VISUALIZATION_RESULT_BYTE_LIMIT,
  type DelegationVisualizationResult,
  type RenderDelegationVisualizationRequest,
} from './domain.ts';

enum DelegationVisualizationResultField {
  Kind = 'kind',
  Yaml = 'yaml',
}

type DelegationVisualizationResultTransport = {
  readonly kind: string | false;
  readonly yaml: string | false;
};

const UTF8_ENCODER = new TextEncoder();

export class DelegationVisualizationResultVerificationError extends Error {
  constructor() {
    super('Invalid delegation visualization result.');
    this.name = 'DelegationVisualizationResultVerificationError';
  }
}

export function decodeDelegationVisualizationResult(
  serialized: string,
): DelegationVisualizationResult {
  if (
    UTF8_ENCODER.encode(serialized).byteLength >
    DELEGATION_VISUALIZATION_RESULT_BYTE_LIMIT
  ) {
    throw new DelegationVisualizationResultVerificationError();
  }
  let transport: DelegationVisualizationResultTransport;
  try {
    transport = JSON.parse(
      serialized,
    ) as DelegationVisualizationResultTransport;
  } catch {
    throw new DelegationVisualizationResultVerificationError();
  }
  const expected = Object.values(DelegationVisualizationResultField);
  const keys = transport ? Object.keys(transport) : [];
  if (
    !transport ||
    keys.length !== expected.length ||
    !keys.every((key) =>
      expected.includes(key as DelegationVisualizationResultField),
    ) ||
    transport.kind !== DelegationVisualizationContractKind.Result ||
    typeof transport.yaml !== 'string'
  ) {
    throw new DelegationVisualizationResultVerificationError();
  }
  return {
    kind: DelegationVisualizationContractKind.Result,
    yaml: transport.yaml,
  };
}

type VerifyDelegationVisualizationResultRequest = {
  readonly request: RenderDelegationVisualizationRequest;
  readonly result: DelegationVisualizationResult;
};

export function verifyDelegationVisualizationResult(
  input: VerifyDelegationVisualizationResultRequest,
): DelegationVisualizationResult {
  const expectedLines = ['gizmo:', '  tasks:'];
  for (const task of input.request.tasks) {
    expectedLines.push(`    - id: ${quoteYamlScalar(task.id)}`);
    expectedLines.push(`      team: ${quoteYamlScalar(task.team)}`);
    expectedLines.push(
      `      description: ${quoteYamlScalar(task.description)}`,
    );
    if (task.dependencies.length === 0) {
      expectedLines.push('      depends_on: []');
      continue;
    }
    expectedLines.push('      depends_on:');
    for (const dependency of task.dependencies) {
      expectedLines.push(`        - ${quoteYamlScalar(dependency)}`);
    }
  }
  if (input.result.yaml !== `${expectedLines.join('\n')}\n`) {
    throw new DelegationVisualizationResultVerificationError();
  }
  return input.result;
}

function quoteYamlScalar(value: string): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    throw new DelegationVisualizationResultVerificationError();
  }
  return serialized;
}
