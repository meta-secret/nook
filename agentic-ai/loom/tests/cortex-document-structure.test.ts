import path from 'node:path';
import { expect, test } from 'bun:test';
import {
  auditCortexMarkdownSyntax,
  auditCortexDocumentStructure,
  CortexStructureFindingCode,
} from '../src/lib/cortex-document-structure.ts';
import type {
  AuditCortexMarkdownSyntaxArgs,
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
    excludedDocumentPaths: new Set(),
    repoRoot: REPO_ROOT,
  };
  return auditCortexDocumentStructure(args);
}

function auditSyntax(documents: readonly CortexDocumentSource[]) {
  const args: AuditCortexMarkdownSyntaxArgs = { documents };
  return auditCortexMarkdownSyntax(args);
}

const INDEX_DOC_ARGS: MakeDocumentArgs = {
  path: '.cortex/knowledge-graph.md',
  content: `# Cortex Knowledge Graph & Navigation Map

## Overview

Central index.

## Section

- [A](a.md)
- [B](b.md)
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

type DistributedDocumentsArgs = {
  readonly rootExtra: string;
  readonly devTarget: string;
  readonly gizmoTarget: string;
};

function distributedDocuments(
  args: DistributedDocumentsArgs,
): CortexDocumentSource[] {
  const rootDocumentArgs: MakeDocumentArgs = {
    path: '.cortex/knowledge-graph.md',
    content: `# Cortex Knowledge Graph

- [AI](teams/ai/knowledge-graph.md)
- [Development core](teams/dev-core/knowledge-graph.md)
- [Security](teams/security/knowledge-graph.md)
- [SRE](teams/sre/knowledge-graph.md)
- [Web development](teams/web-dev/knowledge-graph.md)
- [Shared](shared/knowledge-graph.md)
- [Gizmo](gizmo/knowledge-graph.md)
${args.rootExtra}`,
  };
  const aiGraphArgs: MakeDocumentArgs = {
    path: '.cortex/teams/ai/knowledge-graph.md',
    content: '# AI Knowledge Graph\n',
  };
  const devGraphArgs: MakeDocumentArgs = {
    path: '.cortex/teams/dev-core/knowledge-graph.md',
    content: `# Development Core Knowledge Graph\n\n- [Core policy](${args.devTarget})\n`,
  };
  const sreGraphArgs: MakeDocumentArgs = {
    path: '.cortex/teams/sre/knowledge-graph.md',
    content: '# SRE Knowledge Graph\n',
  };
  const securityGraphArgs: MakeDocumentArgs = {
    path: '.cortex/teams/security/knowledge-graph.md',
    content: '# Security Knowledge Graph\n',
  };
  const webGraphArgs: MakeDocumentArgs = {
    path: '.cortex/teams/web-dev/knowledge-graph.md',
    content: '# Web Development Knowledge Graph\n',
  };
  const sharedGraphArgs: MakeDocumentArgs = {
    path: '.cortex/shared/knowledge-graph.md',
    content: '# Shared Knowledge Graph\n',
  };
  const gizmoGraphArgs: MakeDocumentArgs = {
    path: '.cortex/gizmo/knowledge-graph.md',
    content: `# Gizmo Knowledge Graph\n\n- [Gizmo policy](${args.gizmoTarget})\n`,
  };
  const corePolicyArgs: MakeDocumentArgs = {
    path: '.cortex/teams/dev-core/policy.md',
    content: '# Core Policy\n\n## Boundary\n\nPolicy text.\n',
  };
  const gizmoPolicyArgs: MakeDocumentArgs = {
    path: '.cortex/gizmo/policy.md',
    content: '# Gizmo Policy\n\n## Boundary\n\nPolicy text.\n',
  };
  return [
    makeDocument(rootDocumentArgs),
    makeDocument(aiGraphArgs),
    makeDocument(devGraphArgs),
    makeDocument(securityGraphArgs),
    makeDocument(sreGraphArgs),
    makeDocument(webGraphArgs),
    makeDocument(sharedGraphArgs),
    makeDocument(gizmoGraphArgs),
    makeDocument(corePolicyArgs),
    makeDocument(gizmoPolicyArgs),
  ];
}

test('accepts document-level team and shared graphs', () => {
  const distributedArgs: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: 'policy.md',
    gizmoTarget: 'policy.md',
  };
  expect(audit(distributedDocuments(distributedArgs))).toEqual([]);
});

test('requires the root knowledge graph to link the Gizmo graph', () => {
  const distributedArgs: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: 'policy.md',
    gizmoTarget: 'policy.md',
  };
  const documents = distributedDocuments(distributedArgs);
  const rootDocument = documents[0];
  if (!rootDocument) throw new Error('Expected distributed root document');
  documents[0] = {
    ...rootDocument,
    content: rootDocument.content.replace(
      '- [Gizmo](gizmo/knowledge-graph.md)\n',
      '',
    ),
  };
  const findings = audit(documents);
  const expectedFinding = {
    code: CortexStructureFindingCode.MissingFromIndex,
    file: '.cortex/knowledge-graph.md',
    message:
      'Root knowledge graph must link the owner graph: .cortex/gizmo/knowledge-graph.md',
  };
  expect(findings).toContainEqual(expect.objectContaining(expectedFinding));
});

test('maps Gizmo-owned documents to the Gizmo knowledge graph', () => {
  const distributedArgs: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: 'policy.md',
    gizmoTarget: 'missing-policy.md',
  };
  const findings = audit(distributedDocuments(distributedArgs));
  const expectedFinding = {
    code: CortexStructureFindingCode.MissingFromIndex,
    file: '.cortex/gizmo/knowledge-graph.md',
    message:
      'Document is not indexed in its owning knowledge graph .cortex/gizmo/knowledge-graph.md: .cortex/gizmo/policy.md',
  };
  expect(findings).toContainEqual(expect.objectContaining(expectedFinding));
});

test('rejects section links and duplicate document entries in knowledge graphs', () => {
  const distributedArgs: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: 'policy.md#boundary',
    gizmoTarget: 'policy.md',
  };
  const findings = audit(distributedDocuments(distributedArgs));
  const expectedFinding = {
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: '.cortex/teams/dev-core/knowledge-graph.md',
  };
  expect(findings).toContainEqual(expect.objectContaining(expectedFinding));
});

test('rejects root navigation that bypasses an owning graph', () => {
  const distributedArgs: DistributedDocumentsArgs = {
    rootExtra: '- [Core policy](teams/dev-core/policy.md)\n',
    devTarget: 'policy.md',
    gizmoTarget: 'policy.md',
  };
  const findings = audit(distributedDocuments(distributedArgs));
  expect(findings.map((finding) => finding.code)).toContain(
    CortexStructureFindingCode.InvalidIndexEntry,
  );
});

test('rejects a team graph that indexes another team document', () => {
  const distributedArgs: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: '../sre/policy.md',
    gizmoTarget: 'policy.md',
  };
  const documents = distributedDocuments(distributedArgs);
  const srePolicyArgs: MakeDocumentArgs = {
    path: '.cortex/teams/sre/policy.md',
    content: '# SRE Policy\n',
  };
  documents.push(makeDocument(srePolicyArgs));
  const findings = audit(documents);
  const expectedFinding = {
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: '.cortex/teams/dev-core/knowledge-graph.md',
  };
  expect(findings).toContainEqual(expect.objectContaining(expectedFinding));
});

test('rejects cross-owner indexing between Gizmo and team graphs', () => {
  const gizmoIndexesTeamArgs: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: 'policy.md',
    gizmoTarget: '../teams/dev-core/policy.md',
  };
  const gizmoFindings = audit(distributedDocuments(gizmoIndexesTeamArgs));
  const gizmoFinding = {
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: '.cortex/gizmo/knowledge-graph.md',
  };
  expect(gizmoFindings).toContainEqual(expect.objectContaining(gizmoFinding));

  const teamIndexesGizmoArgs: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: '../../gizmo/policy.md',
    gizmoTarget: 'policy.md',
  };
  const teamFindings = audit(distributedDocuments(teamIndexesGizmoArgs));
  const teamFinding = {
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: '.cortex/teams/dev-core/knowledge-graph.md',
  };
  expect(teamFindings).toContainEqual(expect.objectContaining(teamFinding));
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

test('rejects block, inline, comment, and indexed Cortex HTML nodes', () => {
  const htmlDocuments = [
    '<details>Block HTML</details>',
    'Before <span>inline HTML</span> after.',
    '<!-- authoring note -->',
    'Generic types such as Option<T> are still HTML syntax.',
    '- Nested <mark>list HTML</mark>.',
  ];
  for (const content of htmlDocuments) {
    const documentArgs: MakeDocumentArgs = {
      path: '.cortex/html.md',
      content: `# HTML\n\n## Policy\n\n${content}\n`,
    };
    const document = makeDocument(documentArgs);
    expect(auditSyntax([document]).map((finding) => finding.code)).toContain(
      CortexStructureFindingCode.ProhibitedHtml,
    );
  }

  const indexArgs: MakeDocumentArgs = {
    path: '.cortex/knowledge-graph.md',
    content: '# Index\n\n<!-- hidden index note -->\n',
  };
  const index = makeDocument(indexArgs);
  expect(auditSyntax([index]).map((finding) => finding.code)).toContain(
    CortexStructureFindingCode.ProhibitedHtml,
  );
});

test('allows escaped HTML text and HTML examples inside code', () => {
  const documentArgs: MakeDocumentArgs = {
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
  };
  const document = makeDocument(documentArgs);
  expect(auditSyntax([document])).toEqual([]);
});

test('does not exempt legacy documents from the HTML prohibition', () => {
  const legacyArgs: MakeDocumentArgs = {
    path: '.cortex/legacy.md',
    content: '# Legacy\n\n## Policy\n\n<div>Legacy HTML</div>\n',
  };
  const legacy = makeDocument(legacyArgs);
  expect(auditSyntax([legacy]).map((finding) => finding.code)).toContain(
    CortexStructureFindingCode.ProhibitedHtml,
  );
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
