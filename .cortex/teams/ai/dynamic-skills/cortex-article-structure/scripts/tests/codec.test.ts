import { expect, test } from 'bun:test';
import {
  CortexArticleRequestDecodeError,
  decodeCortexArticleRequest,
  decodeCortexArticleResult,
  encodeCortexArticleRequest,
  encodeCortexArticleResult,
} from '../src/codec.ts';
import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
  CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
  CORTEX_ARTICLE_PATH_LIMIT,
  CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
  type AuditCortexArticleStructureRequest,
  type CortexArticleHeading,
  type CortexArticleSemanticBlock,
  type CortexArticleStructureResult,
} from '../src/domain.ts';

type RequestWithWrites = AuditCortexArticleStructureRequest & {
  readonly allowWrites: boolean;
};

type ResultWithExtra = CortexArticleStructureResult & {
  readonly extra: boolean;
};

const validRequest: AuditCortexArticleStructureRequest = {
  kind: CortexArticleContractKind.Request,
  documents: [
    {
      relativePath: '.cortex/example.md',
      blocks: [
        {
          depth: 2,
          kind: CortexArticleSemanticKind.Heading,
          line: 1,
          text: 'Example',
        },
        { kind: CortexArticleSemanticKind.Paragraph, line: 3 },
        { kind: CortexArticleSemanticKind.VisibleOrderedList, line: 5 },
        { kind: CortexArticleSemanticKind.Structure, line: 7 },
        { kind: CortexArticleSemanticKind.Transparent, line: 9 },
        { kind: CortexArticleSemanticKind.DensitySeparator, line: 11 },
      ],
    },
  ],
  migrationBaselineEntries: false,
  migrationLedger: {
    relativePath: '.cortex/article-structure-migration.txt',
    content: false,
  },
};

const validResult: CortexArticleStructureResult = {
  kind: CortexArticleContractKind.Result,
  findings: [
    {
      code: CortexArticleFindingCode.EmptyArticle,
      file: '.cortex/example.md',
      line: 1,
      message: 'Article #Example has no body content.',
    },
  ],
};

function requestFailurePath(serializedRequest: string): string {
  try {
    decodeCortexArticleRequest(serializedRequest);
  } catch (error) {
    if (error instanceof CortexArticleRequestDecodeError) return error.path;
    throw error;
  }
  throw new Error('Expected request decoding to fail.');
}

test('round-trips exact semantic requests and findings', () => {
  expect(
    decodeCortexArticleRequest(encodeCortexArticleRequest(validRequest)),
  ).toEqual(validRequest);
  expect(
    decodeCortexArticleResult(encodeCortexArticleResult(validResult)),
  ).toEqual(validResult);
});

test('accepts active diagnostics for every finding code', () => {
  const result: CortexArticleStructureResult = {
    kind: CortexArticleContractKind.Result,
    findings: [
      {
        code: CortexArticleFindingCode.EmptyArticle,
        file: '.cortex/example.md',
        line: 1,
        message: 'Article #Example has no body content.',
      },
      {
        code: CortexArticleFindingCode.DenseArticle,
        file: '.cortex/example.md',
        line: 3,
        message:
          'Article #Example has more than 3 consecutive prose blocks without visible structure.',
      },
      {
        code: CortexArticleFindingCode.UnorderedProcedure,
        file: '.cortex/example.md',
        line: 5,
        message:
          'Procedure-like article #Recovery procedure must expose its action sequence as an ordered list.',
      },
      {
        code: CortexArticleFindingCode.InvalidMigrationLedger,
        file: '.cortex/article-structure-migration.txt',
        line: 2,
        message:
          'Duplicate article-structure migration exemption: .cortex/example.md',
      },
      {
        code: CortexArticleFindingCode.InvalidMigrationLedger,
        file: '.cortex/article-structure-migration.txt',
        line: 3,
        message:
          'Article-structure exemption cannot be verified without the migration baseline: .cortex/example.md',
      },
    ],
  };
  expect(decodeCortexArticleResult(JSON.stringify(result))).toEqual(result);
});

test('rejects malformed envelopes and extra fields', () => {
  const requestWithWrites: RequestWithWrites = {
    ...validRequest,
    allowWrites: true,
  };
  const wrongKindRequest = encodeCortexArticleRequest(validRequest).replace(
    CortexArticleContractKind.Request,
    'wrong',
  );
  const invalidRequests = [
    '{}',
    'null',
    JSON.stringify(requestWithWrites),
    wrongKindRequest,
  ];
  for (const serialized of invalidRequests) {
    expect(() => decodeCortexArticleRequest(serialized)).toThrow();
  }
  expect(requestFailurePath(JSON.stringify(requestWithWrites))).toBe(
    '["<unknown-key>"]',
  );
  const resultWithExtra: ResultWithExtra = { ...validResult, extra: true };
  const invalidResults = ['{}', 'null', JSON.stringify(resultWithExtra)];
  for (const serialized of invalidResults) {
    expect(() => decodeCortexArticleResult(serialized)).toThrow();
  }
});

test('accepts only canonical semantic block shapes', () => {
  const invalidBlocks = [
    { kind: 'heading', line: 1, text: 'Missing depth' },
    { kind: 'heading', depth: 0, line: 1, text: 'Invalid depth' },
    { kind: 'paragraph', line: 0 },
    { kind: 'paragraph', line: 1, extra: true },
    { kind: 'visible-ordered-list', line: 1, ordered: true },
    { kind: 'html', line: 1, comment: true },
    { kind: 'definition', line: 1 },
    { kind: 'separator', line: 1 },
  ];
  for (const semanticBlock of invalidBlocks) {
    const document = {
      ...validRequest.documents[0],
      blocks: [semanticBlock],
    };
    const request = { ...validRequest, documents: [document] };
    expect(() => decodeCortexArticleRequest(JSON.stringify(request))).toThrow();
  }
});

test('rejects duplicate documents and nonmonotonic source lines', () => {
  const duplicateRequest = {
    ...validRequest,
    documents: [validRequest.documents[0], validRequest.documents[0]],
  };
  expect(() =>
    decodeCortexArticleRequest(JSON.stringify(duplicateRequest)),
  ).toThrow('Duplicate Cortex article document path');
  expect(requestFailurePath(JSON.stringify(duplicateRequest))).toBe(
    'documents[1].relativePath',
  );

  const outOfOrderDocument = {
    ...validRequest.documents[0],
    blocks: [
      { kind: CortexArticleSemanticKind.Paragraph, line: 2 },
      { kind: CortexArticleSemanticKind.Structure, line: 1 },
    ],
  };
  const outOfOrderRequest = {
    ...validRequest,
    documents: [outOfOrderDocument],
  };
  expect(() =>
    decodeCortexArticleRequest(JSON.stringify(outOfOrderRequest)),
  ).toThrow('Cortex article block lines must be strictly ordered');
  expect(requestFailurePath(JSON.stringify(outOfOrderRequest))).toBe(
    'documents[0].blocks[1].line',
  );
});

test('requires the canonical migration ledger path', () => {
  const request = {
    ...validRequest,
    migrationLedger: {
      ...validRequest.migrationLedger,
      relativePath: '.cortex/other-ledger.txt',
    },
  };
  expect(() => decodeCortexArticleRequest(JSON.stringify(request))).toThrow(
    'Invalid Cortex article migration ledger',
  );
  expect(requestFailurePath(JSON.stringify(request))).toBe(
    'migrationLedger.relativePath',
  );
});

test('bounds heading and migration-entry diagnostic details', () => {
  const boundaryHeading = {
    depth: 2,
    kind: CortexArticleSemanticKind.Heading,
    line: 1,
    text: 'x'.repeat(CORTEX_ARTICLE_DETAIL_TEXT_LIMIT),
  };
  const boundaryDocument = {
    ...validRequest.documents[0],
    blocks: [boundaryHeading],
  };
  const boundaryRequest = {
    ...validRequest,
    documents: [boundaryDocument],
    migrationLedger: {
      ...validRequest.migrationLedger,
      content: `# ${'x'.repeat(CORTEX_ARTICLE_DETAIL_TEXT_LIMIT - 2)}`,
    },
  };
  expect(() =>
    decodeCortexArticleRequest(JSON.stringify(boundaryRequest)),
  ).not.toThrow();

  const overflowHeading = {
    ...boundaryHeading,
    text: 'x'.repeat(CORTEX_ARTICLE_DETAIL_TEXT_LIMIT + 1),
  };
  const overflowDocument = { ...boundaryDocument, blocks: [overflowHeading] };
  const overflowHeadingRequest = {
    ...validRequest,
    documents: [overflowDocument],
  };
  expect(() =>
    decodeCortexArticleRequest(JSON.stringify(overflowHeadingRequest)),
  ).toThrow('Invalid Cortex article heading block');

  const overflowLedgerRequest = {
    ...validRequest,
    migrationLedger: {
      ...validRequest.migrationLedger,
      content: 'x'.repeat(CORTEX_ARTICLE_DETAIL_TEXT_LIMIT + 1),
    },
  };
  expect(() =>
    decodeCortexArticleRequest(JSON.stringify(overflowLedgerRequest)),
  ).toThrow('Invalid Cortex article migration ledger');
});

test('bounds paths, source lines, codes, and finding messages', () => {
  const invalidFindings = [
    { ...validResult.findings[0], code: 'not-a-code' },
    { ...validResult.findings[0], file: '../escape.md' },
    { ...validResult.findings[0], file: 'README.md' },
    { ...validResult.findings[0], line: 0 },
    { ...validResult.findings[0], message: '' },
    { ...validResult.findings[0], message: 'Generic provider-only message.' },
    {
      ...validResult.findings[0],
      code: CortexArticleFindingCode.DenseArticle,
      message: 'Article #Example has no body content.',
    },
    {
      ...validResult.findings[0],
      message: 'x'.repeat(CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT + 1),
    },
  ];
  for (const finding of invalidFindings) {
    const result = {
      kind: CortexArticleContractKind.Result,
      findings: [finding],
    };
    expect(() => decodeCortexArticleResult(JSON.stringify(result))).toThrow();
  }
  const longPath = `.cortex/${'x'.repeat(CORTEX_ARTICLE_PATH_LIMIT)}.md`;
  const longPathDocument = {
    ...validRequest.documents[0],
    relativePath: longPath,
  };
  const longPathRequest = {
    ...validRequest,
    documents: [longPathDocument],
  };
  expect(() =>
    decodeCortexArticleRequest(JSON.stringify(longPathRequest)),
  ).toThrow('Invalid Cortex article document');

  const ledgerFinding = {
    code: CortexArticleFindingCode.InvalidMigrationLedger,
    file: '.cortex/not-the-ledger.txt',
    line: 1,
    message:
      'Duplicate article-structure migration exemption: .cortex/example.md',
  };
  const ledgerResult = {
    kind: CortexArticleContractKind.Result,
    findings: [ledgerFinding],
  };
  expect(() => decodeCortexArticleResult(JSON.stringify(ledgerResult))).toThrow(
    'Invalid Cortex article finding diagnostics',
  );
});

test('rejects terminal controls while allowing benign joiners', () => {
  const heading = validRequest.documents[0]?.blocks[0];
  if (heading?.kind !== CortexArticleSemanticKind.Heading)
    throw new Error('Expected heading fixture.');
  const joinedHeading: CortexArticleHeading = {
    ...heading,
    text: 'Family 👨‍👩‍👧‍👦️',
  };
  const joinedDocument = {
    ...validRequest.documents[0],
    blocks: [joinedHeading],
  };
  const joinedRequest = { ...validRequest, documents: [joinedDocument] };
  expect(
    decodeCortexArticleRequest(JSON.stringify(joinedRequest)).documents[0]
      ?.blocks[0],
  ).toEqual(joinedHeading);
  const controls = [
    '\n',
    '\t',
    '\u001b',
    '\u0001',
    '\u007f',
    '\u061c',
    '\u2066',
  ];
  for (const control of controls) {
    const relativePath = `.cortex/exam${control}ple.md`;
    const document = { ...validRequest.documents[0], relativePath };
    const request = { ...validRequest, documents: [document] };
    expect(() => decodeCortexArticleRequest(JSON.stringify(request))).toThrow(
      'Invalid Cortex article document',
    );

    const finding = { ...validResult.findings[0], file: relativePath };
    const result = {
      kind: CortexArticleContractKind.Result,
      findings: [finding],
    };
    expect(() => decodeCortexArticleResult(JSON.stringify(result))).toThrow(
      'Invalid Cortex article finding',
    );
  }
});

test('enforces serialized request and result byte limits', () => {
  const oversizedRequest = 'x'.repeat(CORTEX_ARTICLE_REQUEST_BYTE_LIMIT + 1);
  expect(() => decodeCortexArticleRequest(oversizedRequest)).toThrow(
    'Cortex article request exceeds its byte bound',
  );
  const oversizedResult = 'x'.repeat(CORTEX_ARTICLE_RESULT_BYTE_LIMIT + 1);
  expect(() => decodeCortexArticleResult(oversizedResult)).toThrow(
    'Cortex article result exceeds its byte bound',
  );
});

test('rejects requests whose possible findings exceed result capacity', () => {
  const blocks: CortexArticleSemanticBlock[] = [];
  for (let index = 0; index < 10_000; index += 1) {
    const headingBlock: CortexArticleSemanticBlock = {
      depth: 2,
      kind: CortexArticleSemanticKind.Heading,
      line: index + 1,
      text: `Procedure ${index}`,
    };
    blocks.push(headingBlock);
  }
  const document = {
    relativePath: '.cortex/capacity.md',
    blocks,
  };
  const request = { ...validRequest, documents: [document] };
  expect(() => decodeCortexArticleRequest(JSON.stringify(request))).toThrow(
    'Cortex article request result budget exceeds its bound',
  );
  expect(requestFailurePath(JSON.stringify(request))).toBe(
    'documents[0].blocks[9999]',
  );
});

test('self-verifies an accepted request through decode, audit, and result decode', async () => {
  const { auditCortexArticleStructure } = await import('../src/audit.ts');
  const decodedRequest = decodeCortexArticleRequest(
    encodeCortexArticleRequest(validRequest),
  );
  const findings = auditCortexArticleStructure(decodedRequest);
  const result: CortexArticleStructureResult = {
    kind: CortexArticleContractKind.Result,
    findings,
  };
  expect(decodeCortexArticleResult(encodeCortexArticleResult(result))).toEqual(
    result,
  );
});
