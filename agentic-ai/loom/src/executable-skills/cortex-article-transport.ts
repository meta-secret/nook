export enum CortexArticleFindingCode {
  InvalidMigrationLedger = 'invalid-article-migration-ledger',
  EmptyArticle = 'empty-article',
  DenseArticle = 'dense-article',
  UnorderedProcedure = 'unordered-procedure',
}

export type CortexArticleFinding = {
  readonly code: CortexArticleFindingCode;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

export type CortexArticleRequestDocument = {
  readonly relativePath: string;
  readonly content: string;
};

export type EncodeCortexArticleRequestArgs = {
  readonly documents: readonly CortexArticleRequestDocument[];
  readonly migrationBaselineEntries: readonly string[] | false;
  readonly migrationLedger: {
    readonly relativePath: string;
    readonly content: string | false;
  };
};

type ResultTransport = {
  readonly kind: string | false;
  readonly findings: readonly FindingTransport[] | false;
};

type FindingTransport = {
  readonly code: string | false;
  readonly file: string | false;
  readonly line: number | false;
  readonly message: string | false;
};

const REQUEST_KIND = 'cortex-article-structure-audit-v1';
const RESULT_KIND = 'cortex-article-structure-findings-v1';
const RESULT_KEYS = ['kind', 'findings'] as const;
const FINDING_KEYS = ['code', 'file', 'line', 'message'] as const;
const FINDING_CODES = new Set<string>(Object.values(CortexArticleFindingCode));

export function encodeCortexArticleRequest(
  args: EncodeCortexArticleRequestArgs,
): string {
  const request = { kind: REQUEST_KIND, ...args };
  return JSON.stringify(request);
}

export function decodeCortexArticleResult(
  serialized: string,
): readonly CortexArticleFinding[] {
  const result = JSON.parse(serialized) as ResultTransport;
  const resultKeysRequest: HasExactKeysRequest = {
    value: result,
    expected: RESULT_KEYS,
  };
  if (
    !result ||
    !hasExactKeys(resultKeysRequest) ||
    result.kind !== RESULT_KIND ||
    !Array.isArray(result.findings) ||
    result.findings.length > 50_000
  ) {
    throw new Error('Invalid executable Cortex article result.');
  }
  return result.findings.map(decodeFinding);
}

function decodeFinding(finding: FindingTransport): CortexArticleFinding {
  const findingKeysRequest: HasExactKeysRequest = {
    value: finding,
    expected: FINDING_KEYS,
  };
  if (
    !finding ||
    !hasExactKeys(findingKeysRequest) ||
    typeof finding.code !== 'string' ||
    !FINDING_CODES.has(finding.code) ||
    !isSafePath(finding.file) ||
    typeof finding.line !== 'number' ||
    !Number.isSafeInteger(finding.line) ||
    finding.line < 1 ||
    typeof finding.message !== 'string' ||
    finding.message.trim() === '' ||
    finding.message.length > 4096
  ) {
    throw new Error('Invalid executable Cortex article finding.');
  }
  return {
    code: finding.code as CortexArticleFindingCode,
    file: finding.file,
    line: finding.line,
    message: finding.message,
  };
}

type HasExactKeysRequest = {
  readonly value: ResultTransport | FindingTransport;
  readonly expected: readonly string[];
};

function hasExactKeys(request: HasExactKeysRequest): boolean {
  const actual = Object.keys(request.value).sort();
  const sortedExpected = [...request.expected].sort();
  if (actual.length !== sortedExpected.length) return false;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== sortedExpected[index]) return false;
  }
  return true;
}

function isSafePath(value: string | false): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('.cortex/') &&
    value
      .split('/')
      .every((part) => part !== '' && part !== '.' && part !== '..')
  );
}
