import {
  CortexArticleFindingCode,
  CortexArticleFindingMessage,
  CortexArticleBlockKind,
  CortexArticleContractKind,
  CORTEX_ARTICLE_FINDING_LIMIT,
  CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
  CORTEX_ARTICLE_HEADING_TEXT_LIMIT,
  CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
  type AuditCortexArticleStructureRequest,
  type CortexArticleBlock,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleMigrationLedger,
  type CortexArticleStructureResult,
} from './domain.ts';

type CortexArticleDocumentTransport = {
  readonly relativePath: string | false;
  readonly blocks: readonly CortexArticleBlockTransport[] | false;
};

type CortexArticleBlockTransport = {
  readonly comment?: boolean;
  readonly depth?: number;
  readonly line: number | false;
  readonly ordered?: boolean;
  readonly text?: string;
  readonly type: string | false;
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

type ExactKeysRequest = {
  readonly value:
    | CortexArticleRequestTransport
    | CortexArticleDocumentTransport
    | CortexArticleBlockTransport
    | CortexArticleMigrationLedgerTransport
    | CortexArticleResultTransport
    | CortexArticleFindingTransport;
  readonly expected: readonly string[];
};

const REQUEST_KEYS = [
  'kind',
  'documents',
  'migrationBaselineEntries',
  'migrationLedger',
] as const;
const DOCUMENT_KEYS = ['relativePath', 'blocks'] as const;
const SIMPLE_BLOCK_KEYS = ['line', 'type'] as const;
const HEADING_BLOCK_KEYS = ['depth', 'line', 'text', 'type'] as const;
const LIST_BLOCK_KEYS = ['line', 'ordered', 'type'] as const;
const HTML_BLOCK_KEYS = ['comment', 'line', 'type'] as const;
const LEDGER_KEYS = ['relativePath', 'content'] as const;
const RESULT_KEYS = ['kind', 'findings'] as const;
const UTF8_ENCODER = new TextEncoder();

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}
const FINDING_KEYS = ['code', 'file', 'line', 'message'] as const;
const FINDING_CODES = new Set<string>(Object.values(CortexArticleFindingCode));
const EMPTY_RESULT_TRANSPORT: CortexArticleResultTransport = {
  kind: CortexArticleContractKind.Result,
  findings: [],
};
const RESULT_ENVELOPE = JSON.stringify(EMPTY_RESULT_TRANSPORT);
const FINDING_BUDGET_CODE = CortexArticleFindingCode.InvalidMigrationLedger;
const FINDING_BUDGET_MESSAGE = CortexArticleFindingMessage.DenseArticle;

enum SerializedCortexArticleContract {
  Request = 'request',
  Result = 'result',
}

export function encodeCortexArticleRequest(
  request: AuditCortexArticleStructureRequest,
): string {
  const serializedRequest = JSON.stringify(request);
  const byteRequest: AssertSerializedByteLimitRequest = {
    label: SerializedCortexArticleContract.Request,
    maximumBytes: CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
    serialized: serializedRequest,
  };
  assertSerializedByteLimit(byteRequest);
  return serializedRequest;
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
  const exactKeysRequest: ExactKeysRequest = {
    value: transport,
    expected: REQUEST_KEYS,
  };
  if (!transport || !hasExactKeys(exactKeysRequest)) {
    throw new Error('Invalid Cortex article-structure request.');
  }
  if (
    transport.kind !== CortexArticleContractKind.Request ||
    !Array.isArray(transport.documents) ||
    transport.documents.length > 10_000 ||
    !isStringArrayOrFalse(transport.migrationBaselineEntries) ||
    !transport.migrationLedger
  ) {
    throw new Error('Invalid Cortex article-structure request.');
  }
  const documents = transport.documents.map(decodeDocument);
  const migrationLedger = decodeLedger(transport.migrationLedger);
  const capacityRequest: AssertRequestFindingCapacityRequest = {
    documents,
    migrationLedger,
  };
  assertRequestFindingCapacity(capacityRequest);
  return {
    kind: CortexArticleContractKind.Request,
    documents,
    migrationBaselineEntries: transport.migrationBaselineEntries,
    migrationLedger,
  };
}

export function encodeCortexArticleResult(
  result: CortexArticleStructureResult,
): string {
  const serializedResult = JSON.stringify(result);
  const byteRequest: AssertSerializedByteLimitRequest = {
    label: SerializedCortexArticleContract.Result,
    maximumBytes: CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
    serialized: serializedResult,
  };
  assertSerializedByteLimit(byteRequest);
  return serializedResult;
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
  const exactKeysRequest: ExactKeysRequest = {
    value: transport,
    expected: RESULT_KEYS,
  };
  if (
    !transport ||
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

type AssertRequestFindingCapacityRequest = {
  readonly documents: readonly CortexArticleDocument[];
  readonly migrationLedger: CortexArticleMigrationLedger;
};

type FindingBudget = {
  readonly findings: number;
  readonly serializedBytes: number;
};

type AddPotentialFindingsRequest = {
  readonly budget: FindingBudget;
  readonly count: number;
  readonly relativePath: string;
};

function assertRequestFindingCapacity(
  request: AssertRequestFindingCapacityRequest,
): void {
  assertFindingBudgetVocabulary();
  let budget: FindingBudget = {
    findings: 0,
    serializedBytes: utf8ByteLength(RESULT_ENVELOPE),
  };
  for (const document of request.documents) {
    const capacityRequest: AddPotentialFindingsRequest = {
      budget,
      count: document.blocks.length,
      relativePath: document.relativePath,
    };
    budget = addPotentialFindings(capacityRequest);
  }
  if (request.migrationLedger.content === false) return;
  let ledgerEntries = 0;
  for (const line of request.migrationLedger.content.split(/\r?\n/u)) {
    const entry = line.trim();
    if (entry.length === 0 || entry.startsWith('#')) continue;
    ledgerEntries += 1;
  }
  const capacityRequest: AddPotentialFindingsRequest = {
    budget,
    count: ledgerEntries,
    relativePath: request.migrationLedger.relativePath,
  };
  budget = addPotentialFindings(capacityRequest);
  if (budget.serializedBytes > CORTEX_ARTICLE_RESULT_BYTE_LIMIT) {
    throw new Error('Cortex article request result budget exceeds its bound.');
  }
}

function addPotentialFindings(
  request: AddPotentialFindingsRequest,
): FindingBudget {
  if (request.count > CORTEX_ARTICLE_FINDING_LIMIT - request.budget.findings) {
    throw new Error(
      'Cortex article request finding capacity exceeds its bound.',
    );
  }
  if (request.count === 0) return request.budget;
  const finding: CortexArticleFindingTransport = {
    code: FINDING_BUDGET_CODE,
    file: request.relativePath,
    line: Number.MAX_SAFE_INTEGER,
    message: FINDING_BUDGET_MESSAGE,
  };
  const findingBytes = utf8ByteLength(JSON.stringify(finding));
  const separatorBytes =
    request.count - (request.budget.findings === 0 ? 1 : 0);
  const addedBytes = request.count * findingBytes + separatorBytes;
  if (
    addedBytes >
    CORTEX_ARTICLE_RESULT_BYTE_LIMIT - request.budget.serializedBytes
  ) {
    throw new Error('Cortex article request result budget exceeds its bound.');
  }
  return {
    findings: request.budget.findings + request.count,
    serializedBytes: request.budget.serializedBytes + addedBytes,
  };
}

function assertFindingBudgetVocabulary(): void {
  const codeBudget = utf8ByteLength(JSON.stringify(FINDING_BUDGET_CODE));
  const messageBudget = utf8ByteLength(JSON.stringify(FINDING_BUDGET_MESSAGE));
  for (const code of Object.values(CortexArticleFindingCode)) {
    if (utf8ByteLength(JSON.stringify(code)) > codeBudget) {
      throw new Error('Cortex article finding code budget is incomplete.');
    }
  }
  for (const message of Object.values(CortexArticleFindingMessage)) {
    if (utf8ByteLength(JSON.stringify(message)) > messageBudget) {
      throw new Error('Cortex article finding message budget is incomplete.');
    }
  }
}

type AssertSerializedByteLimitRequest = {
  readonly label: SerializedCortexArticleContract;
  readonly maximumBytes: number;
  readonly serialized: string;
};

function assertSerializedByteLimit(
  request: AssertSerializedByteLimitRequest,
): void {
  if (utf8ByteLength(request.serialized) > request.maximumBytes) {
    throw new Error(`Cortex article ${request.label} exceeds its byte bound.`);
  }
}

function decodeDocument(
  transport: CortexArticleDocumentTransport,
): CortexArticleDocument {
  const exactKeysRequest: ExactKeysRequest = {
    value: transport,
    expected: DOCUMENT_KEYS,
  };
  if (
    !transport ||
    !hasExactKeys(exactKeysRequest) ||
    !isSafeRelativePath(transport.relativePath) ||
    !Array.isArray(transport.blocks) ||
    transport.blocks.length > 100_000
  ) {
    throw new Error('Invalid Cortex article document.');
  }
  return {
    relativePath: transport.relativePath,
    blocks: transport.blocks.map(decodeBlock),
  };
}

function decodeBlock(
  transport: CortexArticleBlockTransport,
): CortexArticleBlock {
  if (!transport || !isPositiveLine(transport.line)) {
    throw new Error('Invalid Cortex article block.');
  }
  const line = transport.line;
  if (transport.type === 'heading') {
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
      typeof transport.text !== 'string' ||
      transport.text.length > CORTEX_ARTICLE_HEADING_TEXT_LIMIT
    ) {
      throw new Error('Invalid Cortex article heading block.');
    }
    return {
      depth: transport.depth,
      line,
      text: transport.text,
      type: CortexArticleBlockKind.Heading,
    };
  }
  if (transport.type === 'list') {
    const exactKeysRequest: ExactKeysRequest = {
      value: transport,
      expected: LIST_BLOCK_KEYS,
    };
    if (
      !hasExactKeys(exactKeysRequest) ||
      typeof transport.ordered !== 'boolean'
    ) {
      throw new Error('Invalid Cortex article list block.');
    }
    return {
      line,
      ordered: transport.ordered,
      type: CortexArticleBlockKind.List,
    };
  }
  if (transport.type === 'html') {
    const exactKeysRequest: ExactKeysRequest = {
      value: transport,
      expected: HTML_BLOCK_KEYS,
    };
    if (
      !hasExactKeys(exactKeysRequest) ||
      typeof transport.comment !== 'boolean'
    ) {
      throw new Error('Invalid Cortex article HTML block.');
    }
    return {
      comment: transport.comment,
      line,
      type: CortexArticleBlockKind.Html,
    };
  }
  if (
    transport.type === 'paragraph' ||
    transport.type === 'definition' ||
    transport.type === 'separator' ||
    transport.type === 'structure'
  ) {
    const exactKeysRequest: ExactKeysRequest = {
      value: transport,
      expected: SIMPLE_BLOCK_KEYS,
    };
    if (!hasExactKeys(exactKeysRequest)) {
      throw new Error('Invalid Cortex article simple block.');
    }
    const type =
      transport.type === 'paragraph'
        ? CortexArticleBlockKind.Paragraph
        : transport.type === 'definition'
          ? CortexArticleBlockKind.Definition
          : transport.type === 'separator'
            ? CortexArticleBlockKind.Separator
            : CortexArticleBlockKind.Structure;
    return { line, type };
  }
  throw new Error('Invalid Cortex article block type.');
}

function isPositiveLine(value: number | false): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function decodeLedger(
  transport: CortexArticleMigrationLedgerTransport,
): CortexArticleMigrationLedger {
  const exactKeysRequest: ExactKeysRequest = {
    value: transport,
    expected: LEDGER_KEYS,
  };
  if (
    !transport ||
    !hasExactKeys(exactKeysRequest) ||
    !isSafeRelativePath(transport.relativePath) ||
    (transport.content !== false && typeof transport.content !== 'string')
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
  const line = transport.line;
  const exactKeysRequest: ExactKeysRequest = {
    value: transport,
    expected: FINDING_KEYS,
  };
  if (
    !transport ||
    !hasExactKeys(exactKeysRequest) ||
    typeof transport.code !== 'string' ||
    !FINDING_CODES.has(transport.code) ||
    !isSafeRelativePath(transport.file) ||
    typeof line !== 'number' ||
    !Number.isSafeInteger(line) ||
    line < 1 ||
    !isNonblankString(transport.message) ||
    transport.message.length > CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT
  ) {
    throw new Error('Invalid Cortex article finding.');
  }
  return {
    code: transport.code as CortexArticleFindingCode,
    file: transport.file,
    line,
    message: transport.message,
  };
}

function hasExactKeys(request: ExactKeysRequest): boolean {
  const actual = Object.keys(request.value).sort();
  const sortedExpected = [...request.expected].sort();
  if (actual.length !== sortedExpected.length) return false;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual.at(index) !== sortedExpected.at(index)) return false;
  }
  return true;
}

function isStringArrayOrFalse(
  value: readonly string[] | false,
): value is readonly string[] | false {
  return (
    value === false ||
    (Array.isArray(value) &&
      value.length <= 10_000 &&
      value.every((entry) => isSafeRelativePath(entry)))
  );
}

function isNonblankString(value: string | false): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeRelativePath(value: string | false): value is string {
  return (
    isNonblankString(value) &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    value.split('/').every((part) => part !== '..' && part !== '')
  );
}
