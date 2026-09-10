import { ok } from 'neverthrow';
import { expect, test } from 'bun:test';

import { CortexDocumentMapApplication } from '../src/application.ts';

import {
  CortexDocumentMapRequestDecodeError,
  CortexDocumentMapTransport,
} from '../src/codec.ts';

import {
  CortexDocumentMapContractKind,
  type AuditCortexDocumentMapRequest,
} from '../src/domain.ts';

import { CortexStructureFindingCode } from '../src/cortex-document-structure.ts';

export class CortexDocumentMapApplicationScenario {
  private constructor(private readonly request: MakeRequest) {}

  static request(args: MakeRequest): AuditCortexDocumentMapRequest {
    return new CortexDocumentMapApplicationScenario(args).execute();
  }

  private execute(): AuditCortexDocumentMapRequest {
    const args = this.request;
    const { excludedDocumentPaths = [] } = args;
    return {
      kind: CortexDocumentMapContractKind.Request,
      documents: [
        {
          relativePath: '.cortex/knowledge-graph.md',
          content: args.content,
        },
      ],
      excludedDocumentPaths,
    };
  }
}

type MakeRequest = {
  readonly content: string;
  readonly excludedDocumentPaths?: readonly string[];
};

test('audits supplied documents without repository I/O', () => {
  const resultOutcome = CortexDocumentMapApplication.from(
    CortexDocumentMapApplicationScenario.request({
      content: '# Cortex Context Router\n',
    }),
  ).execute();
  expect(resultOutcome.isOk()).toBe(true);
  if (resultOutcome.isErr()) return;
  const result = resultOutcome.value;
  expect(result).toEqual({
    kind: CortexDocumentMapContractKind.Result,
    findings: [],
  });
});

test('rejects HTML before topology and preserves the syntax diagnostic', () => {
  const resultOutcome = CortexDocumentMapApplication.from(
    CortexDocumentMapApplicationScenario.request({
      content: '# Cortex Context Router\n\n<div>hidden</div>\n',
    }),
  ).execute();
  expect(resultOutcome.isOk()).toBe(true);
  if (resultOutcome.isErr()) return;
  const result = resultOutcome.value;
  expect(result.findings.map((finding) => finding.code)).toEqual([
    CortexStructureFindingCode.ProhibitedHtml,
    CortexStructureFindingCode.MissingIndex,
  ]);
});

test('keeps excluded transient documents in syntax enforcement only', () => {
  const excluded = '.cortex/.session/note.md';
  const auditRequest: AuditCortexDocumentMapRequest = {
    kind: CortexDocumentMapContractKind.Request,
    documents: [
      {
        relativePath: '.cortex/knowledge-graph.md',
        content: '# Cortex Context Router\n',
      },
      { relativePath: excluded, content: '# Temporary\n' },
    ],
    excludedDocumentPaths: [excluded],
  };
  expect(
    CortexDocumentMapApplication.from(auditRequest)
      .execute()
      .map((result) => result.findings),
  ).toEqual(ok([]));
});

test('does not suppress persistent links to excluded transient documents', () => {
  const excluded = '.cortex/.session/note.md';
  const auditRequest: AuditCortexDocumentMapRequest = {
    kind: CortexDocumentMapContractKind.Request,
    documents: [
      {
        relativePath: '.cortex/knowledge-graph.md',
        content: '# Cortex Context Router\n\n- [Transient](.session/note.md)\n',
      },
      { relativePath: excluded, content: '# Temporary\n' },
    ],
    excludedDocumentPaths: [excluded],
  };
  expect(
    CortexDocumentMapApplication.from(auditRequest)
      .execute()
      .map((result) => result.findings),
  ).toEqual(
    ok([
      {
        code: CortexStructureFindingCode.InvalidIndexEntry,
        file: '.cortex/knowledge-graph.md',
        line: 3,
        message:
          'Index link points to non-existent document: .cortex/.session/note.md',
      },
    ]),
  );
});

test('fails closed for unknown keys, unsafe paths, and missing exclusions', () => {
  const cases = [
    JSON.stringify({
      ...CortexDocumentMapApplicationScenario.request({ content: '# Index\n' }),
      secret: 'redact-me',
    }),
    JSON.stringify({
      ...CortexDocumentMapApplicationScenario.request({ content: '# Index\n' }),
      documents: [{ relativePath: '.cortex/../escape.md', content: '# X\n' }],
    }),
    JSON.stringify({
      ...CortexDocumentMapApplicationScenario.request({ content: '# Index\n' }),
      excludedDocumentPaths: ['.cortex/missing.md'],
    }),
  ];
  for (const serialized of cases) {
    CortexDocumentMapTransport.from(serialized)
      .execute()
      .match(
        (value) => {
          expect(value).toEqual(void 0);
        },
        (outcome) => {
          expect(outcome).toBeInstanceOf(CortexDocumentMapRequestDecodeError);
        },
      );
  }
});
