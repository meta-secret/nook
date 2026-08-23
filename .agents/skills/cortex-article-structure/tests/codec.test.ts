import { expect, test } from 'bun:test';
import {
  decodeCortexArticleRequest,
  decodeCortexArticleResult,
  encodeCortexArticleRequest,
  encodeCortexArticleResult,
} from '../src/codec.ts';
import type {
  AuditCortexArticleStructureRequest,
  CortexArticleStructureResult,
} from '../src/domain.ts';
import {
  CortexArticleBlockKind,
  CortexArticleContractKind,
} from '../src/domain.ts';

const validRequest: AuditCortexArticleStructureRequest = {
  kind: CortexArticleContractKind.Request,
  documents: [
    {
      relativePath: '.cortex/example.md',
      blocks: [
        {
          depth: 1,
          line: 1,
          text: 'Example',
          type: CortexArticleBlockKind.Heading,
        },
        { line: 3, type: CortexArticleBlockKind.Paragraph },
        { line: 5, ordered: true, type: CortexArticleBlockKind.List },
        { comment: true, line: 7, type: CortexArticleBlockKind.Html },
        { line: 9, type: CortexArticleBlockKind.Definition },
        { line: 11, type: CortexArticleBlockKind.Structure },
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
  findings: [],
};

test('round-trips exact article requests and results', () => {
  expect(
    decodeCortexArticleRequest(encodeCortexArticleRequest(validRequest)),
  ).toEqual(validRequest);
  expect(
    decodeCortexArticleResult(encodeCortexArticleResult(validResult)),
  ).toEqual(validResult);
});

test('rejects malformed and extra request fields', () => {
  const extraRequest = { ...validRequest, allowWrites: true };
  const wrongKindRequest = { ...validRequest, kind: 'wrong' };
  const escapingDocument = {
    ...validRequest.documents[0],
    relativePath: '../escape.md',
  };
  const escapingRequest = {
    ...validRequest,
    documents: [escapingDocument],
  };
  const cases = [
    '{}',
    JSON.stringify(extraRequest),
    JSON.stringify(wrongKindRequest),
    JSON.stringify(escapingRequest),
  ];
  for (const serializedRequest of cases) {
    expect(() => decodeCortexArticleRequest(serializedRequest)).toThrow();
  }
});

test('rejects missing, extra, malformed, and unbounded block fields', () => {
  const blockCases = [
    { type: 'heading', line: 1, text: 'Missing depth' },
    { type: 'heading', depth: 0, line: 1, text: 'Invalid depth' },
    { type: 'heading', depth: 2, line: 1, text: 'x'.repeat(4097) },
    { type: 'paragraph', line: 0 },
    { type: 'paragraph', line: 1, extra: true },
    { type: 'list', line: 1, ordered: 'yes' },
    { type: 'html', line: 1, comment: 'yes' },
    { type: 'not-a-block', line: 1 },
  ];
  for (const block of blockCases) {
    const invalidDocument = {
      relativePath: '.cortex/example.md',
      blocks: [block],
    };
    const invalidRequest = { ...validRequest, documents: [invalidDocument] };
    expect(() =>
      decodeCortexArticleRequest(JSON.stringify(invalidRequest)),
    ).toThrow();
  }
});

test('rejects malformed and extra result fields', () => {
  const extraResult = { ...validResult, extra: true };
  const invalidFinding = {
    code: 'not-a-code',
    file: '.cortex/example.md',
    line: 1,
    message: 'Invalid code.',
  };
  const invalidFindingResult = {
    kind: CortexArticleContractKind.Result,
    findings: [invalidFinding],
  };
  const cases = [
    '{}',
    JSON.stringify(extraResult),
    JSON.stringify(invalidFindingResult),
  ];
  for (const serializedResult of cases) {
    expect(() => decodeCortexArticleResult(serializedResult)).toThrow();
  }
});
