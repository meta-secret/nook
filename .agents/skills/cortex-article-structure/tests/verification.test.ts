import { expect, test } from 'bun:test';
import { auditCortexArticleStructure } from '../src/audit.ts';
import {
  CortexArticleContractKind,
  CortexArticleBlockKind,
  CortexArticleFindingCode,
  CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
  CORTEX_ARTICLE_HEADING_TEXT_LIMIT,
  type AuditCortexArticleStructureRequest,
  type CortexArticleFinding,
  type CortexArticleStructureResult,
} from '../src/domain.ts';
import { verifyCortexArticleStructureResult } from '../src/verification.ts';
import { blocksFromMarkdown } from './markdown-fixture.ts';

const CONTENT = `# Recovery

## Relationships

- None.

## Document map

- [Recovery procedure](#recovery-procedure)
  - Defines recovery.
  - Follow after failure.

## Recovery procedure

First paragraph.

Second paragraph.

Third paragraph.

Fourth paragraph.
`;

const AUDIT_REQUEST: AuditCortexArticleStructureRequest = {
  kind: CortexArticleContractKind.Request,
  documents: [
    {
      relativePath: '.cortex/recovery.md',
      blocks: blocksFromMarkdown(CONTENT),
    },
  ],
  migrationBaselineEntries: false,
  migrationLedger: {
    relativePath: '.cortex/article-structure-migration.txt',
    content: false,
  },
};

const CANONICAL_FINDINGS: readonly CortexArticleFinding[] = [
  {
    code: CortexArticleFindingCode.DenseArticle,
    file: '.cortex/recovery.md',
    line: 21,
    message:
      'Article has more than 3 consecutive prose blocks without visible structure.',
  },
  {
    code: CortexArticleFindingCode.UnorderedProcedure,
    file: '.cortex/recovery.md',
    line: 13,
    message:
      'Procedure-like article must expose its action sequence as an ordered list.',
  },
];

function resultWith(
  findings: readonly CortexArticleFinding[],
): CortexArticleStructureResult {
  return {
    kind: CortexArticleContractKind.Result,
    findings,
  };
}

test('accepts only the exact independently derived semantic result', () => {
  const request = {
    auditRequest: AUDIT_REQUEST,
    result: resultWith(CANONICAL_FINDINGS),
  };
  expect(() => verifyCortexArticleStructureResult(request)).not.toThrow();
});

test('keeps maximal accepted heading findings inside the result bound', () => {
  const heading = `Recovery procedure ${'x'.repeat(CORTEX_ARTICLE_HEADING_TEXT_LIMIT - 19)}`;
  const auditRequest: AuditCortexArticleStructureRequest = {
    ...AUDIT_REQUEST,
    documents: [
      {
        relativePath: '.cortex/boundary.md',
        blocks: [
          {
            depth: 2,
            line: 1,
            text: 'Document map',
            type: CortexArticleBlockKind.Heading,
          },
          {
            depth: 2,
            line: 3,
            text: heading,
            type: CortexArticleBlockKind.Heading,
          },
          { line: 5, type: CortexArticleBlockKind.Paragraph },
          { line: 7, type: CortexArticleBlockKind.Paragraph },
          { line: 9, type: CortexArticleBlockKind.Paragraph },
          { line: 11, type: CortexArticleBlockKind.Paragraph },
        ],
      },
    ],
  };
  const findings = auditCortexArticleStructure(auditRequest);
  expect(findings.length).toBe(2);
  expect(
    findings.every(
      (finding) =>
        finding.message.length <= CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
    ),
  ).toBe(true);
  const verificationRequest = {
    auditRequest,
    result: resultWith(findings),
  };
  expect(() =>
    verifyCortexArticleStructureResult(verificationRequest),
  ).not.toThrow();
});

test('does not echo an oversized migration entry into finding messages', () => {
  const oversizedEntry = `.cortex/${'x'.repeat(
    CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT + 1,
  )}.md`;
  const auditRequest: AuditCortexArticleStructureRequest = {
    ...AUDIT_REQUEST,
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration.txt',
      content: oversizedEntry,
    },
  };
  const findings = auditCortexArticleStructure(auditRequest);
  const expectedFinding: CortexArticleFinding = {
    code: CortexArticleFindingCode.InvalidMigrationLedger,
    file: '.cortex/article-structure-migration.txt',
    line: 1,
    message: 'Article-structure exemption is not a Cortex Markdown file.',
  };
  expect(findings[0]).toEqual(expectedFinding);
  expect(
    findings.every(
      (finding) =>
        finding.message.length <= CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
    ),
  ).toBe(true);
  const verificationRequest = {
    auditRequest,
    result: resultWith(findings),
  };
  expect(() =>
    verifyCortexArticleStructureResult(verificationRequest),
  ).not.toThrow();
});

test('rejects missing, empty, incorrect, reordered, rebound, and duplicate findings', () => {
  const denseFinding = CANONICAL_FINDINGS[0];
  const procedureFinding = CANONICAL_FINDINGS[1];
  if (!denseFinding || !procedureFinding) {
    throw new Error('Canonical verifier findings are incomplete.');
  }
  const cases: readonly (readonly CortexArticleFinding[])[] = [
    [],
    [denseFinding],
    [procedureFinding, denseFinding],
    [denseFinding, denseFinding, procedureFinding],
    [
      { ...denseFinding, code: CortexArticleFindingCode.EmptyArticle },
      procedureFinding,
    ],
    [{ ...denseFinding, file: '.cortex/other.md' }, procedureFinding],
    [{ ...denseFinding, line: denseFinding.line - 1 }, procedureFinding],
    [
      { ...denseFinding, message: 'Plausible but incorrect message.' },
      procedureFinding,
    ],
    [
      denseFinding,
      procedureFinding,
      {
        code: CortexArticleFindingCode.EmptyArticle,
        file: '.cortex/recovery.md',
        line: 13,
        message: 'Article has no body content.',
      },
    ],
  ];
  for (const findings of cases) {
    const request = {
      auditRequest: AUDIT_REQUEST,
      result: resultWith(findings),
    };
    expect(() => verifyCortexArticleStructureResult(request)).toThrow(
      'semantic verification failed',
    );
  }

  const reboundRequest: AuditCortexArticleStructureRequest = {
    ...AUDIT_REQUEST,
    documents: [
      {
        relativePath: '.cortex/recovery.md',
        blocks: blocksFromMarkdown('# Recovery\n'),
      },
    ],
  };
  const request = {
    auditRequest: reboundRequest,
    result: resultWith(CANONICAL_FINDINGS),
  };
  expect(() => verifyCortexArticleStructureResult(request)).toThrow(
    'semantic verification failed',
  );
});

test('accepts canonical output across every semantic branch', () => {
  const requests: readonly AuditCortexArticleStructureRequest[] = [
    requestForContent(`# No articles

## Document map
`),
    requestForContent(`# Empty

## Document map

- [Empty article](#empty-article)

## Empty article
`),
    AUDIT_REQUEST,
    requestForContent(`# Clean

## Document map

- [Purpose](#purpose)

## Purpose

- A structured fact.
`),
    exemptedInvalidDocumentRequest(),
    invalidMigrationLedgerRequest(),
  ];
  const observedCodes = new Set<CortexArticleFindingCode>();
  for (const auditRequest of requests) {
    const findings = auditCortexArticleStructure(auditRequest);
    for (const finding of findings) observedCodes.add(finding.code);
    const verificationRequest = {
      auditRequest,
      result: resultWith(findings),
    };
    expect(() =>
      verifyCortexArticleStructureResult(verificationRequest),
    ).not.toThrow();
  }
  expect(observedCodes).toEqual(
    new Set([
      CortexArticleFindingCode.DenseArticle,
      CortexArticleFindingCode.EmptyArticle,
      CortexArticleFindingCode.InvalidMigrationLedger,
      CortexArticleFindingCode.UnorderedProcedure,
    ]),
  );
});

function requestForContent(
  content: string,
): AuditCortexArticleStructureRequest {
  return {
    kind: CortexArticleContractKind.Request,
    documents: [
      {
        relativePath: '.cortex/example.md',
        blocks: blocksFromMarkdown(content),
      },
    ],
    migrationBaselineEntries: false,
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration.txt',
      content: false,
    },
  };
}

function exemptedInvalidDocumentRequest(): AuditCortexArticleStructureRequest {
  const request = requestForContent(`# Exempted

## Document map
`);
  return {
    ...request,
    migrationLedger: {
      ...request.migrationLedger,
      content: '.cortex/example.md\n',
    },
  };
}

function invalidMigrationLedgerRequest(): AuditCortexArticleStructureRequest {
  return {
    kind: CortexArticleContractKind.Request,
    documents: [
      {
        relativePath: '.cortex/exempted.md',
        blocks: blocksFromMarkdown('# Exempted\n'),
      },
      {
        relativePath: '.cortex/post-baseline.md',
        blocks: blocksFromMarkdown('# Post baseline\n'),
      },
    ],
    migrationBaselineEntries: ['.cortex/exempted.md'],
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration.txt',
      content: [
        '.cortex/exempted.md',
        '.cortex/exempted.md',
        '.cortex/missing.md',
        '.cortex/post-baseline.md',
      ].join('\n'),
    },
  };
}
