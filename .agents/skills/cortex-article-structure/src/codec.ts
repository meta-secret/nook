import {
  CortexArticleFindingCode,
  CortexArticleContractKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleMigrationLedger,
  type CortexArticleStructureResult,
} from './domain.ts';

type CortexArticleDocumentTransport = {
  readonly relativePath: string | false;
  readonly content: string | false;
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
const DOCUMENT_KEYS = ['relativePath', 'content'] as const;
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
    transport.findings.length > 50_000
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
  const exactKeysRequest: ExactKeysRequest = {
    value: transport,
    expected: DOCUMENT_KEYS,
  };
  if (
    !transport ||
    !hasExactKeys(exactKeysRequest) ||
    !isSafeRelativePath(transport.relativePath) ||
    typeof transport.content !== 'string'
  ) {
    throw new Error('Invalid Cortex article document.');
  }
  return {
    relativePath: transport.relativePath,
    content: transport.content,
  };
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
    !isNonblankString(transport.message)
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
