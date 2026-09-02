import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  CORTEX_ARTICLE_BLOCK_LIMIT,
  CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
  CORTEX_ARTICLE_DOCUMENT_LIMIT,
  CORTEX_ARTICLE_FINDING_LIMIT,
  CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
  CORTEX_ARTICLE_HEADING_DEPTH_LIMIT,
  CORTEX_ARTICLE_PATH_LIMIT,
  CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleSemanticBlock,
  type CortexArticleStructureResult,
} from './domain.ts';
import { auditCortexArticleStructure } from './audit.ts';
type CortexArticleDocumentTransport = {
  readonly relativePath: string | false;
  readonly blocks: readonly CortexArticleBlockTransport[] | false;
};

type CortexArticleBlockTransport = {
  readonly depth: number | false;
  readonly kind: string | false;
  readonly line: number | false;
  readonly text: string | false;
};

type CortexArticleRequestTransport = {
  readonly kind: string | false;
  readonly documents: readonly CortexArticleDocumentTransport[] | false;
};

type CortexArticleRequestDecodeFailure = {
  readonly message: string;
  readonly path: string;
};

type CortexArticleRequestFailure = (
  path: string,
) => CortexArticleRequestDecodeError;

type DecodeDocumentRequest = {
  readonly path: string;
  readonly transport: CortexArticleDocumentTransport;
};

type DecodeBlockRequest = {
  readonly path: string;
  readonly transport: CortexArticleBlockTransport;
};

type FindingContributorRequest = {
  readonly findings: readonly CortexArticleFinding[];
  readonly request: AuditCortexArticleStructureRequest;
};

type CortexArticleFindingTransport = {
  readonly code: string | false;
  readonly file: string | false;
  readonly line: number | false;
  readonly message: string | false;
};

type CortexArticleResultTransport = {
  readonly kind: string | false;
  readonly findings: readonly CortexArticleFindingTransport[] | false;
};

type ExactKeyValue =
  | CortexArticleRequestTransport
  | CortexArticleDocumentTransport
  | CortexArticleBlockTransport
  | CortexArticleResultTransport
  | CortexArticleFindingTransport;

type ExactKeysRequest = {
  readonly value: ExactKeyValue;
  readonly expected: readonly string[];
};

type ExactKeysPathRequest = ExactKeysRequest & {
  readonly path: string;
};

type ContractPathRequest = {
  readonly field: string;
  readonly parent: string;
};

type AssertSerializedByteLimitRequest = {
  readonly label: SerializedCortexArticleContract;
  readonly maximumBytes: number;
  readonly serialized: string;
};

type CanonicalFindingRequest = {
  readonly code: CortexArticleFindingCode;
  readonly file: string;
  readonly message: string;
};

type DiagnosticShape = {
  readonly minimumDetailLength: number;
  readonly prefix: string;
  readonly suffix: string;
};

const REQUEST_KEYS = ['kind', 'documents'] as const;
const DOCUMENT_KEYS = ['relativePath', 'blocks'] as const;
const SIMPLE_BLOCK_KEYS = ['kind', 'line'] as const;
const HEADING_BLOCK_KEYS = ['depth', 'kind', 'line', 'text'] as const;
const RESULT_KEYS = ['kind', 'findings'] as const;
const FINDING_KEYS = ['code', 'file', 'line', 'message'] as const;
const FINDING_CODES = new Set<string>(Object.values(CortexArticleFindingCode));
const PATH_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const UTF8_ENCODER = new TextEncoder();
enum SerializedCortexArticleContract {
  Request = 'request',
  Result = 'result',
}

export class CortexArticleRequestDecodeError extends Error {
  readonly path: string;

  constructor(failure: CortexArticleRequestDecodeFailure) {
    super(failure.message);
    this.name = 'CortexArticleRequestDecodeError';
    this.path = failure.path;
  }
}

const failInvalidRequest = requestFailure(
  'Invalid Cortex article-structure request.',
);
const failInvalidDocument = requestFailure('Invalid Cortex article document.');
const failDuplicateDocument = requestFailure(
  'Duplicate Cortex article document path.',
);
const failInvalidBlock = requestFailure(
  'Invalid Cortex article semantic block.',
);
const failInvalidHeading = requestFailure(
  'Invalid Cortex article heading block.',
);
const failInvalidBlockKind = requestFailure(
  'Invalid Cortex article semantic block kind.',
);
const failNonmonotonicLine = requestFailure(
  'Cortex article block lines must be strictly ordered.',
);
const failFindingCapacity = requestFailure(
  'Cortex article request finding capacity exceeds its bound.',
);
const failResultBudget = requestFailure(
  'Cortex article request result budget exceeds its bound.',
);
const failRequestBytes = requestFailure(
  'Cortex article request exceeds its byte bound.',
);

export function encodeCortexArticleRequest(
  request: AuditCortexArticleStructureRequest,
): string {
  const serialized = JSON.stringify(request);
  const byteRequest: AssertSerializedByteLimitRequest = {
    label: SerializedCortexArticleContract.Request,
    maximumBytes: CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
    serialized,
  };
  assertSerializedByteLimit(byteRequest);
  return serialized;
}

export function decodeCortexArticleRequest(
  serializedRequest: string,
): AuditCortexArticleStructureRequest {
  if (utf8ByteLength(serializedRequest) > CORTEX_ARTICLE_REQUEST_BYTE_LIMIT) {
    throw failRequestBytes('');
  }
  let transport: CortexArticleRequestTransport;
  try {
    transport = JSON.parse(serializedRequest) as CortexArticleRequestTransport;
  } catch {
    throw failInvalidRequest('');
  }
  if (!transport) {
    throw failInvalidRequest('');
  }
  const exactKeysRequest: ExactKeysPathRequest = {
    value: transport,
    expected: REQUEST_KEYS,
    path: '',
  };
  const exactKeysPath = invalidExactKeysPath(exactKeysRequest);
  if (exactKeysPath !== false) throw failInvalidRequest(exactKeysPath);
  if (transport.kind !== CortexArticleContractKind.Request) {
    throw failInvalidRequest('kind');
  }
  if (
    !Array.isArray(transport.documents) ||
    transport.documents.length > CORTEX_ARTICLE_DOCUMENT_LIMIT
  ) {
    throw failInvalidRequest('documents');
  }
  const documents: CortexArticleDocument[] = [];
  const documentPaths = new Set<string>();
  for (const [index, documentTransport] of transport.documents.entries()) {
    const documentPath = `documents[${index}]`;
    const decodeRequest: DecodeDocumentRequest = {
      path: documentPath,
      transport: documentTransport,
    };
    const document = decodeDocument(decodeRequest);
    if (documentPaths.has(document.relativePath)) {
      throw failDuplicateDocument(`${documentPath}.relativePath`);
    }
    documentPaths.add(document.relativePath);
    documents.push(document);
  }
  const request: AuditCortexArticleStructureRequest = {
    kind: CortexArticleContractKind.Request,
    documents,
  };
  assertRequestFindingCapacity(request);
  return request;
}

export function encodeCortexArticleResult(
  result: CortexArticleStructureResult,
): string {
  const serialized = JSON.stringify(result);
  const byteRequest: AssertSerializedByteLimitRequest = {
    label: SerializedCortexArticleContract.Result,
    maximumBytes: CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
    serialized,
  };
  assertSerializedByteLimit(byteRequest);
  return serialized;
}

export function decodeCortexArticleResult(
  serializedResult: string,
): CortexArticleStructureResult {
  const byteRequest: AssertSerializedByteLimitRequest = {
    label: SerializedCortexArticleContract.Result,
    maximumBytes: CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
    serialized: serializedResult,
  };
  assertSerializedByteLimit(byteRequest);
  const transport = JSON.parse(
    serializedResult,
  ) as CortexArticleResultTransport;
  if (!transport) throw new Error('Invalid Cortex article-structure result.');
  const exactKeysRequest: ExactKeysRequest = {
    value: transport,
    expected: RESULT_KEYS,
  };
  if (
    !hasExactKeys(exactKeysRequest) ||
    transport.kind !== CortexArticleContractKind.Result ||
    !Array.isArray(transport.findings) ||
    transport.findings.length > CORTEX_ARTICLE_FINDING_LIMIT
  ) {
    throw new Error('Invalid Cortex article-structure result.');
  }
  return {
    kind: CortexArticleContractKind.Result,
    findings: transport.findings.map(decodeFinding),
  };
}

function decodeDocument(request: DecodeDocumentRequest): CortexArticleDocument {
  const { path, transport } = request;
  if (!transport) throw failInvalidDocument(path);
  const exactKeysRequest: ExactKeysPathRequest = {
    value: transport,
    expected: DOCUMENT_KEYS,
    path,
  };
  const exactKeysPath = invalidExactKeysPath(exactKeysRequest);
  if (exactKeysPath !== false) throw failInvalidDocument(exactKeysPath);
  if (!isCortexMarkdownPath(transport.relativePath)) {
    throw failInvalidDocument(`${path}.relativePath`);
  }
  if (
    !Array.isArray(transport.blocks) ||
    transport.blocks.length > CORTEX_ARTICLE_BLOCK_LIMIT
  ) {
    throw failInvalidDocument(`${path}.blocks`);
  }
  const blocks: CortexArticleSemanticBlock[] = [];
  let previousLine = 0;
  for (const [index, blockTransport] of transport.blocks.entries()) {
    const blockPath = `${path}.blocks[${index}]`;
    const decodeRequest: DecodeBlockRequest = {
      path: blockPath,
      transport: blockTransport,
    };
    const block = decodeBlock(decodeRequest);
    if (block.line <= previousLine) {
      throw failNonmonotonicLine(`${blockPath}.line`);
    }
    previousLine = block.line;
    blocks.push(block);
  }
  return {
    relativePath: transport.relativePath,
    blocks,
  };
}

function decodeBlock(request: DecodeBlockRequest): CortexArticleSemanticBlock {
  const { path, transport } = request;
  if (!transport) throw failInvalidBlock(path);
  if (!isPositiveLine(transport.line)) {
    throw failInvalidBlock(`${path}.line`);
  }
  const line = transport.line;
  if (transport.kind === CortexArticleSemanticKind.Heading) {
    const exactKeysRequest: ExactKeysPathRequest = {
      value: transport,
      expected: HEADING_BLOCK_KEYS,
      path,
    };
    const exactKeysPath = invalidExactKeysPath(exactKeysRequest);
    if (exactKeysPath !== false) throw failInvalidHeading(exactKeysPath);
    if (
      typeof transport.depth !== 'number' ||
      !Number.isInteger(transport.depth) ||
      transport.depth < 1 ||
      transport.depth > CORTEX_ARTICLE_HEADING_DEPTH_LIMIT
    ) {
      throw failInvalidHeading(`${path}.depth`);
    }
    if (!isBoundedDetail(transport.text)) {
      throw failInvalidHeading(`${path}.text`);
    }
    return {
      depth: transport.depth,
      kind: CortexArticleSemanticKind.Heading,
      line,
      text: transport.text,
    };
  }
  if (!isSimpleSemanticKind(transport.kind)) {
    throw failInvalidBlockKind(`${path}.kind`);
  }
  const exactKeysRequest: ExactKeysPathRequest = {
    value: transport,
    expected: SIMPLE_BLOCK_KEYS,
    path,
  };
  const exactKeysPath = invalidExactKeysPath(exactKeysRequest);
  if (exactKeysPath !== false) throw failInvalidBlock(exactKeysPath);
  return { kind: transport.kind, line };
}

function isSimpleSemanticKind(
  kind: string | false,
): kind is
  | CortexArticleSemanticKind.Paragraph
  | CortexArticleSemanticKind.VisibleOrderedList
  | CortexArticleSemanticKind.Structure
  | CortexArticleSemanticKind.Transparent
  | CortexArticleSemanticKind.DensitySeparator
  | CortexArticleSemanticKind.Table {
  return (
    kind === CortexArticleSemanticKind.Paragraph ||
    kind === CortexArticleSemanticKind.VisibleOrderedList ||
    kind === CortexArticleSemanticKind.Structure ||
    kind === CortexArticleSemanticKind.Transparent ||
    kind === CortexArticleSemanticKind.DensitySeparator ||
    kind === CortexArticleSemanticKind.Table
  );
}

function decodeFinding(
  transport: CortexArticleFindingTransport,
): CortexArticleFinding {
  if (!transport) throw new Error('Invalid Cortex article finding.');
  const exactKeysRequest: ExactKeysRequest = {
    value: transport,
    expected: FINDING_KEYS,
  };
  if (
    !hasExactKeys(exactKeysRequest) ||
    typeof transport.code !== 'string' ||
    !FINDING_CODES.has(transport.code) ||
    !isSafeRelativePath(transport.file) ||
    !isPositiveLine(transport.line) ||
    !isNonblankString(transport.message) ||
    transport.message.length > CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT
  ) {
    throw new Error('Invalid Cortex article finding.');
  }
  const code = transport.code as CortexArticleFindingCode;
  const canonicalRequest: CanonicalFindingRequest = {
    code,
    file: transport.file,
    message: transport.message,
  };
  if (!isCanonicalFinding(canonicalRequest)) {
    throw new Error('Invalid Cortex article finding diagnostics.');
  }
  return {
    code,
    file: transport.file,
    line: transport.line,
    message: transport.message,
  };
}

function isCanonicalFinding(request: CanonicalFindingRequest): boolean {
  if (!isCortexMarkdownPath(request.file)) return false;
  const shape = findingDiagnosticShape(request.code);
  const matchRequest: MatchDiagnosticShapeRequest = {
    message: request.message,
    shape,
  };
  return matchesDiagnosticShape(matchRequest);
}

type MatchDiagnosticShapeRequest = {
  readonly message: string;
  readonly shape: DiagnosticShape;
};

function matchesDiagnosticShape(request: MatchDiagnosticShapeRequest): boolean {
  if (
    !request.message.startsWith(request.shape.prefix) ||
    !request.message.endsWith(request.shape.suffix)
  ) {
    return false;
  }
  const detailLength =
    request.message.length -
    request.shape.prefix.length -
    request.shape.suffix.length;
  return (
    detailLength >= request.shape.minimumDetailLength &&
    detailLength <= CORTEX_ARTICLE_DETAIL_TEXT_LIMIT
  );
}

function findingDiagnosticShape(
  code: CortexArticleFindingCode,
): DiagnosticShape {
  if (code === CortexArticleFindingCode.EmptyArticle) {
    return {
      minimumDetailLength: 0,
      prefix: 'Article #',
      suffix: ' has no body content.',
    };
  }
  if (code === CortexArticleFindingCode.DenseArticle) {
    return {
      minimumDetailLength: 0,
      prefix: 'Article #',
      suffix:
        ' has more than 3 consecutive prose blocks without visible structure.',
    };
  }
  if (code === CortexArticleFindingCode.MarkdownTable) {
    return {
      minimumDetailLength: 0,
      prefix: 'Rendered Markdown table in ',
      suffix: ' is prohibited; use an enclosed structured list.',
    };
  }
  return {
    minimumDetailLength: 0,
    prefix: 'Procedure-like article #',
    suffix: ' must expose its action sequence as an ordered list.',
  };
}

function assertRequestFindingCapacity(
  request: AuditCortexArticleStructureRequest,
): void {
  const findings = auditCortexArticleStructure(request);
  const contributorRequest: FindingContributorRequest = { findings, request };
  const contributor = findingContributorPath(contributorRequest);
  if (findings.length > CORTEX_ARTICLE_FINDING_LIMIT) {
    throw failFindingCapacity(contributor);
  }
  const result: CortexArticleStructureResult = {
    kind: CortexArticleContractKind.Result,
    findings,
  };
  if (
    utf8ByteLength(JSON.stringify(result)) > CORTEX_ARTICLE_RESULT_BYTE_LIMIT
  ) {
    throw failResultBudget(contributor);
  }
}

function findingContributorPath(request: FindingContributorRequest): string {
  const finding = request.findings.at(-1);
  if (!finding) return 'documents';
  const documentIndex = request.request.documents.findIndex(
    (document) => document.relativePath === finding.file,
  );
  if (documentIndex < 0) return 'documents';
  const blockIndex = request.request.documents
    .at(documentIndex)
    ?.blocks.findIndex((block) => block.line === finding.line);
  return typeof blockIndex === 'number' && blockIndex >= 0
    ? `documents[${documentIndex}].blocks[${blockIndex}]`
    : `documents[${documentIndex}]`;
}

function requestFailure(message: string): CortexArticleRequestFailure {
  return (path) => {
    const failure: CortexArticleRequestDecodeFailure = { message, path };
    return new CortexArticleRequestDecodeError(failure);
  };
}

function assertSerializedByteLimit(
  request: AssertSerializedByteLimitRequest,
): void {
  if (utf8ByteLength(request.serialized) > request.maximumBytes) {
    throw new Error(`Cortex article ${request.label} exceeds its byte bound.`);
  }
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function hasExactKeys(request: ExactKeysRequest): boolean {
  const actual = Object.keys(request.value).sort();
  const expected = [...request.expected].sort();
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual.at(index) !== expected.at(index)) return false;
  }
  return true;
}

function invalidExactKeysPath(request: ExactKeysPathRequest): string | false {
  const actual = Object.keys(request.value);
  const unexpected = actual.find((field) => !request.expected.includes(field));
  const missing = request.expected.find((field) => !actual.includes(field));
  if (typeof unexpected === 'string') {
    return `${request.path}["<unknown-key>"]`;
  }
  const field = missing;
  if (typeof field !== 'string') return false;
  const pathRequest: ContractPathRequest = {
    field,
    parent: request.path,
  };
  return contractPath(pathRequest);
}

function contractPath(request: ContractPathRequest): string {
  const simpleField = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
  return simpleField.test(request.field)
    ? `${request.parent}.${request.field}`
    : `${request.parent}[${JSON.stringify(request.field)}]`;
}

function isCortexMarkdownPath(value: string | false): value is string {
  return (
    isSafeRelativePath(value) &&
    value.startsWith('.cortex/') &&
    value.endsWith('.md')
  );
}

function isBoundedDetail(value: string | false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= CORTEX_ARTICLE_DETAIL_TEXT_LIMIT
  );
}

function isPositiveLine(value: number | false): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonblankString(value: string | false): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeRelativePath(value: string | false): value is string {
  return (
    isNonblankString(value) &&
    value.length <= CORTEX_ARTICLE_PATH_LIMIT &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !PATH_CONTROL_CHARACTER.test(value) &&
    value
      .split('/')
      .every((part) => part !== '..' && part !== '.' && part !== '')
  );
}
