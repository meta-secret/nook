import { expect, test } from 'bun:test';
import {
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  type CortexArticleDocument,
} from '../src/domain.ts';
import { audit, type MakeAuditRequest } from './support.ts';

const documents: readonly CortexArticleDocument[] = [
  {
    relativePath: '.cortex/legacy.md',
    blocks: [
      {
        depth: 2,
        kind: CortexArticleSemanticKind.Heading,
        line: 1,
        text: 'Empty legacy article',
      },
      { kind: CortexArticleSemanticKind.Paragraph, line: 3 },
    ],
  },
];

const emptyDocuments: readonly CortexArticleDocument[] = [
  {
    relativePath: '.cortex/legacy.md',
    blocks: [
      {
        depth: 2,
        kind: CortexArticleSemanticKind.Heading,
        line: 1,
        text: 'Empty legacy article',
      },
    ],
  },
];

test('exempts cataloged baseline entries', () => {
  const request: MakeAuditRequest = {
    documents: emptyDocuments,
    migrationBaselineEntries: ['.cortex/legacy.md'],
    migrationLedgerContent: '.cortex/legacy.md\n',
  };
  expect(audit(request)).toEqual([]);
});

test('reports duplicate entries with exact source details', () => {
  const request: MakeAuditRequest = {
    documents,
    migrationBaselineEntries: ['.cortex/legacy.md'],
    migrationLedgerContent: '.cortex/legacy.md\n.cortex/legacy.md\n',
  };
  expect(audit(request)).toEqual([
    {
      code: CortexArticleFindingCode.InvalidMigrationLedger,
      file: '.cortex/article-structure-migration.txt',
      line: 2,
      message:
        'Duplicate article-structure migration exemption: .cortex/legacy.md',
    },
  ]);
});

test('reports uncataloged entries with exact source details', () => {
  const request: MakeAuditRequest = {
    documents,
    migrationBaselineEntries: false,
    migrationLedgerContent: '# comment\n\n.cortex/missing.md\n',
  };
  expect(audit(request)).toEqual([
    {
      code: CortexArticleFindingCode.InvalidMigrationLedger,
      file: '.cortex/article-structure-migration.txt',
      line: 3,
      message:
        'Article-structure exemption is not a Cortex Markdown file: .cortex/missing.md',
    },
  ]);
});

test('reports post-baseline entries with exact source details', () => {
  const request: MakeAuditRequest = {
    documents,
    migrationBaselineEntries: [],
    migrationLedgerContent: '.cortex/legacy.md\n',
  };
  expect(audit(request)).toEqual([
    {
      code: CortexArticleFindingCode.InvalidMigrationLedger,
      file: '.cortex/article-structure-migration.txt',
      line: 1,
      message:
        'Article-structure exemption was added after the baseline: .cortex/legacy.md',
    },
  ]);
});

test('rejects exemptions when the migration baseline is unavailable', () => {
  const request: MakeAuditRequest = {
    documents: emptyDocuments,
    migrationBaselineEntries: false,
    migrationLedgerContent: '.cortex/legacy.md\n',
  };
  expect(audit(request)).toEqual([
    {
      code: CortexArticleFindingCode.InvalidMigrationLedger,
      file: '.cortex/article-structure-migration.txt',
      line: 1,
      message:
        'Article-structure exemption cannot be verified without the migration baseline: .cortex/legacy.md',
    },
    {
      code: CortexArticleFindingCode.EmptyArticle,
      file: '.cortex/legacy.md',
      line: 1,
      message: 'Article #Empty legacy article has no body content.',
    },
  ]);
});

test('missing ledgers do not exempt empty documents', () => {
  const request: MakeAuditRequest = {
    documents: emptyDocuments,
    migrationLedgerContent: false,
  };
  expect(audit(request).map((finding) => finding.code)).toEqual([
    CortexArticleFindingCode.EmptyArticle,
  ]);
});
