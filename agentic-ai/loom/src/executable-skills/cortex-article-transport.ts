import type { RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

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

enum CortexArticleRequestBlockKind {
  Definition = 'definition',
  Heading = 'heading',
  Html = 'html',
  List = 'list',
  Paragraph = 'paragraph',
  Structure = 'structure',
}

type CortexArticleRequestBlock =
  | {
      readonly depth: number;
      readonly line: number;
      readonly text: string;
      readonly type: CortexArticleRequestBlockKind.Heading;
    }
  | {
      readonly line: number;
      readonly type:
        | CortexArticleRequestBlockKind.Paragraph
        | CortexArticleRequestBlockKind.Definition
        | CortexArticleRequestBlockKind.Structure;
    }
  | {
      readonly line: number;
      readonly ordered: boolean;
      readonly type: CortexArticleRequestBlockKind.List;
    }
  | {
      readonly comment: boolean;
      readonly line: number;
      readonly type: CortexArticleRequestBlockKind.Html;
    };

type NormalizedRequestDocument = {
  readonly relativePath: string;
  readonly blocks: readonly CortexArticleRequestBlock[];
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
export const CORTEX_ARTICLE_RESULT_KIND =
  'cortex-article-structure-findings-v1';
const RESULT_KEYS = ['kind', 'findings'] as const;
const FINDING_KEYS = ['code', 'file', 'line', 'message'] as const;
const FINDING_CODES = new Set<string>(Object.values(CortexArticleFindingCode));

export function encodeCortexArticleRequest(
  args: EncodeCortexArticleRequestArgs,
): string {
  const documents = args.documents.map(normalizeDocument);
  const request = {
    kind: REQUEST_KIND,
    documents,
    migrationBaselineEntries: args.migrationBaselineEntries,
    migrationLedger: args.migrationLedger,
  };
  return JSON.stringify(request);
}

function normalizeDocument(
  document: CortexArticleRequestDocument,
): NormalizedRequestDocument {
  const parser = unified().use(remarkParse).use(remarkGfm);
  const root = parser.parse(document.content);
  return {
    relativePath: document.relativePath,
    blocks: root.children.map(normalizeBlock),
  };
}

function normalizeBlock(node: RootContent): CortexArticleRequestBlock {
  const line = node.position?.start.line;
  if (typeof line !== 'number' || !Number.isSafeInteger(line) || line < 1) {
    throw new Error('Cortex article source block has no valid source line.');
  }
  if (node.type === 'heading') {
    return {
      depth: node.depth,
      line,
      text: nodeText(node),
      type: CortexArticleRequestBlockKind.Heading,
    };
  }
  if (node.type === 'paragraph' || node.type === 'definition') {
    return {
      line,
      type:
        node.type === 'paragraph'
          ? CortexArticleRequestBlockKind.Paragraph
          : CortexArticleRequestBlockKind.Definition,
    };
  }
  if (node.type === 'list') {
    return {
      line,
      ordered: node.ordered === true,
      type: CortexArticleRequestBlockKind.List,
    };
  }
  if (node.type === 'html') {
    return {
      comment: /^\s*<!--[\s\S]*-->\s*$/u.test(node.value),
      line,
      type: CortexArticleRequestBlockKind.Html,
    };
  }
  return { line, type: CortexArticleRequestBlockKind.Structure };
}

function nodeText(node: RootContent): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  if (!('children' in node)) return '';
  return node.children.map((child) => nodeText(child as RootContent)).join('');
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
    result.kind !== CORTEX_ARTICLE_RESULT_KIND ||
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
