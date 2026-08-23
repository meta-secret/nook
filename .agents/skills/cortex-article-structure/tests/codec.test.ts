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
import { CortexArticleContractKind } from '../src/domain.ts';

const validRequest: AuditCortexArticleStructureRequest = {
  kind: CortexArticleContractKind.Request,
  documents: [
    {
      relativePath: '.cortex/example.md',
      content: '# Example\n',
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
