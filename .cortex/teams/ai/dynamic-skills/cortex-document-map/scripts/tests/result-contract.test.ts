import { ok } from 'neverthrow';
import { CortexDocumentMapResultAcceptance } from '../src/application.ts';
import { CortexDocumentMapResultEncoding } from '../src/codec.ts';
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
  const resultOutcome =
    CortexDocumentMapApplication.from(invalidRootRequest).execute();
  expect(resultOutcome.isOk()).toBe(true);
  if (resultOutcome.isErr()) return;
  const result = resultOutcome.value;
  expect(
    new CortexDocumentMapResultEncoding(result)
      .execute()
      .andThen((serialized) =>
        CortexDocumentMapTransport.from(serialized).decodeResult(),
      ),
  ).toEqual(ok(result));
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
    CortexDocumentMapTransport.from(serialized)
      .decodeResult()
      .match(
        (value) => {
          expect(value).toEqual(void 0);
        },
        (outcome) => {
          expect(outcome).toBeInstanceOf(CortexDocumentMapResultDecodeError);
        },
      );
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
    CortexDocumentMapTransport.from(
      CortexDocumentMapResultContractScenario.serializedResult([finding]),
    )
      .decodeResult()
      .match(
        (value) => {
          expect(value).toEqual(void 0);
        },
        (outcome) => {
          expect(outcome).toBeInstanceOf(CortexDocumentMapResultDecodeError);
        },
      );
  }
});

test('rejects oversized serialized results', () => {
  CortexDocumentMapTransport.from(
    'x'.repeat(CORTEX_DOCUMENT_MAP_RESULT_BYTE_LIMIT + 1),
  )
    .decodeResult()
    .match(
      (value) => {
        expect(value).toEqual(void 0);
      },
      (outcome) => {
        expect(outcome).toBeInstanceOf(CortexDocumentMapResultDecodeError);
      },
    );
});

test('acceptance rejects removal, reordering, duplication, and mutation', () => {
  const resultOutcome =
    CortexDocumentMapApplication.from(invalidRootRequest).execute();
  expect(resultOutcome.isOk()).toBe(true);
  if (resultOutcome.isErr()) return;
  const result = resultOutcome.value;
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
    new CortexDocumentMapResultAcceptance({
      auditRequest: invalidRootRequest,
      result: candidate,
    })
      .execute()
      .match(
        (value) => {
          expect(value).toEqual(void 0);
        },
        (outcome) => {
          expect(outcome.message).toContain(
            'Cortex document-map verification failed.',
          );
        },
      );
  }
});

test('acceptance binds findings to the exact admitted request', () => {
  const resultOutcome =
    CortexDocumentMapApplication.from(invalidRootRequest).execute();
  expect(resultOutcome.isOk()).toBe(true);
  if (resultOutcome.isErr()) return;
  const result = resultOutcome.value;
  const cleanRequest: AuditCortexDocumentMapRequest = {
    ...invalidRootRequest,
    documents: [
      {
        relativePath: '.cortex/knowledge-graph.md',
        content: '# Cortex Context Router\n',
      },
    ],
  };
  new CortexDocumentMapResultAcceptance({
    auditRequest: cleanRequest,
    result,
  })
    .execute()
    .match(
      (value) => {
        expect(value).toEqual(void 0);
      },
      (outcome) => {
        expect(outcome.message).toContain(
          'Cortex document-map verification failed.',
        );
      },
    );
});

test('acceptance rejects an omitted transient-link diagnostic', () => {
  const resultOutcome =
    CortexDocumentMapApplication.from(transientLinkRequest).execute();
  expect(resultOutcome.isOk()).toBe(true);
  if (resultOutcome.isErr()) return;
  const result = resultOutcome.value;
  expect(result.findings.map((finding) => finding.code)).toEqual([
    CortexStructureFindingCode.InvalidIndexEntry,
  ]);
  new CortexDocumentMapResultAcceptance({
    auditRequest: transientLinkRequest,
    result: { ...result, findings: [] },
  })
    .execute()
    .match(
      (value) => {
        expect(value).toEqual(void 0);
      },
      (outcome) => {
        expect(outcome.message).toContain(
          'Cortex document-map verification failed.',
        );
      },
    );
});
