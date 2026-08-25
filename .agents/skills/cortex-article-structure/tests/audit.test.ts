import { expect, test } from 'bun:test';
import { auditCortexArticleStructure } from '../src/audit.ts';
import {
  CortexArticleBlockKind,
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

test('rejects substantive articles with no body content', () => {
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
    const documentArgs: MakeDocumentArgs = {
      path: '.cortex/html-separator.md',
      content: `# HTML separator\n\n## Empty article\n\n${separator}\n`,
    };
    expect(
      audit([makeDocument(documentArgs)]).map((item) => item.code),
    ).toEqual([CortexArticleFindingCode.EmptyArticle]);
  }
  const visibleArgs: MakeDocumentArgs = {
    path: '.cortex/html-callout.md',
    content:
      '# HTML callout\n\n## Visible article\n\n<!--a--><aside>Warning.</aside><!--b-->\n',
  };
  expect(audit([makeDocument(visibleArgs)])).toEqual([]);
  const resetArgs: MakeDocumentArgs = {
    path: '.cortex/html-reset.md',
    content:
      '# HTML reset\n\n## Explanation\n\nOne.\n\nTwo.\n\nThree.\n\n<!--a--><hr><!--b-->\n\nFour.\n',
  };
  expect(audit([makeDocument(resetArgs)])).toEqual([]);
});

test('normalizes blank tables and empty HTML containers to separators', () => {
  for (const body of [
    '| | |\n| --- | --- |\n| | |',
    '<div></div>',
    '<div><section><span></span></section></div>',
    '<div><!-- hidden --><hr><br></div>',
  ]) {
    const documentArgs: MakeDocumentArgs = {
      path: '.cortex/semantic-empty.md',
      content: `# Semantic empty\n\n## Empty article\n\n${body}\n`,
    };
    const document = makeDocument(documentArgs);
    expect(document.blocks.at(-1)?.type).toBe(CortexArticleBlockKind.Separator);
    expect(audit([document]).map((finding) => finding.code)).toEqual([
      CortexArticleFindingCode.EmptyArticle,
    ]);
  }
  for (const body of [
    '| Name |\n| --- |\n| Visible |',
    '<div><span>Visible</span></div>',
    '<div><img src="visible.png"></div>',
  ]) {
    const documentArgs: MakeDocumentArgs = {
      path: '.cortex/semantic-visible.md',
      content: `# Semantic visible\n\n## Visible article\n\n${body}\n`,
    };
    expect(audit([makeDocument(documentArgs)])).toEqual([]);
  }
});

test('normalizes non-rendered raw HTML containers to separators', () => {
  for (const body of [
    '<script>noop</script>',
    '<style>.hidden { display: none; }</style>',
    '<template><p>Hidden template content.</p></template>',
  ]) {
    const documentArgs: MakeDocumentArgs = {
      path: '.cortex/non-rendered-html.md',
      content: `# Non-rendered HTML\n\n## Empty article\n\n${body}\n`,
    };
    const document = makeDocument(documentArgs);
    expect(document.blocks.at(-1)?.type).toBe(CortexArticleBlockKind.Separator);
    expect(audit([document]).map((finding) => finding.code)).toEqual([
      CortexArticleFindingCode.EmptyArticle,
    ]);
  }
});

test('normalizes Markdown inside matched HTML containers as structure', () => {
  for (const container of [
    '<div>\n\n## Example procedure\n\n1. fake\n\n</div>',
    '<div>\n\n<section>\n\n## Example procedure\n\n1. fake\n\n</section>\n\n</div>',
  ]) {
    const documentArgs: MakeDocumentArgs = {
      path: '.cortex/html-scope.md',
      content: `# HTML scope

## Recovery procedure

Explanation.

${container}
`,
    };
    const document = makeDocument(documentArgs);
    expect(
      document.blocks.filter(
        (block) => block.type === CortexArticleBlockKind.Heading,
      ),
    ).toHaveLength(2);
    expect(
      document.blocks.filter(
        (block) => block.type === CortexArticleBlockKind.List,
      ),
    ).toEqual([]);
    const findings = audit([document]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe(CortexArticleFindingCode.UnorderedProcedure);
    expect(findings[0]?.line).toBe(3);
  }
});

test('recovers root blocks after mismatched HTML container closes', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/html-mismatch.md',
    content: `# HTML mismatch

## Examples

<div>

<section>

## Fake procedure

1. fake

</div>

## Recovery procedure

- Prepare the input.

</section>
`,
  };
  const document = makeDocument(documentArgs);
  const findings = audit([document]);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.code).toBe(CortexArticleFindingCode.UnorderedProcedure);
  expect(findings[0]?.line).toBe(15);
});

test('ignores tag-looking raw text while normalizing HTML scope', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/raw-html-scope.md',
    content: `# Raw HTML scope

## Examples

<div>

<script>const close = "</div>";</script>

## Fake procedure

- fake

</div>

## Recovery procedure

- Prepare the input.
`,
  };
  const document = makeDocument(documentArgs);
  const findings = audit([document]);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.code).toBe(CortexArticleFindingCode.UnorderedProcedure);
  expect(findings[0]?.line).toBe(15);
});

test('audits empty, dense, and procedure articles without a document map', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/no-articles.md',
    content: `# Direct articles

## Empty article

## Dense explanation

First paragraph.

Second paragraph.

Third paragraph.

Fourth paragraph.

## Recovery procedure

- Prepare the input.
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document]).map((finding) => finding.code)).toEqual([
    CortexArticleFindingCode.EmptyArticle,
    CortexArticleFindingCode.DenseArticle,
    CortexArticleFindingCode.UnorderedProcedure,
  ]);
});

test('treats Markdown comments as transparent to dense prose runs', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/commented-prose.md',
    content: `# Commented prose

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

 ## Recovery procedure

- Prepare the input.

Release *steps*
---------------

- Publish the artifact.
`,
  };
  const findings = audit([makeDocument(documentArgs)]);
  expect(findings).toHaveLength(2);
  expect(findings.map((finding) => finding.line)).toEqual([3, 7]);
  expect(findings.map((finding) => finding.code)).toEqual([
    CortexArticleFindingCode.UnorderedProcedure,
    CortexArticleFindingCode.UnorderedProcedure,
  ]);
});

test('recognizes multiline Setext heading text from its first source line', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/multiline-setext.md',
    content: `# Multiline Setext

Release
steps
-----

- Publish the artifact.
`,
  };
  const document = makeDocument(documentArgs);
  const expectedHeading = {
    text: 'Release\nsteps',
    type: 'heading',
  } as const;
  expect(document.blocks.find((block) => block.line === 3)).toMatchObject(
    expectedHeading,
  );
  const findings = audit([document]);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.line).toBe(3);
});

test('normalizes linked and escaped heading text without losing source line', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/decorated-heading.md',
    content: `# Decorated heading

## [Recovery *procedure*](#recovery-procedure) \#1 with \`code_value\`

- Prepare the input.
`,
  };
  const document = makeDocument(documentArgs);
  const expectedHeading = {
    text: 'Recovery procedure #1 with code_value',
    type: 'heading',
  } as const;
  expect(document.blocks.find((block) => block.line === 3)).toMatchObject(
    expectedHeading,
  );
  const findings = audit([document]);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.line).toBe(3);
});

test('resets prose density at thematic breaks and non-comment HTML blocks', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/prose-boundaries.md',
    content: `# Prose boundaries

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
  expect(findings[0]?.line).toBe(18);
});

test('keeps multiline definitions transparent to dense prose', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/multiline-definition.md',
    content: `# Multiline definition

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
