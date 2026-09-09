import { expect, test } from 'bun:test';

import { CortexDocumentMapApplication } from '../src/application.ts';

import {
  CortexDocumentMapResultDecodeError,
  CortexDocumentMapTransport,
} from '../src/codec.ts';

import { CortexStructureFindingCode } from '../src/cortex-document-structure.ts';

import {
  CortexDocumentMapContractKind,
  CORTEX_DOCUMENT_MAP_FINDING_LINE_LIMIT,
  CORTEX_DOCUMENT_MAP_FINDING_MESSAGE_LIMIT,
  CORTEX_DOCUMENT_MAP_RESULT_BYTE_LIMIT,
  type AuditCortexDocumentMapRequest,
} from '../src/domain.ts';

export class CortexDocumentMapResultContractScenario {
  private constructor(
    private readonly request: readonly Readonly<
      Record<string, string | number>
    >[],
  ) {}

  static serializedResult(
    findings: readonly Readonly<Record<string, string | number>>[],
  ): string {
    return new CortexDocumentMapResultContractScenario(findings).execute();
  }

  private execute(): string {
    const findings = this.request;
    return JSON.stringify({
      kind: CortexDocumentMapContractKind.Result,
      findings,
    });
  }
}

const invalidRootRequest: AuditCortexDocumentMapRequest = {
  kind: CortexDocumentMapContractKind.Request,
  documents: [
    {
      relativePath: '.cortex/knowledge-graph.md',
      content: '# Cortex Context Router\n\n<div>hidden</div>\n',
    },
  ],
  excludedDocumentPaths: [],
};

const transientLinkRequest: AuditCortexDocumentMapRequest = {
  kind: CortexDocumentMapContractKind.Request,
  documents: [
    {
      relativePath: '.cortex/knowledge-graph.md',
      content: '# Cortex Context Router\n\n- [Transient](.session/note.md)\n',
    },
    { relativePath: '.cortex/.session/note.md', content: '# Temporary\n' },
  ],
  excludedDocumentPaths: ['.cortex/.session/note.md'],
};

const validFinding = {
  code: CortexStructureFindingCode.MissingIndex,
  file: '.cortex/knowledge-graph.md',
  line: 1,
  message: 'Centralized Cortex knowledge graph is missing.',
};

test('round-trips the exact bounded result contract', () => {
  const result =
    CortexDocumentMapApplication.from(invalidRootRequest).execute();
  expect(
    CortexDocumentMapTransport.decodeCortexDocumentMapResult(
      CortexDocumentMapTransport.encodeCortexDocumentMapResult(result),
    ),
  ).toEqual(result);
});

test('rejects malformed envelopes and unknown or missing fields', () => {
  const malformed = [
    'not-json',
    '[]',
    JSON.stringify({ findings: [] }),
    JSON.stringify({
      kind: CortexDocumentMapContractKind.Result,
      findings: [],
      secret: 'redact-me',
    }),
    CortexDocumentMapResultContractScenario.serializedResult([
      { ...validFinding, secret: 'redact-me' },
    ]),
    CortexDocumentMapResultContractScenario.serializedResult([
      {
        code: validFinding.code,
        file: validFinding.file,
        line: validFinding.line,
      },
    ]),
  ];
  for (const serialized of malformed) {
    expect(() =>
      CortexDocumentMapTransport.decodeCortexDocumentMapResult(serialized),
    ).toThrow(CortexDocumentMapResultDecodeError);
  }
});

test('rejects invalid finding codes, paths, lines, and messages', () => {
  const invalidFindings = [
    { ...validFinding, code: 'invented-code' },
    { ...validFinding, file: '.cortex/../escape.md' },
    { ...validFinding, line: 0 },
    { ...validFinding, line: CORTEX_DOCUMENT_MAP_FINDING_LINE_LIMIT + 1 },
    { ...validFinding, message: '' },
    {
      ...validFinding,
      message: 'x'.repeat(CORTEX_DOCUMENT_MAP_FINDING_MESSAGE_LIMIT + 1),
    },
    { ...validFinding, message: 'hidden\u0000control' },
  ];
  for (const finding of invalidFindings) {
    expect(() =>
      CortexDocumentMapTransport.decodeCortexDocumentMapResult(
        CortexDocumentMapResultContractScenario.serializedResult([finding]),
      ),
    ).toThrow(CortexDocumentMapResultDecodeError);
  }
});

test('rejects oversized serialized results', () => {
  expect(() =>
    CortexDocumentMapTransport.decodeCortexDocumentMapResult(
      'x'.repeat(CORTEX_DOCUMENT_MAP_RESULT_BYTE_LIMIT + 1),
    ),
  ).toThrow(CortexDocumentMapResultDecodeError);
});

test('acceptance rejects removal, reordering, duplication, and mutation', () => {
  const result =
    CortexDocumentMapApplication.from(invalidRootRequest).execute();
  const [first = false, second = false] = result.findings;
  expect(first).not.toBe(false);
  expect(second).not.toBe(false);
  if (first === false || second === false) return;
  const candidates = [
    { ...result, findings: [first] },
    { ...result, findings: [second, first] },
    { ...result, findings: [first, second, second] },
    {
      ...result,
      findings: [{ ...first, message: `${first.message} mutated` }, second],
    },
    {
      ...result,
      findings: [{ ...first, line: first.line + 1 }, second],
    },
    {
      ...result,
      findings: [{ ...first, file: '.cortex/other.md' }, second],
    },
    {
      ...result,
      findings: [
        { ...first, code: CortexStructureFindingCode.InvalidTitle },
        second,
      ],
    },
  ];
  for (const candidate of candidates) {
    expect(() =>
      CortexDocumentMapApplication.acceptCortexDocumentMapResult({
        auditRequest: invalidRootRequest,
        result: candidate,
      }),
    ).toThrow('Cortex document-map verification failed.');
  }
});

test('acceptance binds findings to the exact admitted request', () => {
  const result =
    CortexDocumentMapApplication.from(invalidRootRequest).execute();
  const cleanRequest: AuditCortexDocumentMapRequest = {
    ...invalidRootRequest,
    documents: [
      {
        relativePath: '.cortex/knowledge-graph.md',
        content: '# Cortex Context Router\n',
      },
    ],
  };
  expect(() =>
    CortexDocumentMapApplication.acceptCortexDocumentMapResult({
      auditRequest: cleanRequest,
      result,
    }),
  ).toThrow('Cortex document-map verification failed.');
});

test('acceptance rejects an omitted transient-link diagnostic', () => {
  const result =
    CortexDocumentMapApplication.from(transientLinkRequest).execute();
  expect(result.findings.map((finding) => finding.code)).toEqual([
    CortexStructureFindingCode.InvalidIndexEntry,
  ]);
  expect(() =>
    CortexDocumentMapApplication.acceptCortexDocumentMapResult({
      auditRequest: transientLinkRequest,
      result: { ...result, findings: [] },
    }),
  ).toThrow('Cortex document-map verification failed.');
});
