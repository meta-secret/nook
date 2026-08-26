import { expect, test } from 'bun:test';
import { auditCortexArticleStructure } from '../src/audit.ts';
import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleFinding,
  type CortexArticleStructureResult,
} from '../src/domain.ts';
import {
  verifyCortexArticleStructureResult,
  type VerifyCortexArticleStructureResultRequest,
} from '../src/verification.ts';

const AUDIT_REQUEST: AuditCortexArticleStructureRequest = {
  kind: CortexArticleContractKind.Request,
  documents: [
    {
      relativePath: '.cortex/exempt.md',
      blocks: [
        {
          depth: 2,
          kind: CortexArticleSemanticKind.Heading,
          line: 1,
          text: 'Exempt empty article',
        },
      ],
    },
    {
      relativePath: '.cortex/empty.md',
      blocks: [
        {
          depth: 2,
          kind: CortexArticleSemanticKind.Heading,
          line: 1,
          text: 'Empty article',
        },
      ],
    },
    {
      relativePath: '.cortex/post-baseline.md',
      blocks: [{ kind: CortexArticleSemanticKind.Structure, line: 1 }],
    },
    {
      relativePath: '.cortex/recovery.md',
      blocks: [
        {
          depth: 2,
          kind: CortexArticleSemanticKind.Heading,
          line: 1,
          text: 'Recovery procedure',
        },
        { kind: CortexArticleSemanticKind.Paragraph, line: 3 },
        { kind: CortexArticleSemanticKind.Transparent, line: 4 },
        { kind: CortexArticleSemanticKind.Paragraph, line: 5 },
        { kind: CortexArticleSemanticKind.Paragraph, line: 7 },
        { kind: CortexArticleSemanticKind.Paragraph, line: 9 },
      ],
    },
  ],
  migrationBaselineEntries: [
    '.cortex/exempt.md',
    '.cortex/empty.md',
    '.cortex/recovery.md',
  ],
  migrationLedger: {
    relativePath: '.cortex/article-structure-migration.txt',
    content: [
      '.cortex/exempt.md',
      '.cortex/exempt.md',
      '.cortex/missing.md',
      '.cortex/post-baseline.md',
    ].join('\n'),
  },
};

const EXPECTED_FINDINGS: CortexArticleFinding[] = [
  {
    code: CortexArticleFindingCode.InvalidMigrationLedger,
    file: '.cortex/article-structure-migration.txt',
    line: 2,
    message:
      'Duplicate article-structure migration exemption: .cortex/exempt.md',
  },
  {
    code: CortexArticleFindingCode.InvalidMigrationLedger,
    file: '.cortex/article-structure-migration.txt',
    line: 3,
    message:
      'Article-structure exemption is not a Cortex Markdown file: .cortex/missing.md',
  },
  {
    code: CortexArticleFindingCode.InvalidMigrationLedger,
    file: '.cortex/article-structure-migration.txt',
    line: 4,
    message:
      'Article-structure exemption was added after the baseline: .cortex/post-baseline.md',
  },
  {
    code: CortexArticleFindingCode.EmptyArticle,
    file: '.cortex/empty.md',
    line: 1,
    message: 'Article #Empty article has no body content.',
  },
  {
    code: CortexArticleFindingCode.DenseArticle,
    file: '.cortex/recovery.md',
    line: 9,
    message:
      'Article #Recovery procedure has more than 3 consecutive prose blocks without visible structure.',
  },
  {
    code: CortexArticleFindingCode.UnorderedProcedure,
    file: '.cortex/recovery.md',
    line: 1,
    message:
      'Procedure-like article #Recovery procedure must expose its action sequence as an ordered list.',
  },
];

function resultWith(
  findings: readonly CortexArticleFinding[],
): CortexArticleStructureResult {
  return { kind: CortexArticleContractKind.Result, findings };
}

function expectVerified(
  request: VerifyCortexArticleStructureResultRequest,
): void {
  expect(() => verifyCortexArticleStructureResult(request)).not.toThrow();
}

function expectRejected(
  request: VerifyCortexArticleStructureResultRequest,
): void {
  expect(() => verifyCortexArticleStructureResult(request)).toThrow(
    'semantic verification failed',
  );
}

test('independently accepts the audit result across every diagnostic branch', () => {
  expect(auditCortexArticleStructure(AUDIT_REQUEST)).toEqual(EXPECTED_FINDINGS);
  const verificationRequest: VerifyCortexArticleStructureResultRequest = {
    auditRequest: AUDIT_REQUEST,
    result: resultWith(EXPECTED_FINDINGS),
  };
  expectVerified(verificationRequest);
});

test('rejects missing, reordered, duplicated, and mutated findings', () => {
  const dense = EXPECTED_FINDINGS.at(4);
  const first = EXPECTED_FINDINGS.at(0);
  const second = EXPECTED_FINDINGS.at(1);
  if (!dense || !first || !second) {
    throw new Error('Expected verifier fixture findings.');
  }
  const cases: readonly (readonly CortexArticleFinding[])[] = [
    EXPECTED_FINDINGS.slice(0, -1),
    [second, first, ...EXPECTED_FINDINGS.slice(2)],
    [...EXPECTED_FINDINGS, dense],
    EXPECTED_FINDINGS.map((finding) =>
      finding === dense ? { ...finding, line: finding.line - 1 } : finding,
    ),
    EXPECTED_FINDINGS.map((finding) =>
      finding === dense
        ? { ...finding, code: CortexArticleFindingCode.EmptyArticle }
        : finding,
    ),
    EXPECTED_FINDINGS.map((finding) =>
      finding === dense ? { ...finding, file: '.cortex/other.md' } : finding,
    ),
    EXPECTED_FINDINGS.map((finding) =>
      finding === dense
        ? {
            ...finding,
            message: 'Article #Recovery procedure has no body content.',
          }
        : finding,
    ),
  ];
  for (const findings of cases) {
    const verificationRequest: VerifyCortexArticleStructureResultRequest = {
      auditRequest: AUDIT_REQUEST,
      result: resultWith(findings),
    };
    expectRejected(verificationRequest);
  }
});

test('treats semantic separators and visible ordered lists as policy inputs', () => {
  const structuredRequest: AuditCortexArticleStructureRequest = {
    kind: CortexArticleContractKind.Request,
    documents: [
      {
        relativePath: '.cortex/structured.md',
        blocks: [
          {
            depth: 2,
            kind: CortexArticleSemanticKind.Heading,
            line: 1,
            text: 'Delivery steps',
          },
          { kind: CortexArticleSemanticKind.Paragraph, line: 3 },
          { kind: CortexArticleSemanticKind.Paragraph, line: 5 },
          { kind: CortexArticleSemanticKind.DensitySeparator, line: 6 },
          { kind: CortexArticleSemanticKind.Paragraph, line: 7 },
          { kind: CortexArticleSemanticKind.Paragraph, line: 9 },
          { kind: CortexArticleSemanticKind.VisibleOrderedList, line: 11 },
        ],
      },
    ],
    migrationBaselineEntries: false,
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration.txt',
      content: false,
    },
  };
  const verificationRequest: VerifyCortexArticleStructureResultRequest = {
    auditRequest: structuredRequest,
    result: resultWith([]),
  };
  expect(auditCortexArticleStructure(structuredRequest)).toEqual([]);
  expectVerified(verificationRequest);
});

test('rejects findings rebound to a different semantic request', () => {
  const reboundRequest: AuditCortexArticleStructureRequest = {
    ...AUDIT_REQUEST,
    documents: [],
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration.txt',
      content: false,
    },
  };
  const verificationRequest: VerifyCortexArticleStructureResultRequest = {
    auditRequest: reboundRequest,
    result: resultWith(EXPECTED_FINDINGS),
  };
  expectRejected(verificationRequest);
});
