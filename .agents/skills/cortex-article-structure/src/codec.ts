import {
  CortexArticleFindingCode,
  CortexArticleBlockKind,
  CortexArticleContractKind,
  CORTEX_ARTICLE_FINDING_LIMIT,
  CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
  CORTEX_ARTICLE_HEADING_TEXT_LIMIT,
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
const FINDING_KEYS = ['code', 'file', 'line', 'message'] as const;
const FINDING_CODES = new Set<string>(Object.values(CortexArticleFindingCode));

export function encodeCortexArticleRequest(
  request: AuditCortexArticleStructureRequest,
): string {
  return JSON.stringify(request);
}

export function decodeCortexArticleRequest(
  serializedRequest: string,
): AuditCortexArticleStructureRequest {
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
  return JSON.stringify(result);
}

export function decodeCortexArticleResult(
  serializedResult: string,
): CortexArticleStructureResult {
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

function assertRequestFindingCapacity(
  request: AssertRequestFindingCapacityRequest,
): void {
  let capacity = 0;
  for (const document of request.documents) {
    const capacityRequest: BoundedFindingCapacityRequest = {
      added: document.blocks.length,
      current: capacity,
    };
    capacity = boundedFindingCapacity(capacityRequest);
  }
  if (request.migrationLedger.content === false) return;
  for (const line of request.migrationLedger.content.split(/\r?\n/u)) {
    const entry = line.trim();
    if (entry.length === 0 || entry.startsWith('#')) continue;
    const capacityRequest: BoundedFindingCapacityRequest = {
      added: 1,
      current: capacity,
    };
    capacity = boundedFindingCapacity(capacityRequest);
  }
}

type BoundedFindingCapacityRequest = {
  readonly added: number;
  readonly current: number;
};

function boundedFindingCapacity(
  request: BoundedFindingCapacityRequest,
): number {
  if (request.added > CORTEX_ARTICLE_FINDING_LIMIT - request.current) {
    throw new Error(
      'Cortex article request finding capacity exceeds its bound.',
    );
  }
  return request.current + request.added;
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
    if (actual[index] !== sortedExpected[index]) return false;
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
