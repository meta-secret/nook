import { err, ok, type Result } from 'neverthrow';
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
  private isTransportRecord(
    value: unknown,
  ): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && Boolean(value) && !Array.isArray(value);
  }

  private constructor(private readonly request: string) {}

  static from(serialized: string): CortexDocumentMapTransport {
    return new CortexDocumentMapTransport(serialized);
  }

  public execute(): Result<
    AuditCortexDocumentMapRequest,
    CortexDocumentMapRequestDecodeError
  > {
    const serialized = this.request;
    if (
      UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_DOCUMENT_MAP_REQUEST_BYTE_LIMIT
    ) {
      return err(
        this.failure({
          message: 'Request exceeds its byte bound.',
          path: '',
        }),
      );
    }
    let transport: unknown;
    try {
      transport = JSON.parse(serialized);
    } catch {
      return err(
        this.failure({
          message: 'Invalid Cortex document-map request.',
          path: '',
        }),
      );
    }
    if (!this.isRecord(transport)) {
      return err(
        this.failure({
          message: 'Invalid Cortex document-map request.',
          path: '',
        }),
      );
    }
    const shape = this.assertExactKeys({
      value: transport,
      expected: REQUEST_KEYS,
      path: '',
    });
    if (shape.isErr()) return err(shape.error);
    if (transport.kind !== CortexDocumentMapContractKind.Request) {
      return err(
        this.failure({
          message: 'Invalid Cortex document-map request kind.',
          path: 'kind',
        }),
      );
    }
    if (
      !Array.isArray(transport.documents) ||
      transport.documents.length > CORTEX_DOCUMENT_MAP_DOCUMENT_LIMIT
    ) {
      return err(
        this.failure({
          message: 'Invalid Cortex document collection.',
          path: 'documents',
        }),
      );
    }
    if (
      !Array.isArray(transport.excludedDocumentPaths) ||
      transport.excludedDocumentPaths.length >
        CORTEX_DOCUMENT_MAP_EXCLUDED_PATH_LIMIT
    ) {
      return err(
        this.failure({
          message: 'Invalid excluded document paths.',
          path: 'excludedDocumentPaths',
        }),
      );
    }
    const documents: CortexDocumentMapDocument[] = [];
    for (const [index, document] of transport.documents.entries()) {
      const decoded = this.decodeDocument({ transport: document, index });
      if (decoded.isErr()) return err(decoded.error);
      documents.push(decoded.value);
    }
    const documentPaths = new Set<string>();
    for (const [index, document] of documents.entries()) {
      if (documentPaths.has(document.relativePath)) {
        return err(
          this.failure({
            message: 'Duplicate Cortex document path.',
            path: `documents[${index}].relativePath`,
          }),
        );
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
      if (!this.validPath(excludedPath) || !documentPaths.has(excludedPath)) {
        return err(
          this.failure({
            message: 'Invalid excluded Cortex document path.',
            path: fieldPath,
          }),
        );
      }
      if (excludedPaths.has(excludedPath)) {
        return err(
          this.failure({
            message: 'Duplicate excluded Cortex document path.',
            path: fieldPath,
          }),
        );
      }
      excludedPaths.add(excludedPath);
      excludedDocumentPaths.push(excludedPath);
    }
    return ok({
      kind: CortexDocumentMapContractKind.Request,
      documents,
      excludedDocumentPaths,
    });
  }

  decodeResult(): Result<
    CortexDocumentMapResult,
    CortexDocumentMapResultDecodeError
  > {
    const serialized = this.request;
    const capacity = this.assertResultByteLimit(serialized);
    if (capacity.isErr()) return err(capacity.error);
    let transport: unknown;
    try {
      transport = JSON.parse(serialized);
    } catch {
      return err(
        this.resultFailure({
          message: 'Invalid Cortex document-map result.',
          path: '',
        }),
      );
    }
    if (!this.isResultRecord(transport)) {
      return err(
        this.resultFailure({
          message: 'Invalid Cortex document-map result.',
          path: '',
        }),
      );
    }
    const shape = this.assertResultExactKeys({
      value: transport,
      expected: RESULT_KEYS,
      path: '',
    });
    if (shape.isErr()) return err(shape.error);
    if (transport.kind !== CortexDocumentMapContractKind.Result) {
      return err(
        this.resultFailure({
          message: 'Invalid Cortex document-map result kind.',
          path: 'kind',
        }),
      );
    }
    if (
      !Array.isArray(transport.findings) ||
      transport.findings.length > CORTEX_DOCUMENT_MAP_FINDING_LIMIT
    ) {
      return err(
        this.resultFailure({
          message: 'Invalid Cortex document-map findings.',
          path: 'findings',
        }),
      );
    }
    const findings: CortexStructureFinding[] = [];
    for (const [index, findingTransport] of transport.findings.entries()) {
      const finding = this.decodeFinding({
        transport: findingTransport,
        index,
      });
      if (finding.isErr()) return err(finding.error);
      findings.push(finding.value);
    }
    return ok({ kind: CortexDocumentMapContractKind.Result, findings });
  }

  private decodeDocument(
    request: DecodeDocumentRequest,
  ): Result<CortexDocumentMapDocument, CortexDocumentMapRequestDecodeError> {
    const path = `documents[${request.index}]`;
    if (!this.isRecord(request.transport)) {
      return err(
        this.failure({
          message: 'Invalid Cortex document.',
          path,
        }),
      );
    }
    const shape = this.assertExactKeys({
      value: request.transport,
      expected: DOCUMENT_KEYS,
      path,
    });
    if (shape.isErr()) return err(shape.error);
    if (!this.validPath(request.transport.relativePath)) {
      return err(
        this.failure({
          message: 'Invalid Cortex document path.',
          path: `${path}.relativePath`,
        }),
      );
    }
    if (
      typeof request.transport.content !== 'string' ||
      request.transport.content.length > CORTEX_DOCUMENT_MAP_CONTENT_LIMIT ||
      PROHIBITED_CONTENT.test(request.transport.content)
    ) {
      return err(
        this.failure({
          message: 'Invalid Cortex document content.',
          path: `${path}.content`,
        }),
      );
    }
    return ok({
      relativePath: request.transport.relativePath,
      content: request.transport.content,
    });
  }

  private decodeFinding(
    request: DecodeFindingRequest,
  ): Result<CortexStructureFinding, CortexDocumentMapResultDecodeError> {
    const transport = request.transport;
    const path = `findings[${request.index}]`;
    if (!this.isFindingRecord(transport)) {
      return err(
        this.resultFailure({
          message: 'Invalid Cortex finding.',
          path,
        }),
      );
    }
    const shape = this.assertResultExactKeys({
      value: transport,
      expected: FINDING_KEYS,
      path,
    });
    if (shape.isErr()) return err(shape.error);
    const [code = false] = [
      Object.values(CortexStructureFindingCode).find(
        (candidate) => candidate === transport.code,
      ),
    ];
    if (code === false) {
      return err(
        this.resultFailure({
          message: 'Invalid Cortex finding code.',
          path: `${path}.code`,
        }),
      );
    }
    if (!this.validPath(transport.file)) {
      return err(
        this.resultFailure({
          message: 'Invalid Cortex finding path.',
          path: `${path}.file`,
        }),
      );
    }
    if (
      typeof transport.line !== 'number' ||
      !Number.isSafeInteger(transport.line) ||
      transport.line < 1 ||
      transport.line > CORTEX_DOCUMENT_MAP_FINDING_LINE_LIMIT
    ) {
      return err(
        this.resultFailure({
          message: 'Invalid Cortex finding line.',
          path: `${path}.line`,
        }),
      );
    }
    if (
      typeof transport.message !== 'string' ||
      transport.message.length === 0 ||
      transport.message.length > CORTEX_DOCUMENT_MAP_FINDING_MESSAGE_LIMIT ||
      PROHIBITED_CONTENT.test(transport.message)
    ) {
      return err(
        this.resultFailure({
          message: 'Invalid Cortex finding message.',
          path: `${path}.message`,
        }),
      );
    }
    return ok({
      code,
      file: transport.file,
      line: transport.line,
      message: transport.message,
    });
  }

  private validPath(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      value.length <= CORTEX_DOCUMENT_MAP_PATH_LIMIT &&
      CORTEX_PATH.test(value)
    );
  }

  private isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return this.isTransportRecord(value);
  }

  private isResultRecord(
    value: unknown,
  ): value is Readonly<Record<string, unknown>> {
    return this.isTransportRecord(value);
  }

  private isFindingRecord(
    value: unknown,
  ): value is Readonly<Record<string, unknown>> {
    return this.isTransportRecord(value);
  }

  private assertExactKeys(
    request: ExactKeysRequest,
  ): Result<void, CortexDocumentMapRequestDecodeError> {
    if (!this.isTransportRecord(request.value))
      return err(
        this.failure({
          message: 'Invalid Cortex transport object.',
          path: request.path,
        }),
      );
    const actual = Object.keys(request.value);
    const unexpected = actual.find((key) => !request.expected.includes(key));
    if (typeof unexpected === 'string') {
      return err(
        this.failure({
          message: 'Unexpected request field.',
          path: `${request.path}["<unknown-key>"]`,
        }),
      );
    }
    const missing = request.expected.find((key) => !actual.includes(key));
    if (typeof missing === 'string') {
      return err(
        this.failure({
          message: 'Missing request field.',
          path: request.path ? `${request.path}.${missing}` : missing,
        }),
      );
    }
    return ok();
  }

  private assertResultExactKeys(
    request: ResultExactKeysRequest,
  ): Result<void, CortexDocumentMapResultDecodeError> {
    if (!this.isTransportRecord(request.value))
      return err(
        this.resultFailure({
          message: 'Invalid Cortex transport object.',
          path: request.path,
        }),
      );
    const actual = Object.keys(request.value);
    const unexpected = actual.find((key) => !request.expected.includes(key));
    if (typeof unexpected === 'string') {
      return err(
        this.resultFailure({
          message: 'Unexpected result field.',
          path: `${request.path}["<unknown-key>"]`,
        }),
      );
    }
    const missing = request.expected.find((key) => !actual.includes(key));
    if (typeof missing === 'string') {
      return err(
        this.resultFailure({
          message: 'Missing result field.',
          path: request.path ? `${request.path}.${missing}` : missing,
        }),
      );
    }
    return ok();
  }

  private assertResultByteLimit(
    serialized: string,
  ): Result<void, CortexDocumentMapResultDecodeError> {
    if (
      UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_DOCUMENT_MAP_RESULT_BYTE_LIMIT
    ) {
      return err(
        this.resultFailure({
          message: 'Result exceeds its byte bound.',
          path: '',
        }),
      );
    }
    return ok();
  }

  private failure(request: DecodeFailure): CortexDocumentMapRequestDecodeError {
    return new CortexDocumentMapRequestDecodeError(request);
  }

  private resultFailure(
    request: DecodeFailure,
  ): CortexDocumentMapResultDecodeError {
    return new CortexDocumentMapResultDecodeError(request);
  }
}

type DecodeFailure = { readonly path: string; readonly message: string };

type ExactKeysRequest = {
  readonly value: Readonly<Record<string, unknown>>;
  readonly expected: readonly string[];
  readonly path: string;
};

type ResultExactKeysRequest = ExactKeysRequest;

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

export class CortexDocumentMapValeReportDecoder {
  private constructor(private readonly serialized: string) {}

  static from(serialized: string): CortexDocumentMapValeReportDecoder {
    return new CortexDocumentMapValeReportDecoder(serialized);
  }

  execute(): CortexDocumentMapValeReport {
    const report: unknown = JSON.parse(this.serialized);
    if (!this.isReport(report)) throw new Error('Invalid Vale report');
    return report;
  }

  private isAlert(value: unknown): value is CortexDocumentMapValeAlert {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    return (
      'Check' in value &&
      typeof value.Check === 'string' &&
      'Line' in value &&
      typeof value.Line === 'number' &&
      'Message' in value &&
      typeof value.Message === 'string' &&
      'Severity' in value &&
      typeof value.Severity === 'string'
    );
  }

  private isReport(value: unknown): value is CortexDocumentMapValeReport {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).every(
        (alerts) =>
          Array.isArray(alerts) && alerts.every((alert) => this.isAlert(alert)),
      )
    );
  }
}

export type CortexDocumentMapValeAlert = {
  readonly Check: string;
  readonly Line: number;
  readonly Message: string;
  readonly Severity: string;
};

export type CortexDocumentMapValeReport = Readonly<
  Record<string, readonly CortexDocumentMapValeAlert[]>
>;

const PROHIBITED_CONTENT =
  /[\u0000\u007f-\u009f\u061c\u200e-\u200f\u2028-\u202e\u2066-\u206f]/u;

export class CortexDocumentMapRequestDecodeError {
  readonly message: string;
  readonly name: string;
  readonly path: string;

  constructor(failure: DecodeFailure) {
    this.message = failure.message;
    this.name = 'CortexDocumentMapRequestDecodeError';
    this.path = failure.path;
  }
}

export class CortexDocumentMapResultDecodeError {
  readonly message: string;
  readonly name: string;
  readonly path: string;

  constructor(failure: DecodeFailure) {
    this.message = failure.message;
    this.name = 'CortexDocumentMapResultDecodeError';
    this.path = failure.path;
  }
}

export class CortexDocumentMapRequestEncoding {
  constructor(private readonly request: AuditCortexDocumentMapRequest) {}
  execute(): Result<string, CortexDocumentMapRequestDecodeError> {
    let serialized: string;
    try {
      serialized = JSON.stringify(this.request);
    } catch {
      return err(
        new CortexDocumentMapRequestDecodeError({
          message: 'Invalid Cortex document-map request.',
          path: '',
        }),
      );
    }
    return UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_DOCUMENT_MAP_REQUEST_BYTE_LIMIT
      ? err(
          new CortexDocumentMapRequestDecodeError({
            message: 'Request exceeds its byte bound.',
            path: '',
          }),
        )
      : ok(serialized);
  }
}
export class CortexDocumentMapResultEncoding {
  constructor(private readonly result: CortexDocumentMapResult) {}
  execute(): Result<string, CortexDocumentMapResultDecodeError> {
    let serialized: string;
    try {
      serialized = JSON.stringify(this.result);
    } catch {
      return err(
        new CortexDocumentMapResultDecodeError({
          message: 'Invalid Cortex document-map result.',
          path: '',
        }),
      );
    }
    return UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_DOCUMENT_MAP_RESULT_BYTE_LIMIT
      ? err(
          new CortexDocumentMapResultDecodeError({
            message: 'Result exceeds its byte bound.',
            path: '',
          }),
        )
      : ok(serialized);
  }
}
