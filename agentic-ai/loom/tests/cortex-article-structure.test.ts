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

## Delivery policy

This article owns the recovery sequence.

### Recovery procedure

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
  const headings = [
    'Procedure for recovery',
    'Runbook: release',
    'Release steps',
    'Staged delivery sequence',
    'Ordered delivery for production',
    'Recovery procedures',
    'Deployment runbooks',
    'Delivery sequences for recovery',
    'Ordered deliveries for production',
  ];
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

test('rejects mapless substantive articles with no body content', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/empty.md',
    content: `# Empty

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

test('does not count an empty fenced block as article content', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/empty-code.md',
    content: '# Empty code\n\n## Empty article\n\n```text\n```\n',
  };
  expect(audit([makeDocument(documentArgs)]).map((item) => item.code)).toEqual([
    CortexArticleFindingCode.EmptyArticle,
  ]);
});

test('does not count empty container blocks as article content', () => {
  for (const container of [
    '>',
    '-',
    '1.',
    '> <!-- hidden -->',
    '- <!-- hidden -->',
    '1. <!-- hidden -->',
    '> <hr>',
    '- <br>',
  ]) {
    const documentArgs: MakeDocumentArgs = {
      path: '.cortex/empty-container.md',
      content: `# Empty container\n\n## Empty article\n\n${container}\n`,
    };
    expect(
      audit([makeDocument(documentArgs)]).map((item) => item.code),
    ).toEqual([CortexArticleFindingCode.EmptyArticle]);
  }
});

test('does not count paragraphs with only empty inline content', () => {
  for (const paragraph of ['` `', '[ ](https://example.com)']) {
    const documentArgs: MakeDocumentArgs = {
      path: '.cortex/empty-inline.md',
      content: `# Empty inline\n\n## Empty article\n\n${paragraph}\n`,
    };
    expect(
      audit([makeDocument(documentArgs)]).map((item) => item.code),
    ).toEqual([CortexArticleFindingCode.EmptyArticle]);
  }
  for (const paragraph of [
    '![](image.png)',
    '[Visible](https://example.com)',
  ]) {
    const documentArgs: MakeDocumentArgs = {
      path: '.cortex/visible-inline.md',
      content: `# Visible inline\n\n## Visible article\n\n${paragraph}\n`,
    };
    expect(audit([makeDocument(documentArgs)])).toEqual([]);
  }
  const resetArgs: MakeDocumentArgs = {
    path: '.cortex/empty-inline-reset.md',
    content:
      '# Empty inline reset\n\n## Explanation\n\nOne.\n\nTwo.\n\nThree.\n\n` `\n\nFour.\n',
  };
  expect(audit([makeDocument(resetArgs)])).toEqual([]);
});

test('does not satisfy a procedure with an empty ordered marker', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/empty-procedure-list.md',
    content: '# Procedure\n\n## Recovery procedure\n\nExplanation.\n\n1.\n',
  };
  expect(audit([makeDocument(documentArgs)]).map((item) => item.code)).toEqual([
    CortexArticleFindingCode.UnorderedProcedure,
  ]);
});

test('treats thematic breaks as invisible density-resetting separators', () => {
  const emptyArgs: MakeDocumentArgs = {
    path: '.cortex/break-only.md',
    content: '# Break only\n\n## Empty article\n\n---\n',
  };
  const resetArgs: MakeDocumentArgs = {
    path: '.cortex/break-density.md',
    content:
      '# Break density\n\n## Explanation\n\nOne.\n\nTwo.\n\nThree.\n\n---\n\nFour.\n\nFive.\n\nSix.\n',
  };
  const visibleArgs: MakeDocumentArgs = {
    path: '.cortex/code-structure.md',
    content: '# Code structure\n\n## Reference\n\n```text\nvalue\n```\n',
  };
  expect(
    audit([
      makeDocument(emptyArgs),
      makeDocument(resetArgs),
      makeDocument(visibleArgs),
    ]).map((finding) => finding.code),
  ).toEqual([CortexArticleFindingCode.EmptyArticle]);
});

test('treats raw HTML void separators as empty but preserves visible HTML', () => {
  for (const separator of [
    '<hr>',
    '<br>',
    '<hr />',
    '<BR/>',
    '<hr>\n<br>',
    '<hr class="rule">',
    '<br id="gap"/>',
    '<!-- spacer -->\n<hr>\n<br class="gap">',
  ]) {
    const emptyArgs: MakeDocumentArgs = {
      path: '.cortex/html-separator.md',
      content: `# HTML separator\n\n## Empty article\n\n${separator}\n`,
    };
    expect(
      audit([makeDocument(emptyArgs)]).map((finding) => finding.code),
    ).toEqual([CortexArticleFindingCode.EmptyArticle]);
  }
  const visibleArgs: MakeDocumentArgs = {
    path: '.cortex/html-callout.md',
    content:
      '# HTML callout\n\n## Visible article\n\n<!--a--><aside>Operational warning.</aside><!--b-->\n',
  };
  expect(audit([makeDocument(visibleArgs)])).toEqual([]);
  const resetArgs: MakeDocumentArgs = {
    path: '.cortex/html-reset.md',
    content:
      '# HTML reset\n\n## Explanation\n\nOne.\n\nTwo.\n\nThree.\n\n<!--a--><hr><!--b-->\n\nFour.\n',
  };
  expect(audit([makeDocument(resetArgs)])).toEqual([]);
});

test('does not treat an H1 title as a substantive article', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/title-only.md',
    content: '# Title only\n',
  };
  const document = makeDocument(documentArgs);
  expect(audit([document])).toEqual([]);
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

test('treats a GFM table as visible article structure', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/table-structure.md',
    content: `# Table structure

## Relationships

- None.

## Document map

- [Reference](#reference)
  - Presents structured facts.
  - Read while comparing values.

## Reference

Introductory paragraph.

| Shape | Use |
| --- | --- |
| Rule | Parallel constraints |
| Procedure | Ordered actions |

Second paragraph.

Third paragraph.

Fourth paragraph.
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document])).toEqual([]);
});

test('does not count a link definition as article content', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/definition-only.md',
    content: `# Definition only

## Relationships

- None.

## Document map

- [Empty article](#empty-article)
  - Names the empty article.
  - Read to find the failure.

## Empty article

[manual]: https://example.com
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document]).map((finding) => finding.code)).toContain(
    CortexArticleFindingCode.EmptyArticle,
  );
});

test('treats link definitions as transparent to dense prose runs', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/defined-prose.md',
    content: `# Defined prose

## Relationships

- None.

## Document map

- [Explanation](#explanation)
  - Explains the topic.
  - Read for rationale.

## Explanation

First paragraph.

[first]: https://example.com/first

Second paragraph.

[second]: https://example.com/second

Third paragraph.

[third]: https://example.com/third

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
