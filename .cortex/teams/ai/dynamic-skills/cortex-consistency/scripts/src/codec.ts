import {
  CortexConsistencyContractKind,
  CORTEX_CONSISTENCY_DOCUMENT_LIMIT,
  CORTEX_CONSISTENCY_PATH_LIMIT,
  CORTEX_CONSISTENCY_REFERENCE_LIMIT,
  CORTEX_CONSISTENCY_REQUEST_BYTE_LIMIT,
  type CompileCortexContractsRequest,
  type CortexContractDocument,
} from './domain.ts';

type CortexConsistencyDocumentTransport = {
  readonly relativePath: string | false;
  readonly references: readonly (string | false)[] | false;
  readonly commands: readonly (string | false)[] | false;
};

type CortexConsistencyRequestTransport = {
  readonly kind: string | false;
  readonly documents: readonly CortexConsistencyDocumentTransport[] | false;
};

const REQUEST_KEYS = ['kind', 'documents'] as const;
enum CortexConsistencyDocumentField {
  RelativePath = 'relativePath',
  References = 'references',
  Commands = 'commands',
}
const DOCUMENT_KEYS = Object.values(CortexConsistencyDocumentField);
const UTF8_ENCODER = new TextEncoder();

export class CortexConsistencyRequestDecodeError extends Error {
  readonly path: string;

  constructor(path: string) {
    super('Invalid Cortex consistency request.');
    this.name = 'CortexConsistencyRequestDecodeError';
    this.path = path;
  }
}

export function decodeCortexConsistencyRequest(
  serialized: string,
): CompileCortexContractsRequest {
  if (
    UTF8_ENCODER.encode(serialized).byteLength >
    CORTEX_CONSISTENCY_REQUEST_BYTE_LIMIT
  ) {
    throw new CortexConsistencyRequestDecodeError('');
  }
  let transport: CortexConsistencyRequestTransport;
  try {
    transport = JSON.parse(serialized) as CortexConsistencyRequestTransport;
  } catch {
    throw new CortexConsistencyRequestDecodeError('');
  }
  if (!transport || !exactKeys({ value: transport, expected: REQUEST_KEYS })) {
    throw new CortexConsistencyRequestDecodeError('');
  }
  if (transport.kind !== CortexConsistencyContractKind.Request) {
    throw new CortexConsistencyRequestDecodeError('kind');
  }
  if (
    !Array.isArray(transport.documents) ||
    transport.documents.length > CORTEX_CONSISTENCY_DOCUMENT_LIMIT
  ) {
    throw new CortexConsistencyRequestDecodeError('documents');
  }
  const documents: CortexContractDocument[] = [];
  const paths = new Set<string>();
  for (const [index, candidate] of transport.documents.entries()) {
    const path = `documents[${index}]`;
    if (
      !candidate ||
      !exactKeys({ value: candidate, expected: DOCUMENT_KEYS })
    ) {
      throw new CortexConsistencyRequestDecodeError(path);
    }
    if (
      typeof candidate.relativePath !== 'string' ||
      candidate.relativePath.length === 0 ||
      candidate.relativePath.length > CORTEX_CONSISTENCY_PATH_LIMIT ||
      paths.has(candidate.relativePath)
    ) {
      throw new CortexConsistencyRequestDecodeError(`${path}.relativePath`);
    }
    if (
      !Array.isArray(candidate.references) ||
      candidate.references.length > CORTEX_CONSISTENCY_REFERENCE_LIMIT ||
      candidate.references.some(
        (reference: string | false) =>
          typeof reference !== 'string' ||
          reference.length > CORTEX_CONSISTENCY_PATH_LIMIT,
      )
    ) {
      throw new CortexConsistencyRequestDecodeError(`${path}.references`);
    }
    if (
      !Array.isArray(candidate.commands) ||
      candidate.commands.length > CORTEX_CONSISTENCY_REFERENCE_LIMIT ||
      candidate.commands.some(
        (command: string | false) =>
          typeof command !== 'string' ||
          command.length > CORTEX_CONSISTENCY_PATH_LIMIT,
      )
    ) {
      throw new CortexConsistencyRequestDecodeError(`${path}.commands`);
    }
    paths.add(candidate.relativePath);
    documents.push({
      relativePath: candidate.relativePath,
      references: candidate.references as readonly string[],
      commands: candidate.commands as readonly string[],
    });
  }
  return {
    kind: CortexConsistencyContractKind.Request,
    documents,
  };
}

type ExactKeysRequest = {
  readonly value:
    CortexConsistencyRequestTransport | CortexConsistencyDocumentTransport;
  readonly expected: readonly string[];
};

function exactKeys(request: ExactKeysRequest): boolean {
  const keys = Object.keys(request.value);
  return (
    keys.length === request.expected.length &&
    keys.every((key) => request.expected.includes(key))
  );
}
