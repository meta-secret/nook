import path from 'node:path';
import { expect, test } from 'bun:test';
import {
  auditCortexArticleStructure,
  CortexArticleFindingCode,
} from '../src/lib/cortex-article-structure.ts';
import type { AuditCortexArticleStructureArgs } from '../src/lib/cortex-article-structure.ts';
import type { CortexDocumentSource } from '../../../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/cortex-document-structure.ts';

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

test('audits an empty H3 independently from its parent article', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/empty-subarticle.md',
    content: `# Empty subarticle

## Parent article

The parent has content.

### Empty child
`,
  };
  const findings = audit([makeDocument(documentArgs)]);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.code).toBe(CortexArticleFindingCode.EmptyArticle);
  expect(findings[0]?.line).toBe(7);
});

test('does not treat an H1 title as a substantive article', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/title-only.md',
    content: '# Title only\n',
  };
  const document = makeDocument(documentArgs);
  expect(audit([document])).toEqual([]);
});

test('rejects Markdown containers without visible content', () => {
  const emptyBodies = [
    '```text\n```',
    '    \u200B',
    '> \u200B',
    '- \u200B',
    '1. \u200B',
    '| | |\n| --- | --- |\n| | |',
    '`\u200B`',
    '[](https://example.com)',
  ];
  for (const [index, body] of emptyBodies.entries()) {
    const documentArgs: MakeDocumentArgs = {
      path: `.cortex/empty-${index}.md`,
      content: `# Empty\n\n## Empty article\n\n${body}\n`,
    };
    expect(
      audit([makeDocument(documentArgs)]).map((item) => item.code),
    ).toEqual([CortexArticleFindingCode.EmptyArticle]);
  }
});

test('accepts Markdown content that renders a visible image or link', () => {
  for (const body of ['![](asset.png)', '[manual](https://example.com)']) {
    const documentArgs: MakeDocumentArgs = {
      path: '.cortex/visible-reference.md',
      content: `# Visible\n\n## Reference\n\n${body}\n`,
    };
    expect(audit([makeDocument(documentArgs)])).toEqual([]);
  }
});

test('treats GFM task checkboxes as visible article content', () => {
  for (const taskItem of ['- [x] \u200B', '- [ ] \u200B']) {
    const documentArgs: MakeDocumentArgs = {
      path: '.cortex/task-item.md',
      content: `# Task item\n\n## Checklist\n\n${taskItem}\n`,
    };
    expect(audit([makeDocument(documentArgs)])).toEqual([]);
  }
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

[^note]: Hidden explanation.
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

[^note]: Hidden explanation.

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

test('uses a thematic break as structural relief but not article content', () => {
  const structuredArgs: MakeDocumentArgs = {
    path: '.cortex/thematic-density.md',
    content: `# Thematic density

## Explanation

First paragraph.

Second paragraph.

* * *

Third paragraph.

Fourth paragraph.
`,
  };
  expect(audit([makeDocument(structuredArgs)])).toEqual([]);

  const emptyArgs: MakeDocumentArgs = {
    path: '.cortex/thematic-empty.md',
    content: '# Thematic empty\n\n## Empty article\n\n* * *\n',
  };
  expect(audit([makeDocument(emptyArgs)]).map((item) => item.code)).toEqual([
    CortexArticleFindingCode.EmptyArticle,
  ]);
});

test('treats image-only paragraphs as structural rather than prose', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/image-structure.md',
    content: `# Image structure

## Reference

![](one.png)

![](two.png)

![](three.png)

![](four.png)
`,
  };
  expect(audit([makeDocument(documentArgs)])).toEqual([]);
});

test('continues H3 density auditing below an H4 heading', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/h4-density.md',
    content: `# H4 density

## Parent

Parent introduction.

### Explanation

#### Detail

First paragraph.

Second paragraph.

Third paragraph.

Fourth paragraph.
`,
  };
  expect(
    audit([makeDocument(documentArgs)]).map((item) => item.code),
  ).toContain(CortexArticleFindingCode.DenseArticle);
});

test('recognizes ordered actions nested in normal Markdown containers', () => {
  const acceptedArgs: MakeDocumentArgs = {
    path: '.cortex/nested-procedure.md',
    content:
      '# Nested\n\n## Recovery procedure\n\n- When recovery is required:\n  1. Restore the backup.\n',
  };
  expect(audit([makeDocument(acceptedArgs)])).toEqual([]);

  const rejectedArgs: MakeDocumentArgs = {
    path: '.cortex/example-procedure.md',
    content:
      '# Example\n\n## Recovery procedure\n\n> 1. Quoted.\n\n```markdown\n1. Fenced.\n```\n\n[^hidden]:\n    1. Footnote.\n',
  };
  expect(audit([makeDocument(rejectedArgs)]).map((item) => item.code)).toEqual([
    CortexArticleFindingCode.UnorderedProcedure,
  ]);
});

test('does not satisfy a procedure with an empty ordered item', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/empty-procedure-list.md',
    content:
      '# Procedure\n\n## Recovery procedure\n\nExplanation.\n\n1. \u200B\n',
  };
  expect(audit([makeDocument(documentArgs)]).map((item) => item.code)).toEqual([
    CortexArticleFindingCode.UnorderedProcedure,
  ]);
});

test('does not treat a checkbox alone as a procedure action', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/checkbox-procedure.md',
    content: '# Procedure\n\n## Recovery procedure\n\n1. [ ] \u200B\n',
  };
  expect(audit([makeDocument(documentArgs)]).map((item) => item.code)).toEqual([
    CortexArticleFindingCode.UnorderedProcedure,
  ]);
});

test('does not qualify ordered items containing only excluded examples', () => {
  const exampleBodies = [
    '1. > 1. Quoted example.',
    '1. ```markdown\n   1. Fenced example.\n   ```',
  ];
  for (const body of exampleBodies) {
    const documentArgs: MakeDocumentArgs = {
      path: '.cortex/ordered-example.md',
      content: `# Example\n\n## Recovery procedure\n\n${body}\n`,
    };
    expect(
      audit([makeDocument(documentArgs)]).map((item) => item.code),
    ).toEqual([CortexArticleFindingCode.UnorderedProcedure]);
  }
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
`,
  };
  const document = makeDocument(documentArgs);
  expect(audit([document])).toEqual([]);
});
