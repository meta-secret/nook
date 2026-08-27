import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
  CORTEX_ARTICLE_FINDING_LIMIT,
  CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
  CORTEX_ARTICLE_MIGRATION_LEDGER_PATH,
  CORTEX_ARTICLE_PATH_LIMIT,
  CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleMigrationLedger,
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

type CortexArticleMigrationLedgerTransport = {
  readonly relativePath: string | false;
  readonly content: string | false;
};

type CortexArticleRequestTransport = {
  readonly kind: string | false;
  readonly documents: readonly CortexArticleDocumentTransport[] | false;
  readonly migrationBaselineEntries: readonly string[] | false;
  readonly migrationLedger: CortexArticleMigrationLedgerTransport | false;
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
  | CortexArticleMigrationLedgerTransport
  | CortexArticleResultTransport
  | CortexArticleFindingTransport;

type ExactKeysRequest = {
  readonly value: ExactKeyValue;
  readonly expected: readonly string[];
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

const REQUEST_KEYS = [
  'kind',
  'documents',
  'migrationBaselineEntries',
  'migrationLedger',
] as const;
const DOCUMENT_KEYS = ['relativePath', 'blocks'] as const;
const SIMPLE_BLOCK_KEYS = ['kind', 'line'] as const;
const HEADING_BLOCK_KEYS = ['depth', 'kind', 'line', 'text'] as const;
const LEDGER_KEYS = ['relativePath', 'content'] as const;
const RESULT_KEYS = ['kind', 'findings'] as const;
const FINDING_KEYS = ['code', 'file', 'line', 'message'] as const;
const FINDING_CODES = new Set<string>(Object.values(CortexArticleFindingCode));
const UTF8_ENCODER = new TextEncoder();
enum PathControlCodePoint {
  C0Maximum = 0x1f,
  Delete = 0x7f,
}
enum SerializedCortexArticleContract {
  Request = 'request',
  Result = 'result',
}

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
  const byteRequest: AssertSerializedByteLimitRequest = {
    label: SerializedCortexArticleContract.Request,
    maximumBytes: CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
    serialized: serializedRequest,
  };
  assertSerializedByteLimit(byteRequest);
  const transport = JSON.parse(
    serializedRequest,
  ) as CortexArticleRequestTransport;
  if (!transport) throw new Error('Invalid Cortex article-structure request.');
  const exactKeysRequest: ExactKeysRequest = {
    value: transport,
    expected: REQUEST_KEYS,
  };
  if (
    !hasExactKeys(exactKeysRequest) ||
    transport.kind !== CortexArticleContractKind.Request ||
    !Array.isArray(transport.documents) ||
    transport.documents.length > 10_000 ||
    !isCortexMarkdownPathArrayOrFalse(transport.migrationBaselineEntries) ||
    !transport.migrationLedger
  ) {
    throw new Error('Invalid Cortex article-structure request.');
  }
  const documents = transport.documents.map(decodeDocument);
  const documentPaths = new Set<string>();
  for (const document of documents) {
    if (documentPaths.has(document.relativePath)) {
      throw new Error('Duplicate Cortex article document path.');
    }
    documentPaths.add(document.relativePath);
  }
  const migrationLedger = decodeLedger(transport.migrationLedger);
  const request: AuditCortexArticleStructureRequest = {
    kind: CortexArticleContractKind.Request,
    documents,
    migrationBaselineEntries: transport.migrationBaselineEntries,
    migrationLedger,
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

function decodeDocument(
  transport: CortexArticleDocumentTransport,
): CortexArticleDocument {
  if (!transport) throw new Error('Invalid Cortex article document.');
  const exactKeysRequest: ExactKeysRequest = {
    value: transport,
    expected: DOCUMENT_KEYS,
  };
  if (
    !hasExactKeys(exactKeysRequest) ||
    !isCortexMarkdownPath(transport.relativePath) ||
    !Array.isArray(transport.blocks) ||
    transport.blocks.length > 100_000
  ) {
    throw new Error('Invalid Cortex article document.');
  }
  const blocks = transport.blocks.map(decodeBlock);
  let previousLine = 0;
  for (const block of blocks) {
    if (block.line <= previousLine) {
      throw new Error('Cortex article block lines must be strictly ordered.');
    }
    previousLine = block.line;
  }
  return {
    relativePath: transport.relativePath,
    blocks,
  };
}

function decodeBlock(
  transport: CortexArticleBlockTransport,
): CortexArticleSemanticBlock {
  if (!transport || !isPositiveLine(transport.line)) {
    throw new Error('Invalid Cortex article semantic block.');
  }
  const line = transport.line;
  if (transport.kind === CortexArticleSemanticKind.Heading) {
    const exactKeysRequest: ExactKeysRequest = {
      value: transport,
      expected: HEADING_BLOCK_KEYS,
    };
    if (
      !hasExactKeys(exactKeysRequest) ||
      typeof transport.depth !== 'number' ||
      !Number.isInteger(transport.depth) ||
      transport.depth < 1 ||
      transport.depth > 6 ||
      !isBoundedDetail(transport.text)
    ) {
      throw new Error('Invalid Cortex article heading block.');
    }
    return {
      depth: transport.depth,
      kind: CortexArticleSemanticKind.Heading,
      line,
      text: transport.text,
    };
  }
  if (!isSimpleSemanticKind(transport.kind)) {
    throw new Error('Invalid Cortex article semantic block kind.');
  }
  const exactKeysRequest: ExactKeysRequest = {
    value: transport,
    expected: SIMPLE_BLOCK_KEYS,
  };
  if (!hasExactKeys(exactKeysRequest)) {
    throw new Error('Invalid Cortex article semantic block.');
  }
  return { kind: transport.kind, line };
}

function isSimpleSemanticKind(
  kind: string | false,
): kind is
  | CortexArticleSemanticKind.Paragraph
  | CortexArticleSemanticKind.VisibleOrderedList
  | CortexArticleSemanticKind.Structure
  | CortexArticleSemanticKind.Transparent
  | CortexArticleSemanticKind.DensitySeparator {
  return (
    kind === CortexArticleSemanticKind.Paragraph ||
    kind === CortexArticleSemanticKind.VisibleOrderedList ||
    kind === CortexArticleSemanticKind.Structure ||
    kind === CortexArticleSemanticKind.Transparent ||
    kind === CortexArticleSemanticKind.DensitySeparator
  );
}

function decodeLedger(
  transport: CortexArticleMigrationLedgerTransport,
): CortexArticleMigrationLedger {
  if (!transport) throw new Error('Invalid Cortex article migration ledger.');
  const exactKeysRequest: ExactKeysRequest = {
    value: transport,
    expected: LEDGER_KEYS,
  };
  if (
    !hasExactKeys(exactKeysRequest) ||
    transport.relativePath !== CORTEX_ARTICLE_MIGRATION_LEDGER_PATH ||
    !isBoundedLedgerContent(transport.content)
  ) {
    throw new Error('Invalid Cortex article migration ledger.');
  }
  return {
    relativePath: transport.relativePath,
    content: transport.content,
  };
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
  if (request.code === CortexArticleFindingCode.InvalidMigrationLedger) {
    if (request.file !== CORTEX_ARTICLE_MIGRATION_LEDGER_PATH) return false;
    const shapes: readonly DiagnosticShape[] = [
      {
        minimumDetailLength: 1,
        prefix: 'Duplicate article-structure migration exemption: ',
        suffix: '',
      },
      {
        minimumDetailLength: 1,
        prefix: 'Article-structure exemption is not a Cortex Markdown file: ',
        suffix: '',
      },
      {
        minimumDetailLength: 1,
        prefix: 'Article-structure exemption was added after the baseline: ',
        suffix: '',
      },
      {
        minimumDetailLength: 1,
        prefix:
          'Article-structure exemption cannot be verified without the migration baseline: ',
        suffix: '',
      },
    ];
    return shapes.some((shape) => {
      const matchRequest: MatchDiagnosticShapeRequest = {
        message: request.message,
        shape,
      };
      return matchesDiagnosticShape(matchRequest);
    });
  }
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
  if (findings.length > CORTEX_ARTICLE_FINDING_LIMIT) {
    throw new Error(
      'Cortex article request finding capacity exceeds its bound.',
    );
  }
  const result: CortexArticleStructureResult = {
    kind: CortexArticleContractKind.Result,
    findings,
  };
  if (
    utf8ByteLength(JSON.stringify(result)) > CORTEX_ARTICLE_RESULT_BYTE_LIMIT
  ) {
    throw new Error('Cortex article request result budget exceeds its bound.');
  }
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

function isCortexMarkdownPathArrayOrFalse(
  value: readonly string[] | false,
): value is readonly string[] | false {
  return (
    value === false ||
    (Array.isArray(value) &&
      value.length <= 10_000 &&
      value.every((entry) => isCortexMarkdownPath(entry)))
  );
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

function isBoundedLedgerContent(value: string | false): boolean {
  if (value === false) return true;
  if (typeof value !== 'string') return false;
  return value
    .split(/\r?\n/u)
    .every((line) => line.trim().length <= CORTEX_ARTICLE_DETAIL_TEXT_LIMIT);
}

function isPositiveLine(value: number | false): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonblankString(value: string | false): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasPathControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (
      codePoint <= PathControlCodePoint.C0Maximum ||
      codePoint === PathControlCodePoint.Delete
    ) {
      return true;
    }
  }
  return false;
}

function isSafeRelativePath(value: string | false): value is string {
  return (
    isNonblankString(value) &&
    value.length <= CORTEX_ARTICLE_PATH_LIMIT &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !hasPathControlCharacter(value) &&
    value
      .split('/')
      .every((part) => part !== '..' && part !== '.' && part !== '')
  );
}
