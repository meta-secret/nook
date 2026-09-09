import {
  CortexConsistencyContractKind,
  CORTEX_CONSISTENCY_DOCUMENT_LIMIT,
  CORTEX_CONSISTENCY_PATH_LIMIT,
  CORTEX_CONSISTENCY_REFERENCE_LIMIT,
  CORTEX_CONSISTENCY_REQUEST_BYTE_LIMIT,
  type CompileCortexContractsRequest,
  type CortexContractDocument,
} from './domain.ts';

export class CortexConsistencyRequestDecoder {
  private static isTransportRecord(
    value: unknown,
  ): value is { readonly [key: string]: unknown } {
    return typeof value === 'object' && Boolean(value) && !Array.isArray(value);
  }

  private constructor(private readonly request: string) {}

  static from(serialized: string): CortexConsistencyRequestDecoder {
    return new CortexConsistencyRequestDecoder(serialized);
  }

  public execute(): CompileCortexContractsRequest {
    const serialized = this.request;
    if (
      UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_CONSISTENCY_REQUEST_BYTE_LIMIT
    ) {
      throw new CortexConsistencyRequestDecodeError('');
    }
    let transport: unknown;
    try {
      transport = JSON.parse(serialized);
    } catch {
      throw new CortexConsistencyRequestDecodeError('');
    }
    if (
      !CortexConsistencyRequestDecoder.isTransportRecord(transport) ||
      !CortexConsistencyRequestDecoder.exactKeys({
        value: transport,
        expected: REQUEST_KEYS,
      })
    ) {
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
        !CortexConsistencyRequestDecoder.isTransportRecord(candidate) ||
        !CortexConsistencyRequestDecoder.exactKeys({
          value: candidate,
          expected: DOCUMENT_KEYS,
        })
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
        !candidate.references.every(
          (reference: unknown): reference is string =>
            typeof reference === 'string' &&
            reference.length <= CORTEX_CONSISTENCY_PATH_LIMIT,
        )
      ) {
        throw new CortexConsistencyRequestDecodeError(`${path}.references`);
      }
      if (
        !Array.isArray(candidate.commands) ||
        candidate.commands.length > CORTEX_CONSISTENCY_REFERENCE_LIMIT ||
        !candidate.commands.every(
          (command: unknown): command is string =>
            typeof command === 'string' &&
            command.length <= CORTEX_CONSISTENCY_PATH_LIMIT,
        )
      ) {
        throw new CortexConsistencyRequestDecodeError(`${path}.commands`);
      }
      paths.add(candidate.relativePath);
      documents.push({
        relativePath: candidate.relativePath,
        references: candidate.references,
        commands: candidate.commands,
      });
    }
    return {
      kind: CortexConsistencyContractKind.Request,
      documents,
    };
  }

  private static exactKeys(request: ExactKeysRequest): boolean {
    if (!CortexConsistencyRequestDecoder.isTransportRecord(request.value))
      return false;
    const keys = Object.keys(request.value);
    return (
      keys.length === request.expected.length &&
      keys.every((key) => request.expected.includes(key))
    );
  }
}

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

type ExactKeysRequest = {
  readonly value: unknown;
  readonly expected: readonly string[];
};
