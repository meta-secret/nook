import path from 'node:path';
import { expect, test } from 'bun:test';
import {
  auditCortexDocumentStructure,
  CortexStructureFindingCode,
} from '../src/lib/cortex-document-structure.ts';
import type {
  AuditCortexDocumentStructureArgs,
  CortexDocumentSource,
} from '../src/lib/cortex-document-structure.ts';

const REPO_ROOT = '/repo';

type MakeDocumentArgs = {
  readonly path: string;
  readonly content: string;
};

function makeDocument(args: MakeDocumentArgs): CortexDocumentSource {
  return {
    absolutePath: path.join(REPO_ROOT, args.path),
    relativePath: args.path,
    content: args.content,
  };
}

function audit(documents: readonly CortexDocumentSource[]) {
  const args: AuditCortexDocumentStructureArgs = {
    documents,
    migrationBaselineEntries: false,
    migrationLedgerPath: path.join(
      REPO_ROOT,
      '.cortex',
      'document-map-migration.txt',
    ),
    repoRoot: REPO_ROOT,
  };
  return auditCortexDocumentStructure(args);
}

const INDEX_DOC_ARGS: MakeDocumentArgs = {
  path: '.cortex/knowledge-graph.md',
  content: `# Cortex Knowledge Graph & Navigation Map

## Overview

Central index.

## Section

- [A](a.md)
  - [Overview](a.md#overview)
  - [Details](a.md#details)
- [B](b.md)
  - [Details](b.md#details)
`,
};
const INDEX_DOC = makeDocument(INDEX_DOC_ARGS);

const DOCUMENT_A_ARGS: MakeDocumentArgs = {
  path: '.cortex/a.md',
  content: `# A

Short purpose.

## Overview

Overview text.

### Details

Details text.
`,
};
const DOCUMENT_A = makeDocument(DOCUMENT_A_ARGS);

const DOCUMENT_B_ARGS: MakeDocumentArgs = {
  path: '.cortex/b.md',
  content: `# B

## Details

Details text.
`,
};
const DOCUMENT_B = makeDocument(DOCUMENT_B_ARGS);

test('accepts clean documents and valid centralized knowledge-graph.md', () => {
  expect(audit([INDEX_DOC, DOCUMENT_A, DOCUMENT_B])).toEqual([]);
});

test('accepts k-graph.md as an alias for the centralized knowledge graph', () => {
  const kGraphDocArgs: MakeDocumentArgs = {
    path: '.cortex/k-graph.md',
    content: INDEX_DOC_ARGS.content,
  };
  const kGraphDoc = makeDocument(kGraphDocArgs);
  expect(audit([kGraphDoc, DOCUMENT_A, DOCUMENT_B])).toEqual([]);
});

test('reports missing knowledge-graph.md when centralized index is absent', () => {
  const findings = audit([DOCUMENT_A, DOCUMENT_B]);
  const codes = findings.map((finding) => finding.code);
  expect(codes).toContain(CortexStructureFindingCode.MissingIndex);
});

test('requires the sole H1 title to be the first document node', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/late-title.md',
    content: `Some intro text before title.

# Late title

## Purpose
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([INDEX_DOC, document]).map((finding) => finding.code)).toContain(
    CortexStructureFindingCode.InvalidTitle,
  );
});

test('rejects prohibited inline relationships or document map in individual files', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/with-rel.md',
    content: `# With Rel

## Relationships

- [A](a.md)

## Overview

Text.
`,
  };
  const document = makeDocument(documentArgs);
  const codes = audit([INDEX_DOC, document]).map((finding) => finding.code);
  expect(codes).toContain(CortexStructureFindingCode.ProhibitedNavigation);
});

test('rejects index links pointing to non-existent documents', () => {
  const badIndexArgs: MakeDocumentArgs = {
    path: '.cortex/knowledge-graph.md',
    content: `# Cortex Knowledge Graph & Navigation Map

- [Missing](missing-file.md)
`,
  };
  const badIndex = makeDocument(badIndexArgs);
  const codes = audit([badIndex, DOCUMENT_A]).map((finding) => finding.code);
  expect(codes).toContain(CortexStructureFindingCode.InvalidIndexEntry);
});

test('rejects index links pointing to missing heading fragments', () => {
  const badIndexArgs: MakeDocumentArgs = {
    path: '.cortex/knowledge-graph.md',
    content: `# Cortex Knowledge Graph & Navigation Map

- [A](a.md)
  - [Broken Anchor](a.md#non-existent-section)
- [B](b.md)
  - [Details](b.md#details)
`,
  };
  const badIndex = makeDocument(badIndexArgs);
  const codes = audit([badIndex, DOCUMENT_A, DOCUMENT_B]).map(
    (finding) => finding.code,
  );
  expect(codes).toContain(CortexStructureFindingCode.BrokenFragment);
});

test('reports unindexed documents missing from knowledge-graph.md', () => {
  const incompleteIndexArgs: MakeDocumentArgs = {
    path: '.cortex/knowledge-graph.md',
    content: `# Cortex Knowledge Graph & Navigation Map

- [A](a.md)
  - [Overview](a.md#overview)
  - [Details](a.md#details)
`,
  };
  const incompleteIndex = makeDocument(incompleteIndexArgs);
  const codes = audit([incompleteIndex, DOCUMENT_A, DOCUMENT_B]).map(
    (finding) => finding.code,
  );
  expect(codes).toContain(CortexStructureFindingCode.MissingFromIndex);
});
