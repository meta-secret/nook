import {
  CortexDocumentMapContractKind,
  CORTEX_DOCUMENT_MAP_CONTENT_LIMIT,
  CORTEX_DOCUMENT_MAP_DOCUMENT_LIMIT,
  CORTEX_DOCUMENT_MAP_EXCLUDED_PATH_LIMIT,
  CORTEX_DOCUMENT_MAP_FINDING_LIMIT,
  CORTEX_DOCUMENT_MAP_FINDING_LINE_LIMIT,
  CORTEX_DOCUMENT_MAP_FINDING_MESSAGE_LIMIT,
  CORTEX_DOCUMENT_MAP_PATH_LIMIT,
  CORTEX_DOCUMENT_MAP_REQUEST_BYTE_LIMIT,
  CORTEX_DOCUMENT_MAP_RESULT_BYTE_LIMIT,
  type AuditCortexDocumentMapRequest,
  type CortexDocumentMapDocument,
  type CortexDocumentMapResult,
} from './domain.ts';

import {
  CortexStructureFindingCode,
  type CortexStructureFinding,
} from './cortex-document-structure.ts';

export class CortexDocumentMapTransport {
  private static isTransportRecord(
    value: unknown,
  ): value is { readonly [key: string]: unknown } {
    return typeof value === 'object' && Boolean(value) && !Array.isArray(value);
  }

  private constructor(private readonly request: string) {}

  static encodeCortexDocumentMapRequest(
    request: AuditCortexDocumentMapRequest,
  ): string {
    const serialized = JSON.stringify(request);
    if (
      UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_DOCUMENT_MAP_REQUEST_BYTE_LIMIT
    ) {
      throw CortexDocumentMapTransport.failure({
        message: 'Request exceeds its byte bound.',
        path: '',
      });
    }
    return serialized;
  }

  static from(serialized: string): CortexDocumentMapTransport {
    return new CortexDocumentMapTransport(serialized);
  }

  public execute(): AuditCortexDocumentMapRequest {
    const serialized = this.request;
    if (
      UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_DOCUMENT_MAP_REQUEST_BYTE_LIMIT
    ) {
      throw CortexDocumentMapTransport.failure({
        message: 'Request exceeds its byte bound.',
        path: '',
      });
    }
    let transport: unknown;
    try {
      transport = JSON.parse(serialized);
    } catch {
      throw CortexDocumentMapTransport.failure({
        message: 'Invalid Cortex document-map request.',
        path: '',
      });
    }
    if (!CortexDocumentMapTransport.isRecord(transport)) {
      throw CortexDocumentMapTransport.failure({
        message: 'Invalid Cortex document-map request.',
        path: '',
      });
    }
    CortexDocumentMapTransport.assertExactKeys({
      value: transport,
      expected: REQUEST_KEYS,
      path: '',
    });
    if (transport.kind !== CortexDocumentMapContractKind.Request) {
      throw CortexDocumentMapTransport.failure({
        message: 'Invalid Cortex document-map request kind.',
        path: 'kind',
      });
    }
    if (
      !Array.isArray(transport.documents) ||
      transport.documents.length > CORTEX_DOCUMENT_MAP_DOCUMENT_LIMIT
    ) {
      throw CortexDocumentMapTransport.failure({
        message: 'Invalid Cortex document collection.',
        path: 'documents',
      });
    }
    if (
      !Array.isArray(transport.excludedDocumentPaths) ||
      transport.excludedDocumentPaths.length >
        CORTEX_DOCUMENT_MAP_EXCLUDED_PATH_LIMIT
    ) {
      throw CortexDocumentMapTransport.failure({
        message: 'Invalid excluded document paths.',
        path: 'excludedDocumentPaths',
      });
    }
    const documents: CortexDocumentMapDocument[] = [];
    for (const [index, document] of transport.documents.entries()) {
      documents.push(
        CortexDocumentMapTransport.decodeDocument({
          transport: document,
          index,
        }),
      );
    }
    const documentPaths = new Set<string>();
    for (const [index, document] of documents.entries()) {
      if (documentPaths.has(document.relativePath)) {
        throw CortexDocumentMapTransport.failure({
          message: 'Duplicate Cortex document path.',
          path: `documents[${index}].relativePath`,
        });
      }
      documentPaths.add(document.relativePath);
    }
    const excludedDocumentPaths: string[] = [];
    const excludedPaths = new Set<string>();
    for (const [
      index,
      excludedPath,
    ] of transport.excludedDocumentPaths.entries()) {
      const fieldPath = `excludedDocumentPaths[${index}]`;
      if (
        !CortexDocumentMapTransport.validPath(excludedPath) ||
        !documentPaths.has(excludedPath)
      ) {
        throw CortexDocumentMapTransport.failure({
          message: 'Invalid excluded Cortex document path.',
          path: fieldPath,
        });
      }
      if (excludedPaths.has(excludedPath)) {
        throw CortexDocumentMapTransport.failure({
          message: 'Duplicate excluded Cortex document path.',
          path: fieldPath,
        });
      }
      excludedPaths.add(excludedPath);
      excludedDocumentPaths.push(excludedPath);
    }
    return {
      kind: CortexDocumentMapContractKind.Request,
      documents,
      excludedDocumentPaths,
    };
  }

  static encodeCortexDocumentMapResult(
    result: CortexDocumentMapResult,
  ): string {
    const serialized = JSON.stringify(result);
    CortexDocumentMapTransport.assertResultByteLimit(serialized);
    return serialized;
  }

  static decodeCortexDocumentMapResult(
    serialized: string,
  ): CortexDocumentMapResult {
    CortexDocumentMapTransport.assertResultByteLimit(serialized);
    let transport: unknown;
    try {
      transport = JSON.parse(serialized);
    } catch {
      throw CortexDocumentMapTransport.resultFailure({
        message: 'Invalid Cortex document-map result.',
        path: '',
      });
    }
    if (!CortexDocumentMapTransport.isResultRecord(transport)) {
      throw CortexDocumentMapTransport.resultFailure({
        message: 'Invalid Cortex document-map result.',
        path: '',
      });
    }
    CortexDocumentMapTransport.assertResultExactKeys({
      value: transport,
      expected: RESULT_KEYS,
      path: '',
    });
    if (transport.kind !== CortexDocumentMapContractKind.Result) {
      throw CortexDocumentMapTransport.resultFailure({
        message: 'Invalid Cortex document-map result kind.',
        path: 'kind',
      });
    }
    if (
      !Array.isArray(transport.findings) ||
      transport.findings.length > CORTEX_DOCUMENT_MAP_FINDING_LIMIT
    ) {
      throw CortexDocumentMapTransport.resultFailure({
        message: 'Invalid Cortex document-map findings.',
        path: 'findings',
      });
    }
    const findings: CortexStructureFinding[] = [];
    for (const [index, findingTransport] of transport.findings.entries()) {
      const finding = CortexDocumentMapTransport.decodeFinding({
        transport: findingTransport,
        index,
      });
      findings.push(finding);
    }
    return { kind: CortexDocumentMapContractKind.Result, findings };
  }

  private static decodeDocument(
    request: DecodeDocumentRequest,
  ): CortexDocumentMapDocument {
    const path = `documents[${request.index}]`;
    if (!CortexDocumentMapTransport.isRecord(request.transport)) {
      throw CortexDocumentMapTransport.failure({
        message: 'Invalid Cortex document.',
        path,
      });
    }
    CortexDocumentMapTransport.assertExactKeys({
      value: request.transport,
      expected: DOCUMENT_KEYS,
      path,
    });
    if (!CortexDocumentMapTransport.validPath(request.transport.relativePath)) {
      throw CortexDocumentMapTransport.failure({
        message: 'Invalid Cortex document path.',
        path: `${path}.relativePath`,
      });
    }
    if (
      typeof request.transport.content !== 'string' ||
      request.transport.content.length > CORTEX_DOCUMENT_MAP_CONTENT_LIMIT ||
      PROHIBITED_CONTENT.test(request.transport.content)
    ) {
      throw CortexDocumentMapTransport.failure({
        message: 'Invalid Cortex document content.',
        path: `${path}.content`,
      });
    }
    return {
      relativePath: request.transport.relativePath,
      content: request.transport.content,
    };
  }

  private static decodeFinding(
    request: DecodeFindingRequest,
  ): CortexStructureFinding {
    const transport = request.transport;
    const path = `findings[${request.index}]`;
    if (!CortexDocumentMapTransport.isFindingRecord(transport)) {
      throw CortexDocumentMapTransport.resultFailure({
        message: 'Invalid Cortex finding.',
        path,
      });
    }
    CortexDocumentMapTransport.assertResultExactKeys({
      value: transport,
      expected: FINDING_KEYS,
      path,
    });
    const [code = false] = [
      Object.values(CortexStructureFindingCode).find(
        (candidate) => candidate === transport.code,
      ),
    ];
    if (code === false) {
      throw CortexDocumentMapTransport.resultFailure({
        message: 'Invalid Cortex finding code.',
        path: `${path}.code`,
      });
    }
    if (!CortexDocumentMapTransport.validPath(transport.file)) {
      throw CortexDocumentMapTransport.resultFailure({
        message: 'Invalid Cortex finding path.',
        path: `${path}.file`,
      });
    }
    if (
      typeof transport.line !== 'number' ||
      !Number.isSafeInteger(transport.line) ||
      transport.line < 1 ||
      transport.line > CORTEX_DOCUMENT_MAP_FINDING_LINE_LIMIT
    ) {
      throw CortexDocumentMapTransport.resultFailure({
        message: 'Invalid Cortex finding line.',
        path: `${path}.line`,
      });
    }
    if (
      typeof transport.message !== 'string' ||
      transport.message.length === 0 ||
      transport.message.length > CORTEX_DOCUMENT_MAP_FINDING_MESSAGE_LIMIT ||
      PROHIBITED_CONTENT.test(transport.message)
    ) {
      throw CortexDocumentMapTransport.resultFailure({
        message: 'Invalid Cortex finding message.',
        path: `${path}.message`,
      });
    }
    return {
      code,
      file: transport.file,
      line: transport.line,
      message: transport.message,
    };
  }

  private static validPath(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      value.length <= CORTEX_DOCUMENT_MAP_PATH_LIMIT &&
      CORTEX_PATH.test(value)
    );
  }

  private static isRecord(
    value: unknown,
  ): value is { readonly [key: string]: unknown } {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private static isResultRecord(
    value: unknown,
  ): value is { readonly [key: string]: unknown } {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private static isFindingRecord(
    value: unknown,
  ): value is { readonly [key: string]: unknown } {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private static assertExactKeys(request: ExactKeysRequest): void {
    if (!CortexDocumentMapTransport.isTransportRecord(request.value))
      throw new Error('Invalid Cortex transport object.');
    const actual = Object.keys(request.value);
    const unexpected = actual.find((key) => !request.expected.includes(key));
    if (typeof unexpected === 'string') {
      throw CortexDocumentMapTransport.failure({
        message: 'Unexpected request field.',
        path: `${request.path}["<unknown-key>"]`,
      });
    }
    const missing = request.expected.find((key) => !actual.includes(key));
    if (typeof missing === 'string') {
      throw CortexDocumentMapTransport.failure({
        message: 'Missing request field.',
        path: request.path ? `${request.path}.${missing}` : missing,
      });
    }
  }

  private static assertResultExactKeys(request: {
    readonly value: unknown;
    readonly expected: readonly string[];
    readonly path: string;
  }): void {
    if (!CortexDocumentMapTransport.isTransportRecord(request.value))
      throw new Error('Invalid Cortex transport object.');
    const actual = Object.keys(request.value);
    const unexpected = actual.find((key) => !request.expected.includes(key));
    if (typeof unexpected === 'string') {
      throw CortexDocumentMapTransport.resultFailure({
        message: 'Unexpected result field.',
        path: `${request.path}["<unknown-key>"]`,
      });
    }
    const missing = request.expected.find((key) => !actual.includes(key));
    if (typeof missing === 'string') {
      throw CortexDocumentMapTransport.resultFailure({
        message: 'Missing result field.',
        path: request.path ? `${request.path}.${missing}` : missing,
      });
    }
  }

  private static assertResultByteLimit(serialized: string): void {
    if (
      UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_DOCUMENT_MAP_RESULT_BYTE_LIMIT
    ) {
      throw CortexDocumentMapTransport.resultFailure({
        message: 'Result exceeds its byte bound.',
        path: '',
      });
    }
  }

  private static failure(
    request: DecodeFailure,
  ): CortexDocumentMapRequestDecodeError {
    return new CortexDocumentMapRequestDecodeError(request);
  }

  private static resultFailure(
    request: DecodeFailure,
  ): CortexDocumentMapResultDecodeError {
    return new CortexDocumentMapResultDecodeError(request);
  }
}

type DecodeFailure = { readonly path: string; readonly message: string };

type ExactKeysRequest = {
  readonly value: unknown;
  readonly expected: readonly string[];
  readonly path: string;
};

type DecodeDocumentRequest = {
  readonly transport: unknown;
  readonly index: number;
};

type DecodeFindingRequest = {
  readonly transport: unknown;
  readonly index: number;
};

const REQUEST_KEYS = ['kind', 'documents', 'excludedDocumentPaths'] as const;

const DOCUMENT_KEYS = ['relativePath', 'content'] as const;

const RESULT_KEYS = ['kind', 'findings'] as const;

const FINDING_KEYS = ['code', 'file', 'line', 'message'] as const;

const UTF8_ENCODER = new TextEncoder();

const CORTEX_PATH =
  /^\.cortex\/(?!\.\.?\/)(?!.*\/\.\.?(?:\/|$))(?!.*\\)(?!.*[\u0000-\u001f\u007f-\u009f\u061c\u200e-\u200f\u2028-\u202e\u2066-\u206f])[^/]+(?:\/[^/]+)*\.md$/u;

const PROHIBITED_CONTENT =
  /[\u0000\u007f-\u009f\u061c\u200e-\u200f\u2028-\u202e\u2066-\u206f]/u;

export class CortexDocumentMapRequestDecodeError extends Error {
  readonly path: string;

  constructor(failure: DecodeFailure) {
    super(failure.message);
    this.name = 'CortexDocumentMapRequestDecodeError';
    this.path = failure.path;
  }
}

export class CortexDocumentMapResultDecodeError extends Error {
  readonly path: string;

  constructor(failure: DecodeFailure) {
    super(failure.message);
    this.name = 'CortexDocumentMapResultDecodeError';
    this.path = failure.path;
  }
}
