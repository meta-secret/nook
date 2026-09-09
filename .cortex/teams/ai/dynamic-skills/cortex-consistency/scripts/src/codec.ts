import { err, ok, type Result } from 'neverthrow';
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
  private isTransportRecord(
    value: unknown,
  ): value is { readonly [key: string]: unknown } {
    return typeof value === 'object' && Boolean(value) && !Array.isArray(value);
  }

  private constructor(private readonly request: string) {}

  static from(serialized: string): CortexConsistencyRequestDecoder {
    return new CortexConsistencyRequestDecoder(serialized);
  }

  public execute(): Result<
    CompileCortexContractsRequest,
    CortexConsistencyRequestDecodeError
  > {
    const serialized = this.request;
    if (
      UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_CONSISTENCY_REQUEST_BYTE_LIMIT
    ) {
      return err(new CortexConsistencyRequestDecodeError(''));
    }
    let transport: unknown;
    try {
      transport = JSON.parse(serialized);
    } catch {
      return err(new CortexConsistencyRequestDecodeError(''));
    }
    if (
      !this.isTransportRecord(transport) ||
      !this.exactKeys({
        value: transport,
        expected: REQUEST_KEYS,
      })
    ) {
      return err(new CortexConsistencyRequestDecodeError(''));
    }
    if (transport.kind !== CortexConsistencyContractKind.Request) {
      return err(new CortexConsistencyRequestDecodeError('kind'));
    }
    if (
      !Array.isArray(transport.documents) ||
      transport.documents.length > CORTEX_CONSISTENCY_DOCUMENT_LIMIT
    ) {
      return err(new CortexConsistencyRequestDecodeError('documents'));
    }
    const documents: CortexContractDocument[] = [];
    const paths = new Set<string>();
    for (const [index, candidate] of transport.documents.entries()) {
      const path = `documents[${index}]`;
      if (
        !this.isTransportRecord(candidate) ||
        !this.exactKeys({
          value: candidate,
          expected: DOCUMENT_KEYS,
        })
      ) {
        return err(new CortexConsistencyRequestDecodeError(path));
      }
      if (
        typeof candidate.relativePath !== 'string' ||
        candidate.relativePath.length === 0 ||
        candidate.relativePath.length > CORTEX_CONSISTENCY_PATH_LIMIT ||
        paths.has(candidate.relativePath)
      ) {
        return err(
          new CortexConsistencyRequestDecodeError(`${path}.relativePath`),
        );
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
        return err(
          new CortexConsistencyRequestDecodeError(`${path}.references`),
        );
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
        return err(new CortexConsistencyRequestDecodeError(`${path}.commands`));
      }
      paths.add(candidate.relativePath);
      documents.push({
        relativePath: candidate.relativePath,
        references: candidate.references,
        commands: candidate.commands,
      });
    }
    return ok({
      kind: CortexConsistencyContractKind.Request,
      documents,
    });
  }

  private exactKeys(request: ExactKeysRequest): boolean {
    if (!this.isTransportRecord(request.value)) return false;
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

export class CortexConsistencyRequestDecodeError {
  readonly path: string;
  readonly message: string;
  readonly name: string;

  constructor(path: string) {
    this.message = 'Invalid Cortex consistency request.';
    this.name = 'CortexConsistencyRequestDecodeError';
    this.path = path;
  }
}

type ExactKeysRequest = {
  readonly value: unknown;
  readonly expected: readonly string[];
};
