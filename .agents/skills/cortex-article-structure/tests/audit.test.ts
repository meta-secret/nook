import { expect, test } from 'bun:test';
import { auditCortexArticleStructure } from '../src/audit.ts';
import {
  CortexArticleFindingCode,
  CortexArticleContractKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
} from '../src/domain.ts';
import { blocksFromMarkdown } from './markdown-fixture.ts';

type MakeDocumentArgs = {
  readonly path: string;
  readonly content: string;
};

function makeDocument(args: MakeDocumentArgs): CortexArticleDocument {
  return {
    relativePath: args.path,
    blocks: blocksFromMarkdown(args.content),
  };
}

function audit(documents: readonly CortexArticleDocument[]) {
  const request: AuditCortexArticleStructureRequest = {
    kind: CortexArticleContractKind.Request,
    documents,
    migrationBaselineEntries: false,
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration.txt',
      content: false,
    },
  };
  return auditCortexArticleStructure(request);
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

test('recognizes a GFM table without outer pipes as visible structure', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/compact-table.md',
    content: `# Compact table

## Relationships

- None.

## Document map

- [Reference](#reference)
  - Presents structured facts.
  - Read while comparing values.

## Reference

First paragraph.

Shape | Use
--- | ---
Rule | Parallel constraints

Second paragraph.

Third paragraph.

Fourth paragraph.
`,
  };
  expect(audit([makeDocument(documentArgs)])).toEqual([]);
});

test('recognizes indented ATX and Setext article headings with exact lines', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/heading-forms.md',
    content: `# Heading forms

## Relationships

- None.

## Document map

- [Recovery procedure](#recovery-procedure)
  - Defines recovery.
  - Follow after failure.
- [Release steps](#release-steps)
  - Defines release work.
  - Follow during release.

 ## Recovery procedure

- Prepare the input.

Release *steps*
---------------

- Publish the artifact.
`,
  };
  const findings = audit([makeDocument(documentArgs)]);
  expect(findings).toHaveLength(2);
  expect(findings.map((finding) => finding.line)).toEqual([16, 20]);
  expect(findings.map((finding) => finding.code)).toEqual([
    CortexArticleFindingCode.UnorderedProcedure,
    CortexArticleFindingCode.UnorderedProcedure,
  ]);
});

test('recognizes multiline Setext heading text from its first source line', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/multiline-setext.md',
    content: `# Multiline Setext

## Relationships

- None.

## Document map

- [Release steps](#release-steps)
  - Defines release work.
  - Follow during release.

Release
steps
-----

- Publish the artifact.
`,
  };
  const findings = audit([makeDocument(documentArgs)]);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.line).toBe(13);
  expect(findings[0]?.message).toContain('#Release\nsteps');
});

test('normalizes linked and escaped heading text without losing source line', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/decorated-heading.md',
    content: `# Decorated heading

## Relationships

- None.

## Document map

- [Recovery procedure](#recovery-procedure)
  - Defines recovery.
  - Follow after failure.

## [Recovery *procedure*](#recovery-procedure) \#1 with \`code_value\`

- Prepare the input.
`,
  };
  const findings = audit([makeDocument(documentArgs)]);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.line).toBe(13);
  expect(findings[0]?.message).toContain(
    'Recovery procedure #1 with code_value',
  );
});

test('resets prose density at thematic breaks and non-comment HTML blocks', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/prose-boundaries.md',
    content: `# Prose boundaries

## Relationships

- None.

## Document map

- [Explanation](#explanation)
  - Explains boundaries.
  - Read while writing prose.

## Explanation

First paragraph.

Second paragraph.

---

Third paragraph.

<aside>
Rendered callout.
</aside>

Fourth paragraph.
`,
  };
  expect(audit([makeDocument(documentArgs)])).toEqual([]);
});

test('terminates every supported HTML block form before later articles', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/html-boundaries.md',
    content: `# HTML boundaries

## Relationships

- None.

## Document map

- [Examples](#examples)
  - Shows HTML boundaries.
  - Read while writing examples.
- [Recovery procedure](#recovery-procedure)
  - Defines recovery.
  - Follow after failure.

## Examples

<aside>Same-line callout.</aside>

<hr>

<br />

<section>
Multiline callout.
</section>

<article>
Unclosed block ends at the blank line.

## Recovery procedure

- Prepare the input.
`,
  };
  const findings = audit([makeDocument(documentArgs)]);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.code).toBe(CortexArticleFindingCode.UnorderedProcedure);
  expect(findings[0]?.line).toBe(31);
});

test('keeps multiline definitions transparent to dense prose', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/multiline-definition.md',
    content: `# Multiline definition

## Relationships

- None.

## Document map

- [Explanation](#explanation)
  - Explains the topic.
  - Read for rationale.

## Explanation

First paragraph.

[manual]: https://example.com/manual
  "Reference manual"

Second paragraph.

Third paragraph.

Fourth paragraph.
`,
  };
  expect(
    audit([makeDocument(documentArgs)]).map((finding) => finding.code),
  ).toContain(CortexArticleFindingCode.DenseArticle);
});

test('does not treat a partial table delimiter as structure', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/not-a-table.md',
    content: `# Not a table

## Relationships

- None.

## Document map

- [Explanation](#explanation)
  - Explains the topic.
  - Read for rationale.

## Explanation

First | paragraph.
--- not-a-table

Second paragraph.

Third paragraph.

Fourth paragraph.
`,
  };
  expect(
    audit([makeDocument(documentArgs)]).map((finding) => finding.code),
  ).toContain(CortexArticleFindingCode.DenseArticle);
});

test('does not expose nested headings or code examples as root articles', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/nested-forms.md',
    content: `# Nested forms

## Relationships

- None.

## Document map

- [Examples](#examples)
  - Shows nested syntax.
  - Read while authoring examples.

## Examples

- Parent item.

  ## Nested procedure

    ## Indented procedure

> ## Quoted procedure

\`\`\`markdown

## Fenced procedure

\`\`\`
`,
  };
  expect(audit([makeDocument(documentArgs)])).toEqual([]);
});

test('does not accept an overlong ordered-list marker as procedure structure', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/ordered-marker.md',
    content: `# Ordered marker

## Relationships

- None.

## Document map

- [Recovery procedure](#recovery-procedure)
  - Defines recovery.
  - Follow after failure.

## Recovery procedure

1234567890. This is prose, not a CommonMark ordered-list item.
`,
  };
  expect(
    audit([makeDocument(documentArgs)]).map((finding) => finding.code),
  ).toContain(CortexArticleFindingCode.UnorderedProcedure);
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
  const document = makeDocument(STRUCTURED_DOCUMENT_ARGS);
  const request: AuditCortexArticleStructureRequest = {
    kind: CortexArticleContractKind.Request,
    documents: [document],
    migrationBaselineEntries: [],
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration.txt',
      content: '.cortex/structured.md\n',
    },
  };
  const findings = auditCortexArticleStructure(request);
  expect(findings.map((finding) => finding.code)).toContain(
    CortexArticleFindingCode.InvalidMigrationLedger,
  );
});
