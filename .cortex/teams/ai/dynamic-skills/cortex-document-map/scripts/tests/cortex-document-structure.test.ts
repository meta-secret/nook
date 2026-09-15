import { expect, test } from 'bun:test';

import { CortexStructureFindingCode } from '../src/cortex-document-structure.ts';
import {
  CortexDocumentMapCortexDocumentStructureScenario,
  PIPELINE_GRAPH_PATH,
} from './cortex-document-structure-scenario.ts';
import type {
  DistributedDocumentsArgs,
  MakeDocumentArgs,
} from './cortex-document-structure-scenario.ts';

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

const INDEX_DOC =
  CortexDocumentMapCortexDocumentStructureScenario.makeDocument(INDEX_DOC_ARGS);

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

const DOCUMENT_A =
  CortexDocumentMapCortexDocumentStructureScenario.makeDocument(
    DOCUMENT_A_ARGS,
  );

const DOCUMENT_B_ARGS: MakeDocumentArgs = {
  path: '.cortex/b.md',
  content: `# B

## Details

Details text.
`,
};

const DOCUMENT_B =
  CortexDocumentMapCortexDocumentStructureScenario.makeDocument(
    DOCUMENT_B_ARGS,
  );

test('accepts clean documents and valid centralized knowledge-graph.md', () => {
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit([
      INDEX_DOC,
      DOCUMENT_A,
      DOCUMENT_B,
    ]),
  ).toEqual([]);
});

test('accepts document-level team and shared graphs', () => {
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(
      CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments(),
    ),
  ).toEqual([]);
});

test('allows every child graph to reference the root circuit breaker read-only', () => {
  const circuitBreakerPath = '.cortex/CIRCUIT-BREAKER.md';
  const childGraphPath =
    '.cortex/teams/delivery-pipeline/pr-lifecycle/knowledge-graph.md';
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.nestedDistributedDocuments();
  documents.push(
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
      path: circuitBreakerPath,
      content: '# Agent Derailment Circuit Breaker\n',
    }),
  );
  const linkedDocuments = documents.map((document) => {
    if (document.relativePath === '.cortex/knowledge-graph.md') {
      return {
        ...document,
        content: `${document.content}\n- [Circuit breaker](CIRCUIT-BREAKER.md)\n`,
      };
    }
    if (document.relativePath === childGraphPath) {
      return {
        ...document,
        content: `${document.content}\n- [Circuit breaker](../../../CIRCUIT-BREAKER.md)\n`,
      };
    }
    if (document.relativePath === PIPELINE_GRAPH_PATH) {
      return {
        ...document,
        content: `${document.content}\n- [Circuit breaker](../../CIRCUIT-BREAKER.md)\n`,
      };
    }
    return document;
  });

  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(linkedDocuments),
  ).toEqual([]);
});

test('indexes Dev Manager documents only through their owning graph', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments();
  const managerGraphPath =
    '.cortex/teams/delivery-pipeline/dev-manager/knowledge-graph.md';
  const policyPath = '.cortex/teams/delivery-pipeline/dev-manager/policy.md';
  documents.push(
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
      path: managerGraphPath,
      content: '# Dev Manager Knowledge Graph\n',
    }),
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
      path: policyPath,
      content: '# Dev Publication Policy\n',
    }),
  );
  const findings =
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents);
  expect(findings).toContainEqual({
    code: CortexStructureFindingCode.MissingFromIndex,
    file: managerGraphPath,
    line: 1,
    message: `Document is not indexed in its owning knowledge graph ${managerGraphPath}: ${policyPath}`,
  });
  const indexedDocuments = documents.map((document) =>
    document.relativePath === managerGraphPath
      ? { ...document, content: `${document.content}\n- [Policy](policy.md)\n` }
      : document,
  );
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(indexedDocuments),
  ).toEqual([]);
  const foreignIndex = indexedDocuments.map((document) =>
    document.relativePath === '.cortex/gizmo-prime/knowledge-graph.md'
      ? {
          ...document,
          content: `${document.content}\n- [Dev policy](../teams/delivery-pipeline/dev-manager/policy.md)\n`,
        }
      : document,
  );
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(foreignIndex),
  ).toContainEqual({
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: '.cortex/gizmo-prime/knowledge-graph.md',
    line: 1,
    message: `Owning knowledge graph cannot index another context's document: ${policyPath}`,
  });
});

test('indexes Team Gizmo documents only through their owning graph', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments();
  const graphPath = '.cortex/teams/delivery-pipeline/gizmo/knowledge-graph.md';
  const policyPath = '.cortex/teams/delivery-pipeline/gizmo/policy.md';
  documents.push(
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
      path: graphPath,
      content: '# Delivery Pipeline Team Gizmo\n',
    }),
  );
  documents.push(
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
      path: policyPath,
      content: '# Team Gizmo Policy\n',
    }),
  );
  const findings =
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents);
  expect(findings).toContainEqual({
    code: CortexStructureFindingCode.MissingFromIndex,
    file: graphPath,
    line: 1,
    message: `Document is not indexed in its owning knowledge graph ${graphPath}: ${policyPath}`,
  });
  const indexedDocuments = documents.map((document) =>
    document.relativePath === graphPath
      ? { ...document, content: `${document.content}\n- [Policy](policy.md)\n` }
      : document,
  );
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(indexedDocuments),
  ).toEqual([]);
});

test('indexes Delivery Pipeline documents only through their owning graph', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments();
  const policyPath = '.cortex/teams/delivery-pipeline/policy.md';
  documents.push(
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
      path: policyPath,
      content: '# Delivery Pipeline Policy\n',
    }),
  );
  const findings =
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents);
  expect(findings).toContainEqual({
    code: CortexStructureFindingCode.MissingFromIndex,
    file: PIPELINE_GRAPH_PATH,
    line: 1,
    message: `Document is not indexed in its owning knowledge graph ${PIPELINE_GRAPH_PATH}: ${policyPath}`,
  });
  const indexedDocuments = documents.map((document) =>
    document.relativePath === PIPELINE_GRAPH_PATH
      ? { ...document, content: `${document.content}\n- [Policy](policy.md)\n` }
      : document,
  );
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(indexedDocuments),
  ).toEqual([]);
  const foreignIndex = indexedDocuments.map((document) =>
    document.relativePath === '.cortex/gizmo-prime/knowledge-graph.md'
      ? {
          ...document,
          content: `${document.content}\n- [Delivery Pipeline policy](../teams/delivery-pipeline/policy.md)\n`,
        }
      : document,
  );
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(foreignIndex),
  ).toContainEqual({
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: '.cortex/gizmo-prime/knowledge-graph.md',
    line: 1,
    message: `Owning knowledge graph cannot index another context's document: ${policyPath}`,
  });
});

test('audits Delivery Pipeline direct child graphs with matching ownership', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.nestedDistributedDocuments();
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents),
  ).toEqual([]);

  const lifecycleGraphPath =
    '.cortex/teams/delivery-pipeline/pr-lifecycle/knowledge-graph.md';
  const lifecyclePolicyPath =
    '.cortex/teams/delivery-pipeline/pr-lifecycle/workflows/policy.md';
  const parentOnlyIndex = documents.map((document) => {
    if (document.relativePath === lifecycleGraphPath) {
      return {
        ...document,
        content: '# Delivery Pipeline PR Lifecycle Knowledge Graph\n',
      };
    }
    if (document.relativePath === PIPELINE_GRAPH_PATH) {
      return {
        ...document,
        content: `${document.content}- [Policy](${lifecyclePolicyPath.replace(
          '.cortex/teams/delivery-pipeline/',
          '',
        )})\n`,
      };
    }
    return document;
  });
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(parentOnlyIndex),
  ).toContainEqual({
    code: CortexStructureFindingCode.MissingFromIndex,
    file: lifecycleGraphPath,
    line: 1,
    message: `Document is not indexed in its owning knowledge graph ${lifecycleGraphPath}: ${lifecyclePolicyPath}`,
  });
});

test('rejects sibling same-team child authority from a child graph', () => {
  const managerGraphPath =
    '.cortex/teams/delivery-pipeline/dev-manager/knowledge-graph.md';
  const siblingGraphPath =
    '.cortex/teams/delivery-pipeline/gizmo/knowledge-graph.md';
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.nestedDistributedDocuments().map(
      (document) =>
        document.relativePath === managerGraphPath
          ? {
              ...document,
              content: `${document.content}- [Sibling authority](../gizmo/knowledge-graph.md)\n`,
            }
          : document,
    );
  const findings =
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents);
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.hasFinding(findings, {
      code: CortexStructureFindingCode.InvalidIndexEntry,
      file: managerGraphPath,
      message: `Child knowledge graph may link only its own directory or explicit read-only authorities: ${siblingGraphPath}`,
    }),
  ).toBe(true);
});

test('admits a same-team sibling AGENTS authority as read-only', () => {
  const managerGraphPath =
    '.cortex/teams/delivery-pipeline/dev-manager/knowledge-graph.md';
  const siblingAuthorityPath =
    '.cortex/teams/delivery-pipeline/gizmo/AGENTS.md';
  const documents = [
    ...CortexDocumentMapCortexDocumentStructureScenario.nestedDistributedDocuments().map(
      (document) =>
        document.relativePath === managerGraphPath
          ? {
              ...document,
              content: `${document.content}- [Sibling authority](../gizmo/AGENTS.md)\n`,
            }
          : document,
    ),
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
      path: siblingAuthorityPath,
      content: '# Delivery Pipeline Team Gizmo\n',
    }),
  ];
  const findings =
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents);
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.hasFinding(findings, {
      code: CortexStructureFindingCode.InvalidIndexEntry,
      file: managerGraphPath,
      message: `Child knowledge graph may link only its own directory or explicit read-only authorities: ${siblingAuthorityPath}`,
    }),
  ).toBe(false);
});

test('rejects duplicate direct-child document indexing but allows external authorities', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.nestedDistributedDocuments();
  const workflowPath =
    '.cortex/teams/delivery-pipeline/pr-lifecycle/workflows/policy.md';
  const indexedByParent = documents.map((document) =>
    document.relativePath === PIPELINE_GRAPH_PATH
      ? {
          ...document,
          content: `${document.content}- [PR Lifecycle policy](pr-lifecycle/workflows/policy.md)\n`,
        }
      : document,
  );

  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(indexedByParent),
  ).toContainEqual({
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: PIPELINE_GRAPH_PATH,
    line: 1,
    message: `Knowledge graphs must index each non-graph document once: ${workflowPath}`,
  });
});

test('validates direct child graph titles and duplicate entries without root links', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.nestedDistributedDocuments();
  const gizmoGraphPath =
    '.cortex/teams/delivery-pipeline/gizmo/knowledge-graph.md';
  const lifecycleGraphPath =
    '.cortex/teams/delivery-pipeline/pr-lifecycle/knowledge-graph.md';
  const malformed = documents.map((document) => {
    if (document.relativePath === gizmoGraphPath) {
      return {
        ...document,
        content: `Introductory text.\n\n${document.content}`,
      };
    }
    if (document.relativePath === lifecycleGraphPath) {
      return {
        ...document,
        content: `${document.content}- [Duplicate policy](workflows/policy.md)\n`,
      };
    }
    return document;
  });
  const findings =
    CortexDocumentMapCortexDocumentStructureScenario.audit(malformed);
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.hasFinding(findings, {
      code: CortexStructureFindingCode.InvalidTitle,
      file: gizmoGraphPath,
    }),
  ).toBe(true);
  expect(findings).toContainEqual({
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: lifecycleGraphPath,
    line: 1,
    message: `Knowledge graph must index each document once: .cortex/teams/delivery-pipeline/pr-lifecycle/workflows/policy.md`,
  });
});

test('rejects a root link that bypasses Delivery Pipeline child graphs', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.nestedDistributedDocuments();
  const root = documents[0];
  if (!root) throw new Error('Expected nested distributed root document');
  documents[0] = {
    ...root,
    content: `${root.content}- [Nested Gizmo](teams/delivery-pipeline/gizmo/knowledge-graph.md)\n`,
  };
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents),
  ).toContainEqual({
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: '.cortex/knowledge-graph.md',
    line: 1,
    message:
      'Root knowledge graph must route through owner graphs instead of indexing owned documents directly: .cortex/teams/delivery-pipeline/gizmo/knowledge-graph.md',
  });
});

test('requires the root knowledge graph to link the Delivery Pipeline graph', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments({
      rootExtra: '',
      devTarget: 'policy.md',
      gizmoTarget: 'policy.md',
    }).map((document) => ({
      ...document,
      content: document.content.replace(
        '- [Delivery Pipeline](teams/delivery-pipeline/knowledge-graph.md)\n',
        '',
      ),
    }));
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents),
  ).toContainEqual({
    code: CortexStructureFindingCode.MissingFromIndex,
    file: '.cortex/knowledge-graph.md',
    line: 1,
    message:
      'Root knowledge graph must link the owner graph: .cortex/teams/delivery-pipeline/knowledge-graph.md',
  });
});

test('requires the root knowledge graph to link the Gizmo Prime graph', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments({
      rootExtra: '',
      devTarget: 'policy.md',
      gizmoTarget: 'policy.md',
    }).map((document) => ({
      ...document,
      content: document.content.replace(
        '- [Gizmo Prime](gizmo-prime/knowledge-graph.md)\n',
        '',
      ),
    }));
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents),
  ).toContainEqual({
    code: CortexStructureFindingCode.MissingFromIndex,
    file: '.cortex/knowledge-graph.md',
    line: 1,
    message:
      'Root knowledge graph must link the owner graph: .cortex/gizmo-prime/knowledge-graph.md',
  });
});

test('requires the root knowledge graph to link the Gizmo graph', () => {
  const distributedArgs: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: 'policy.md',
    gizmoTarget: 'policy.md',
  };
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments(
      distributedArgs,
    );
  const rootDocument = documents[0];
  if (!rootDocument) throw new Error('Expected distributed root document');
  documents[0] = {
    ...rootDocument,
    content: rootDocument.content.replace(
      '- [Gizmo Prime](gizmo-prime/knowledge-graph.md)\n',
      '',
    ),
  };
  const findings =
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents);
  const expectedFinding = {
    code: CortexStructureFindingCode.MissingFromIndex,
    file: '.cortex/knowledge-graph.md',
    message:
      'Root knowledge graph must link the owner graph: .cortex/gizmo-prime/knowledge-graph.md',
  };
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.hasFinding(
      findings,
      expectedFinding,
    ),
  ).toBe(true);
});

test('maps Gizmo Prime-owned documents to the Gizmo Prime knowledge graph', () => {
  const distributedArgs: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: 'policy.md',
    gizmoTarget: 'missing-policy.md',
  };
  const findings = CortexDocumentMapCortexDocumentStructureScenario.audit(
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments(
      distributedArgs,
    ),
  );
  const expectedFinding = {
    code: CortexStructureFindingCode.MissingFromIndex,
    file: '.cortex/gizmo-prime/knowledge-graph.md',
    message:
      'Document is not indexed in its owning knowledge graph .cortex/gizmo-prime/knowledge-graph.md: .cortex/gizmo-prime/policy.md',
  };
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.hasFinding(
      findings,
      expectedFinding,
    ),
  ).toBe(true);
});

test('rejects section links and duplicate document entries in knowledge graphs', () => {
  const distributedArgs: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: 'policy.md#boundary',
    gizmoTarget: 'policy.md',
  };
  const findings = CortexDocumentMapCortexDocumentStructureScenario.audit(
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments(
      distributedArgs,
    ),
  );
  const expectedFinding = {
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: '.cortex/teams/dev-core/knowledge-graph.md',
  };
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.hasFinding(
      findings,
      expectedFinding,
    ),
  ).toBe(true);
});

test('rejects root navigation that bypasses an owning graph', () => {
  const distributedArgs: DistributedDocumentsArgs = {
    rootExtra: '- [Core policy](teams/dev-core/policy.md)\n',
    devTarget: 'policy.md',
    gizmoTarget: 'policy.md',
  };
  const findings = CortexDocumentMapCortexDocumentStructureScenario.audit(
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments(
      distributedArgs,
    ),
  );
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
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments(
      distributedArgs,
    );
  const srePolicyArgs: MakeDocumentArgs = {
    path: '.cortex/teams/sre/policy.md',
    content: '# SRE Policy\n',
  };
  documents.push(
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument(
      srePolicyArgs,
    ),
  );
  const findings =
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents);
  const expectedFinding = {
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: '.cortex/teams/dev-core/knowledge-graph.md',
  };
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.hasFinding(
      findings,
      expectedFinding,
    ),
  ).toBe(true);
});

test('rejects cross-owner indexing between Gizmo and team graphs', () => {
  const gizmoIndexesTeamArgs: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: 'policy.md',
    gizmoTarget: '../teams/dev-core/policy.md',
  };
  const gizmoFindings = CortexDocumentMapCortexDocumentStructureScenario.audit(
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments(
      gizmoIndexesTeamArgs,
    ),
  );
  const gizmoFinding = {
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: '.cortex/gizmo-prime/knowledge-graph.md',
  };
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.hasFinding(
      gizmoFindings,
      gizmoFinding,
    ),
  ).toBe(true);

  const teamIndexesGizmoArgs: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: '../../gizmo/policy.md',
    gizmoTarget: 'policy.md',
  };
  const teamFindings = CortexDocumentMapCortexDocumentStructureScenario.audit(
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments(
      teamIndexesGizmoArgs,
    ),
  );
  const teamFinding = {
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: '.cortex/teams/dev-core/knowledge-graph.md',
  };
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.hasFinding(
      teamFindings,
      teamFinding,
    ),
  ).toBe(true);
});

test('accepts k-graph.md as an alias for the centralized knowledge graph', () => {
  const kGraphDocArgs: MakeDocumentArgs = {
    path: '.cortex/k-graph.md',
    content: INDEX_DOC_ARGS.content,
  };
  const kGraphDoc =
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument(
      kGraphDocArgs,
    );
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit([
      kGraphDoc,
      DOCUMENT_A,
      DOCUMENT_B,
    ]),
  ).toEqual([]);
});

test('reports missing knowledge-graph.md when centralized index is absent', () => {
  const findings = CortexDocumentMapCortexDocumentStructureScenario.audit([
    DOCUMENT_A,
    DOCUMENT_B,
  ]);
  const codes = findings.map((finding) => finding.code);
  expect(codes).toContain(CortexStructureFindingCode.MissingIndex);
});

test('rejects index links pointing to non-existent documents', () => {
  const badIndexArgs: MakeDocumentArgs = {
    path: '.cortex/knowledge-graph.md',
    content: `# Cortex Knowledge Graph & Navigation Map

- [Missing](missing-file.md)
`,
  };
  const badIndex =
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument(badIndexArgs);
  const codes = CortexDocumentMapCortexDocumentStructureScenario.audit([
    badIndex,
    DOCUMENT_A,
  ]).map((finding) => finding.code);
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
  const badIndex =
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument(badIndexArgs);
  const codes = CortexDocumentMapCortexDocumentStructureScenario.audit([
    badIndex,
    DOCUMENT_A,
    DOCUMENT_B,
  ]).map((finding) => finding.code);
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
  const incompleteIndex =
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument(
      incompleteIndexArgs,
    );
  const codes = CortexDocumentMapCortexDocumentStructureScenario.audit([
    incompleteIndex,
    DOCUMENT_A,
    DOCUMENT_B,
  ]).map((finding) => finding.code);
  expect(codes).toContain(CortexStructureFindingCode.MissingFromIndex);
});
