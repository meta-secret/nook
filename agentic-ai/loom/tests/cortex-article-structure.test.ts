import path from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test } from 'bun:test';
import {
  auditCortexArticleStructure,
  CortexArticleFindingCode,
} from '../src/lib/cortex-article-structure.ts';
import type { AuditCortexArticleStructureArgs } from '../src/lib/cortex-article-structure.ts';
import type { CortexDocumentSource } from '../src/lib/cortex-document-structure.ts';

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
  const args: AuditCortexArticleStructureArgs = {
    documents,
    migrationBaselineEntries: false,
    migrationLedgerPath: path.join(
      REPO_ROOT,
      '.cortex',
      'article-structure-migration.txt',
    ),
    repoRoot: REPO_ROOT,
  };
  return auditCortexArticleStructure(args);
}

const STRUCTURED_DOCUMENT_ARGS: MakeDocumentArgs = {
  path: '.cortex/structured.md',
  content: `# Structured

## Relationships

- None.

## Document map

- [Purpose](#purpose)
  - Explains the purpose.
  - Read first.
- [Delivery procedure](#delivery-procedure)
  - Defines ordered delivery.
  - Follow during delivery.

## Purpose

This article explains the durable outcome.

- One parallel fact.
- Another parallel fact.

## Delivery procedure

Follow the steps in order.

1. Prepare the input.
2. Produce the result.
3. Validate the result.
`,
};

test('accepts explanatory, rule-list, and ordered procedure structure', () => {
  const document = makeDocument(STRUCTURED_DOCUMENT_ARGS);
  expect(audit([document])).toEqual([]);
});

test('rejects excessive consecutive prose blocks', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/dense.md',
    content: `# Dense

## Relationships

- None.

## Document map

- [Explanation](#explanation)
  - Explains the topic.
  - Read for rationale.

## Explanation

First paragraph.

Second paragraph.

Third paragraph.

Fourth paragraph.
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document]).map((finding) => finding.code)).toContain(
    CortexArticleFindingCode.DenseArticle,
  );
});

test('requires procedure-like articles to expose ordered actions', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/procedure.md',
    content: `# Procedure

## Relationships

- None.

## Document map

- [Recovery procedure](#recovery-procedure)
  - Defines recovery.
  - Follow after failure.

## Recovery procedure

- Prepare the input.
- Repair the state.
- Validate the result.
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document]).map((finding) => finding.code)).toContain(
    CortexArticleFindingCode.UnorderedProcedure,
  );
});

test('recognizes qualified procedure and runbook headings', () => {
  const headings = ['Procedure for recovery', 'Runbook: release'];
  for (const heading of headings) {
    const anchor = heading.toLowerCase().replaceAll(/[^a-z]+/g, '-');
    const documentArgs: MakeDocumentArgs = {
      path: `.cortex/${anchor}.md`,
      content: `# Qualified procedure

## Relationships

- None.

## Document map

- [${heading}](#${anchor})
  - Defines ordered work.
  - Follow while performing the work.

## ${heading}

- Prepare the input.
- Perform the action.
- Validate the result.
`,
    };
    const document = makeDocument(documentArgs);
    expect(audit([document]).map((finding) => finding.code)).toContain(
      CortexArticleFindingCode.UnorderedProcedure,
    );
  }
});

test('allows workflow and migration headings that define unordered rules', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/reference-rules.md',
    content: `# Reference rules

## Relationships

- None.

## Document map

- [Workflow concurrency policy](#workflow-concurrency-policy)
  - Defines concurrency rules.
  - Read while configuring workflows.
- [Migration](#migration)
  - Defines migration boundaries.
  - Read while planning a migration.

## Workflow concurrency policy

- Separate pull requests use separate concurrency groups.
- Main runs serialize cache publication.

## Migration

- The ledger may shrink.
- The ledger must not grow.
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document])).toEqual([]);
});

test('rejects mapped articles with no body content', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/empty.md',
    content: `# Empty

## Relationships

- None.

## Document map

- [Empty article](#empty-article)
  - Names the empty article.
  - Read to find the failure.

## Empty article
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document]).map((finding) => finding.code)).toContain(
    CortexArticleFindingCode.EmptyArticle,
  );
});

test('does not count an invisible comment as article content', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/comment-only.md',
    content: `# Comment only

## Relationships

- None.

## Document map

- [Empty article](#empty-article)
  - Names the empty article.
  - Read to find the failure.

## Empty article

<!-- TODO: write the article -->
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document]).map((finding) => finding.code)).toContain(
    CortexArticleFindingCode.EmptyArticle,
  );
});

test('rejects documents with no content articles after the map', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/no-articles.md',
    content: `# No articles

## Relationships

- None.

## Document map
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document]).map((finding) => finding.code)).toContain(
    CortexArticleFindingCode.EmptyArticle,
  );
});

test('treats Markdown comments as transparent to dense prose runs', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/commented-prose.md',
    content: `# Commented prose

## Relationships

- None.

## Document map

- [Explanation](#explanation)
  - Explains the topic.
  - Read for rationale.

## Explanation

First paragraph.

<!-- internal authoring note -->

Second paragraph.

<!-- another internal note -->

Third paragraph.

<!-- final internal note -->

Fourth paragraph.
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document]).map((finding) => finding.code)).toContain(
    CortexArticleFindingCode.DenseArticle,
  );
});

test('ignores procedure-like headings inside examples and quotes', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/examples.md',
    content: `# Examples

## Relationships

- None.

## Document map

- [Examples](#examples)
  - Shows literal syntax.
  - Read while authoring examples.

## Examples

Literal examples do not create structural articles.

\`\`\`markdown
## Broken workflow

- This is literal example text.
\`\`\`

> ## Quoted procedure
>
> - This is quoted text.

<div>
## HTML procedure
</div>
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document])).toEqual([]);
});

test('rejects article migration exemptions added after the baseline', () => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'article-ledger-'));
  try {
    const cortexRoot = path.join(repositoryRoot, '.cortex');
    mkdirSync(cortexRoot);
    const ledgerPath = path.join(cortexRoot, 'article-structure-migration.txt');
    writeFileSync(ledgerPath, '.cortex/structured.md\n');
    const document = makeDocument(STRUCTURED_DOCUMENT_ARGS);
    const args: AuditCortexArticleStructureArgs = {
      documents: [document],
      migrationBaselineEntries: [],
      migrationLedgerPath: ledgerPath,
      repoRoot: repositoryRoot,
    };
    const findings = auditCortexArticleStructure(args);
    expect(findings.map((finding) => finding.code)).toContain(
      CortexArticleFindingCode.InvalidMigrationLedger,
    );
  } finally {
    const removeOptions = { recursive: true, force: true } as const;
    rmSync(repositoryRoot, removeOptions);
  }
});
