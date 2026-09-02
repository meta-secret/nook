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

type DocumentTransport = {
  readonly relativePath: string | false;
  readonly content: string | false;
};

type RequestTransport = {
  readonly kind: string | false;
  readonly documents: readonly DocumentTransport[] | false;
  readonly excludedDocumentPaths: readonly string[] | false;
};

type FindingTransport = {
  readonly code: string | false;
  readonly file: string | false;
  readonly line: number | false;
  readonly message: string | false;
};

type ResultTransport = {
  readonly kind: string | false;
  readonly findings: readonly FindingTransport[] | false;
};

type DecodeFailure = { readonly path: string; readonly message: string };
type ExactKeysRequest = {
  readonly value: RequestTransport | DocumentTransport;
  readonly expected: readonly string[];
  readonly path: string;
};
type DecodeDocumentRequest = {
  readonly transport: DocumentTransport;
  readonly index: number;
};
type DecodeFindingRequest = {
  readonly transport: FindingTransport;
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

export function encodeCortexDocumentMapRequest(
  request: AuditCortexDocumentMapRequest,
): string {
  const serialized = JSON.stringify(request);
  if (
    UTF8_ENCODER.encode(serialized).byteLength >
    CORTEX_DOCUMENT_MAP_REQUEST_BYTE_LIMIT
  ) {
    throw failure({ message: 'Request exceeds its byte bound.', path: '' });
  }
  return serialized;
}

export function decodeCortexDocumentMapRequest(
  serialized: string,
): AuditCortexDocumentMapRequest {
  if (
    UTF8_ENCODER.encode(serialized).byteLength >
    CORTEX_DOCUMENT_MAP_REQUEST_BYTE_LIMIT
  ) {
    throw failure({ message: 'Request exceeds its byte bound.', path: '' });
  }
  let transport: RequestTransport;
  try {
    transport = JSON.parse(serialized) as RequestTransport;
  } catch {
    throw failure({
      message: 'Invalid Cortex document-map request.',
      path: '',
    });
  }
  if (!isRecord(transport)) {
    throw failure({
      message: 'Invalid Cortex document-map request.',
      path: '',
    });
  }
  assertExactKeys({ value: transport, expected: REQUEST_KEYS, path: '' });
  if (transport.kind !== CortexDocumentMapContractKind.Request) {
    throw failure({
      message: 'Invalid Cortex document-map request kind.',
      path: 'kind',
    });
  }
  if (
    !Array.isArray(transport.documents) ||
    transport.documents.length > CORTEX_DOCUMENT_MAP_DOCUMENT_LIMIT
  ) {
    throw failure({
      message: 'Invalid Cortex document collection.',
      path: 'documents',
    });
  }
  if (
    !Array.isArray(transport.excludedDocumentPaths) ||
    transport.excludedDocumentPaths.length >
      CORTEX_DOCUMENT_MAP_EXCLUDED_PATH_LIMIT
  ) {
    throw failure({
      message: 'Invalid excluded document paths.',
      path: 'excludedDocumentPaths',
    });
  }
  const documents: CortexDocumentMapDocument[] = [];
  for (const [index, document] of transport.documents.entries()) {
    documents.push(decodeDocument({ transport: document, index }));
  }
  const documentPaths = new Set<string>();
  for (const [index, document] of documents.entries()) {
    if (documentPaths.has(document.relativePath)) {
      throw failure({
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
    if (!validPath(excludedPath) || !documentPaths.has(excludedPath)) {
      throw failure({
        message: 'Invalid excluded Cortex document path.',
        path: fieldPath,
      });
    }
    if (excludedPaths.has(excludedPath)) {
      throw failure({
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

export function encodeCortexDocumentMapResult(
  result: CortexDocumentMapResult,
): string {
  const serialized = JSON.stringify(result);
  assertResultByteLimit(serialized);
  return serialized;
}

export function decodeCortexDocumentMapResult(
  serialized: string,
): CortexDocumentMapResult {
  assertResultByteLimit(serialized);
  let transport: ResultTransport;
  try {
    transport = JSON.parse(serialized) as ResultTransport;
  } catch {
    throw resultFailure({
      message: 'Invalid Cortex document-map result.',
      path: '',
    });
  }
  if (!isResultRecord(transport)) {
    throw resultFailure({
      message: 'Invalid Cortex document-map result.',
      path: '',
    });
  }
  assertResultExactKeys({ value: transport, expected: RESULT_KEYS, path: '' });
  if (transport.kind !== CortexDocumentMapContractKind.Result) {
    throw resultFailure({
      message: 'Invalid Cortex document-map result kind.',
      path: 'kind',
    });
  }
  if (
    !Array.isArray(transport.findings) ||
    transport.findings.length > CORTEX_DOCUMENT_MAP_FINDING_LIMIT
  ) {
    throw resultFailure({
      message: 'Invalid Cortex document-map findings.',
      path: 'findings',
    });
  }
  const findings: CortexStructureFinding[] = [];
  for (const [index, findingTransport] of transport.findings.entries()) {
    const finding = decodeFinding({ transport: findingTransport, index });
    findings.push(finding);
  }
  return { kind: CortexDocumentMapContractKind.Result, findings };
}

function decodeDocument(
  request: DecodeDocumentRequest,
): CortexDocumentMapDocument {
  const path = `documents[${request.index}]`;
  if (!isRecord(request.transport)) {
    throw failure({ message: 'Invalid Cortex document.', path });
  }
  assertExactKeys({ value: request.transport, expected: DOCUMENT_KEYS, path });
  if (!validPath(request.transport.relativePath)) {
    throw failure({
      message: 'Invalid Cortex document path.',
      path: `${path}.relativePath`,
    });
  }
  if (
    typeof request.transport.content !== 'string' ||
    request.transport.content.length > CORTEX_DOCUMENT_MAP_CONTENT_LIMIT ||
    PROHIBITED_CONTENT.test(request.transport.content)
  ) {
    throw failure({
      message: 'Invalid Cortex document content.',
      path: `${path}.content`,
    });
  }
  return {
    relativePath: request.transport.relativePath,
    content: request.transport.content,
  };
}

function decodeFinding(request: DecodeFindingRequest): CortexStructureFinding {
  const path = `findings[${request.index}]`;
  if (!isFindingRecord(request.transport)) {
    throw resultFailure({ message: 'Invalid Cortex finding.', path });
  }
  assertResultExactKeys({
    value: request.transport,
    expected: FINDING_KEYS,
    path,
  });
  const [code = false] = [
    Object.values(CortexStructureFindingCode).find(
      (candidate) => candidate === request.transport.code,
    ),
  ];
  if (code === false) {
    throw resultFailure({
      message: 'Invalid Cortex finding code.',
      path: `${path}.code`,
    });
  }
  if (!validPath(request.transport.file)) {
    throw resultFailure({
      message: 'Invalid Cortex finding path.',
      path: `${path}.file`,
    });
  }
  if (
    typeof request.transport.line !== 'number' ||
    !Number.isSafeInteger(request.transport.line) ||
    request.transport.line < 1 ||
    request.transport.line > CORTEX_DOCUMENT_MAP_FINDING_LINE_LIMIT
  ) {
    throw resultFailure({
      message: 'Invalid Cortex finding line.',
      path: `${path}.line`,
    });
  }
  if (
    typeof request.transport.message !== 'string' ||
    request.transport.message.length === 0 ||
    request.transport.message.length >
      CORTEX_DOCUMENT_MAP_FINDING_MESSAGE_LIMIT ||
    PROHIBITED_CONTENT.test(request.transport.message)
  ) {
    throw resultFailure({
      message: 'Invalid Cortex finding message.',
      path: `${path}.message`,
    });
  }
  return {
    code,
    file: request.transport.file,
    line: request.transport.line,
    message: request.transport.message,
  };
}

function validPath(value: string | false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= CORTEX_DOCUMENT_MAP_PATH_LIMIT &&
    CORTEX_PATH.test(value)
  );
}

function isRecord(value: RequestTransport | DocumentTransport): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isResultRecord(value: ResultTransport): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFindingRecord(value: FindingTransport): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(request: ExactKeysRequest): void {
  const actual = Object.keys(request.value);
  const unexpected = actual.find((key) => !request.expected.includes(key));
  if (typeof unexpected === 'string') {
    throw failure({
      message: 'Unexpected request field.',
      path: `${request.path}["<unknown-key>"]`,
    });
  }
  const missing = request.expected.find(
    (key) => !Object.hasOwn(request.value, key),
  );
  if (typeof missing === 'string') {
    throw failure({
      message: 'Missing request field.',
      path: request.path ? `${request.path}.${missing}` : missing,
    });
  }
}

function assertResultExactKeys(request: {
  readonly value: ResultTransport | FindingTransport;
  readonly expected: readonly string[];
  readonly path: string;
}): void {
  const actual = Object.keys(request.value);
  const unexpected = actual.find((key) => !request.expected.includes(key));
  if (typeof unexpected === 'string') {
    throw resultFailure({
      message: 'Unexpected result field.',
      path: `${request.path}["<unknown-key>"]`,
    });
  }
  const missing = request.expected.find(
    (key) => !Object.hasOwn(request.value, key),
  );
  if (typeof missing === 'string') {
    throw resultFailure({
      message: 'Missing result field.',
      path: request.path ? `${request.path}.${missing}` : missing,
    });
  }
}

function assertResultByteLimit(serialized: string): void {
  if (
    UTF8_ENCODER.encode(serialized).byteLength >
    CORTEX_DOCUMENT_MAP_RESULT_BYTE_LIMIT
  ) {
    throw resultFailure({
      message: 'Result exceeds its byte bound.',
      path: '',
    });
  }
}

function failure(request: DecodeFailure): CortexDocumentMapRequestDecodeError {
  return new CortexDocumentMapRequestDecodeError(request);
}

function resultFailure(
  request: DecodeFailure,
): CortexDocumentMapResultDecodeError {
  return new CortexDocumentMapResultDecodeError(request);
}
