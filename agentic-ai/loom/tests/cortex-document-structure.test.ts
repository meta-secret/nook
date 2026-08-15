import path from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

const DOCUMENT_A_ARGS: MakeDocumentArgs = {
  path: '.cortex/a.md',
  content: `# A

Short purpose.

## Relationships

- [B details](b.md#details)
  - Supplies the shared details.
  - Read when changing A.

## Document map

- [Overview](#overview)
  - Introduces the document.
  - Read first.
  - [Details](#details)
    - Defines the details.
    - Read when implementing them.

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

## Relationships

- [A](a.md)
  - Supplies A context.
  - Read when changing B.

## Document map

- [Details](#details)
  - Defines B details.
  - Read when using B.

## Details

Details text.
`,
};
const DOCUMENT_B = makeDocument(DOCUMENT_B_ARGS);

test('accepts canonical relationships and a hierarchical document map', () => {
  expect(audit([DOCUMENT_A, DOCUMENT_B])).toEqual([]);
});

test('requires relationships and document map as the first two H2 sections', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/invalid.md',
    content: '# Invalid\n\n## Overview\n\nText.\n',
  };
  const document = makeDocument(documentArgs);
  const codes = audit([document]).map((finding) => finding.code);
  expect(codes).toContain(CortexStructureFindingCode.MissingRelationships);
  expect(codes).toContain(CortexStructureFindingCode.MissingDocumentMap);
});

test('requires the sole H1 title to be the first document node', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/late-title.md',
    content: `## Relationships

- None.

## Document map

- [Purpose](#purpose)
  - Explains the purpose.
  - Read when using the document.

# Late title

## Purpose
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document]).map((finding) => finding.code)).toContain(
    CortexStructureFindingCode.InvalidTitle,
  );
});

test('allows an explicit empty relationship set', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/isolated.md',
    content: `# Isolated

## Relationships

- None.

## Document map

- [Purpose](#purpose)
  - Explains the purpose.
  - Read when using this document.

## Purpose

Text.
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document])).toEqual([]);
});

test('rejects an empty marker alongside linked relationships', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/mixed.md',
    content: `# Mixed

## Relationships

- None.
- [Target](target.md)
  - Supplies target context.
  - Read when using the target.

## Document map

- [Purpose](#purpose)
  - Explains the purpose.
  - Read when using Mixed.

## Purpose
`,
  };
  const targetArgs: MakeDocumentArgs = {
    path: '.cortex/target.md',
    content: `# Target

## Relationships

- None.

## Document map

- [Purpose](#purpose)
  - Explains the purpose.
  - Read when using Target.

## Purpose
`,
  };
  const document = makeDocument(documentArgs);
  const target = makeDocument(targetArgs);
  expect(audit([document, target]).map((finding) => finding.message)).toContain(
    '`None.` cannot appear alongside linked relationships.',
  );
});

test('rejects migration exemptions added after the baseline', () => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'cortex-ledger-'));
  try {
    const cortexRoot = path.join(repositoryRoot, '.cortex');
    mkdirSync(cortexRoot);
    const ledgerPath = path.join(cortexRoot, 'document-map-migration.txt');
    writeFileSync(ledgerPath, '.cortex/a.md\n');
    const args: AuditCortexDocumentStructureArgs = {
      documents: [DOCUMENT_A, DOCUMENT_B],
      migrationBaselineEntries: [],
      migrationLedgerPath: ledgerPath,
      repoRoot: repositoryRoot,
    };
    const findings = auditCortexDocumentStructure(args);
    expect(findings.map((finding) => finding.code)).toContain(
      CortexStructureFindingCode.InvalidMigrationLedger,
    );
  } finally {
    const removeOptions = { recursive: true, force: true } as const;
    rmSync(repositoryRoot, removeOptions);
  }
});

test('rejects stale, missing, and incorrectly nested map entries', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/map.md',
    content: `# Map

## Relationships

- None.

## Document map

- [Wrong](#wrong)
  - Describes the wrong section.
  - Read at the wrong time.
- [Child](#child)
  - Describes the child.
  - Read for child work.

## Parent

### Child
`,
  };
  const document = makeDocument(documentArgs);
  const findings = audit([document]);
  expect(
    findings.filter(
      (finding) => finding.code === CortexStructureFindingCode.InvalidMapEntry,
    ).length,
  ).toBeGreaterThan(0);
});

test('requires exactly two explanation bullets per linked entry', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/explanations.md',
    content: `# Explanations

## Relationships

- None.

## Document map

- [Purpose](#purpose)
  - Only one explanation.

## Purpose
`,
  };
  const document = makeDocument(documentArgs);
  const findings = audit([document]);
  expect(findings[0]?.message).toContain('exactly two');
});

test('validates cross-document fragments and URL decoding', () => {
  const sourceArgs: MakeDocumentArgs = {
    path: '.cortex/source.md',
    content: `# Source

## Relationships

- [Target](target.md#some%2Dheading)
  - Supplies target context.
  - Read when using the target.

## Document map

- [Purpose](#purpose)
  - Explains the purpose.
  - Read when using Source.

## Purpose
`,
  };
  const source = makeDocument(sourceArgs);
  const targetArgs: MakeDocumentArgs = {
    path: '.cortex/target.md',
    content: `# Target

## Relationships

- [Source](source.md)
  - Supplies source context.
  - Read when using Source.

## Document map

- [Some heading](#some-heading)
  - Defines the heading.
  - Read when using Target.

## Some heading
`,
  };
  const target = makeDocument(targetArgs);
  expect(audit([source, target])).toEqual([]);
});

test('ignores heading-like text in code fences and block quotes', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/examples.md',
    content: `# Examples

## Relationships

- None.

## Document map

- [Examples](#examples-1)
  - Contains examples.
  - Read when authoring examples.

## Examples

\`\`\`
## Not a heading
\`\`\`

> ## Also not a heading
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document])).toEqual([]);
});

test('uses GitHub duplicate-heading fragments', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/duplicates.md',
    content: `# Duplicates

## Relationships

- None.

## Document map

- [Repeated](#repeated)
  - Defines the first section.
  - Read for the first case.
- [Repeated again](#repeated-1)
  - Defines the second section.
  - Read for the second case.

## Repeated

## Repeated
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document])).toEqual([]);
});
