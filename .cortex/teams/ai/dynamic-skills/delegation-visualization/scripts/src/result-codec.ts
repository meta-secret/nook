import {
  DelegationVisualizationContractKind,
  DELEGATION_VISUALIZATION_RESULT_BYTE_LIMIT,
  type DelegationVisualizationResult,
  type RenderDelegationVisualizationRequest,
} from './domain.ts';

enum DelegationVisualizationResultField {
  Kind = 'kind',
  Tree = 'tree',
}

type DelegationVisualizationResultTransport = {
  readonly kind: string | false;
  readonly tree: string | false;
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
    typeof transport.tree !== 'string'
  ) {
    throw new DelegationVisualizationResultVerificationError();
  }
  return {
    kind: DelegationVisualizationContractKind.Result,
    tree: transport.tree,
  };
}

type VerifyDelegationVisualizationResultRequest = {
  readonly request: RenderDelegationVisualizationRequest;
  readonly result: DelegationVisualizationResult;
};

export function verifyDelegationVisualizationResult(
  input: VerifyDelegationVisualizationResultRequest,
): DelegationVisualizationResult {
  const expectedLines = ['gizmo'];
  const lastTaskIndex = input.request.tasks.length - 1;
  for (const [index, task] of input.request.tasks.entries()) {
    const lastTask = index === lastTaskIndex;
    expectedLines.push(`${lastTask ? '└─' : '├─'} ${task.team}`);
    const dependencySuffix =
      task.dependencies.length === 0
        ? ''
        : ` [after: ${task.dependencies.join(', ')}]`;
    expectedLines.push(
      `${lastTask ? '  ' : '│ '}└─ ${task.description}${dependencySuffix}`,
    );
  }
  if (input.result.tree !== `${expectedLines.join('\n')}\n`) {
    throw new DelegationVisualizationResultVerificationError();
  }
  return input.result;
}
