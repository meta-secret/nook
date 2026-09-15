import { expect, test } from 'bun:test';

import { CortexStructureFindingCode } from '../src/cortex-document-structure.ts';
import { CortexDocumentMapCortexDocumentStructureScenario } from './cortex-document-structure-scenario.ts';
import type { MakeDocumentArgs } from './cortex-document-structure-scenario.ts';

test('requires the sole H1 title to be the first document node', () => {
  const documentArgs: MakeDocumentArgs = {
    path: '.cortex/late-title.md',
    content: `Some intro text before title.

# Late title

## Purpose
`,
  };
  const document =
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument(documentArgs);
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit([
      CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
        path: '.cortex/knowledge-graph.md',
        content: '# Index\n\n- [Late title](late-title.md)\n',
      }),
      document,
    ]).map((finding) => finding.code),
  ).toContain(CortexStructureFindingCode.InvalidTitle);
});

test('rejects block, inline, comment, and indexed Cortex HTML nodes', () => {
  const htmlDocuments = [
    '<details>Block HTML</details>',
    'Before <span>inline HTML</span> after.',
    '<!-- authoring note -->',
    'Generic types such as Option<T> are still HTML syntax.',
    '- Nested <mark>list HTML</mark>.',
  ];
  for (const content of htmlDocuments) {
    const document =
      CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
        path: '.cortex/html.md',
        content: `# HTML\n\n## Policy\n\n${content}\n`,
      });
    expect(
      CortexDocumentMapCortexDocumentStructureScenario.auditSyntax([
        document,
      ]).map((finding) => finding.code),
    ).toContain(CortexStructureFindingCode.ProhibitedHtml);
  }

  const index = CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
    path: '.cortex/knowledge-graph.md',
    content: '# Index\n\n<!-- hidden index note -->\n',
  });
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.auditSyntax([index]).map(
      (finding) => finding.code,
    ),
  ).toContain(CortexStructureFindingCode.ProhibitedHtml);
});

test('allows escaped HTML text and HTML examples inside code', () => {
  const document =
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
      path: '.cortex/a.md',
      content: `# A

## Overview

Escaped text: &lt;span&gt;not HTML&lt;/span&gt;.

Inline code: \`<span>not HTML</span>\`.

Autolink: <https://example.com>.

\`\`\`html
<!-- example only -->
<span>example only</span>
\`\`\`

    <!-- indented example only -->
    <span>indented example only</span>

### Details

Details text.
`,
    });
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.auditSyntax([document]),
  ).toEqual([]);
});

test('does not exempt legacy documents from the HTML prohibition', () => {
  const legacy = CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
    path: '.cortex/legacy.md',
    content: '# Legacy\n\n## Policy\n\n<div>Legacy HTML</div>\n',
  });
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.auditSyntax([legacy]).map(
      (finding) => finding.code,
    ),
  ).toContain(CortexStructureFindingCode.ProhibitedHtml);
});
