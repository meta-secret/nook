import { expect, test } from 'bun:test';
import { executeCortexDocumentMapApplication } from '../src/application.ts';
import {
  decodeCortexDocumentMapRequest,
  CortexDocumentMapRequestDecodeError,
} from '../src/codec.ts';
import {
  CortexDocumentMapContractKind,
  type AuditCortexDocumentMapRequest,
} from '../src/domain.ts';
import { CortexStructureFindingCode } from '../src/cortex-document-structure.ts';

type MakeRequest = {
  readonly content: string;
  readonly excludedDocumentPaths?: readonly string[];
};

function request(args: MakeRequest): AuditCortexDocumentMapRequest {
  return {
    kind: CortexDocumentMapContractKind.Request,
    documents: [
      {
        relativePath: '.cortex/knowledge-graph.md',
        content: args.content,
      },
    ],
    excludedDocumentPaths: args.excludedDocumentPaths ?? [],
  };
}

test('audits supplied documents without repository I/O', () => {
  const result = executeCortexDocumentMapApplication(
    request({ content: '# Cortex Context Router\n' }),
  );
  expect(result).toEqual({
    kind: CortexDocumentMapContractKind.Result,
    findings: [],
  });
});

test('rejects HTML before topology and preserves the syntax diagnostic', () => {
  const result = executeCortexDocumentMapApplication(
    request({ content: '# Cortex Context Router\n\n<div>hidden</div>\n' }),
  );
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
  expect(executeCortexDocumentMapApplication(auditRequest).findings).toEqual(
    [],
  );
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
  expect(executeCortexDocumentMapApplication(auditRequest).findings).toEqual([
    {
      code: CortexStructureFindingCode.InvalidIndexEntry,
      file: '.cortex/knowledge-graph.md',
      line: 3,
      message:
        'Index link points to non-existent document: .cortex/.session/note.md',
    },
  ]);
});

test('fails closed for unknown keys, unsafe paths, and missing exclusions', () => {
  const cases = [
    JSON.stringify({
      ...request({ content: '# Index\n' }),
      secret: 'redact-me',
    }),
    JSON.stringify({
      ...request({ content: '# Index\n' }),
      documents: [{ relativePath: '.cortex/../escape.md', content: '# X\n' }],
    }),
    JSON.stringify({
      ...request({ content: '# Index\n' }),
      excludedDocumentPaths: ['.cortex/missing.md'],
    }),
  ];
  for (const serialized of cases) {
    expect(() => decodeCortexDocumentMapRequest(serialized)).toThrow(
      CortexDocumentMapRequestDecodeError,
    );
  }
});
