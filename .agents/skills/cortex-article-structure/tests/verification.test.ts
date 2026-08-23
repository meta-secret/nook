import { expect, test } from 'bun:test';
import { auditCortexArticleStructure } from '../src/audit.ts';
import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  type AuditCortexArticleStructureRequest,
  type CortexArticleFinding,
  type CortexArticleStructureResult,
} from '../src/domain.ts';
import { verifyCortexArticleStructureResult } from '../src/verification.ts';

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
      content: CONTENT,
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
      'Article #Recovery procedure has more than 3 consecutive prose blocks without visible structure.',
  },
  {
    code: CortexArticleFindingCode.UnorderedProcedure,
    file: '.cortex/recovery.md',
    line: 13,
    message:
      'Procedure-like article #Recovery procedure must expose its action sequence as an ordered list.',
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
        content: '# Recovery\n',
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
    documents: [{ relativePath: '.cortex/example.md', content }],
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
      { relativePath: '.cortex/exempted.md', content: '# Exempted\n' },
      {
        relativePath: '.cortex/post-baseline.md',
        content: '# Post baseline\n',
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
