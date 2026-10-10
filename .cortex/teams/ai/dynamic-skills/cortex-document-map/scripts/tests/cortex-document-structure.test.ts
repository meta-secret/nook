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
  path: '.cortex/index.md',
  content: `# Cortex Index & Navigation Map

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

test('accepts clean documents and valid centralized index.md', () => {
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit([
      INDEX_DOC,
      DOCUMENT_A,
      DOCUMENT_B,
    ]),
  ).toEqual([]);
});

test('treats vendored skills as dependencies rather than Nook graph ownership', () => {
  const request: MakeDocumentArgs = {
    path: '.cortex/index.md',
    content:
      '# Nook graph\n\n- [Programming requirements](../.meta-cortex/teams/dev-team/docs/index.md)\n',
  };
  const document =
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument(request);
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit([document]),
  ).toEqual([]);
});

test('delegates non-Cortex repository links to the repository link audit', () => {
  const graph = CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
    path: '.cortex/index.md',
    content: '# Nook graph\n\n- [Nook app](../nook-app/README.md)\n',
  });
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit([graph]),
  ).toEqual([]);

  const missingArchitecture =
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
      path: '.cortex/index.md',
      content: '# Nook graph\n\n- [Missing readme](../nook-app/missing.md)\n',
    });
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit([
      missingArchitecture,
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

test('discovers specification and architecture owners without agent directories', () => {
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(
      CortexDocumentMapCortexDocumentStructureScenario.nestedDistributedDocuments(),
    ),
  ).toEqual([]);
});

test('keeps project requirements discoverable in their specification owner', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.nestedDistributedDocuments();
  const changed = CortexDocumentMapCortexDocumentStructureScenario.withContent({
    documents,
    path: '.cortex/teams/delivery-pipeline/docs/spec/index.md',
    content: '# Delivery Specifications\n',
  });
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(changed),
  ).toContainEqual({
    code: CortexStructureFindingCode.MissingFromIndex,
    file: '.cortex/teams/delivery-pipeline/docs/spec/index.md',
    line: 1,
    message:
      'Document is not indexed in its owning index .cortex/teams/delivery-pipeline/docs/spec/index.md: .cortex/teams/delivery-pipeline/docs/spec/policy.md',
  });
});

test('rejects a specification catalog that directly owns another scoped document', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.nestedDistributedDocuments();
  const changed = CortexDocumentMapCortexDocumentStructureScenario.withContent({
    documents,
    path: '.cortex/teams/delivery-pipeline/docs/spec/index.md',
    content:
      '# Delivery Specifications\n\n- [Policy](policy.md)\n- [Foreign](../architecture/delivery.md)\n',
  });
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(changed).map(
      (finding) => finding.code,
    ),
  ).toContain(CortexStructureFindingCode.InvalidIndexEntry);
});

test('allows upstream roles and shared circuit breakers as read-only dependencies', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.nestedDistributedDocuments();
  documents.push(
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
      path: '.cortex/CIRCUIT-BREAKER.md',
      content: '# Circuit Breaker\n',
    }),
  );
  const routed = CortexDocumentMapCortexDocumentStructureScenario.withContent({
    documents,
    path: '.cortex/index.md',
    content:
      documents
        .map(
          (document) =>
            document.relativePath === '.cortex/index.md' && document.content,
        )
        .filter(Boolean)
        .join('') + '- [Circuit breaker](CIRCUIT-BREAKER.md)\n',
  });
  const changed = CortexDocumentMapCortexDocumentStructureScenario.withContent({
    documents: routed,
    path: '.cortex/teams/delivery-pipeline/docs/spec/index.md',
    content:
      '# Delivery Specifications\n\n- [Policy](policy.md)\n- [Circuit breaker](../../../../CIRCUIT-BREAKER.md)\n- [Upstream PR agent](../../../../../.meta-cortex/teams/delivery-team/agents/pr-agent/AGENTS.md)\n',
  });
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(changed),
  ).toEqual([]);
});

test('rejects a root link that bypasses a specification owner', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments({
      rootExtra:
        '- [Delivery policy](teams/delivery-pipeline/docs/spec/policy.md)\n',
      devTarget: 'policy.md',
      gizmoTarget: 'policy.md',
    });
  documents.push(
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument({
      path: '.cortex/teams/delivery-pipeline/docs/spec/policy.md',
      content: '# Policy\n',
    }),
  );
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents).map(
      (finding) => finding.code,
    ),
  ).toContain(CortexStructureFindingCode.InvalidIndexEntry);
});

test('rejects duplicated ownership and malformed specification indexes', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.nestedDistributedDocuments();
  const changed = CortexDocumentMapCortexDocumentStructureScenario.withContent({
    documents,
    path: '.cortex/teams/delivery-pipeline/docs/spec/index.md',
    content:
      'Intro\n\n# Delivery Specifications\n\n- [Policy](policy.md)\n- [Duplicate](policy.md)\n',
  });
  const codes = CortexDocumentMapCortexDocumentStructureScenario.audit(
    changed,
  ).map((finding) => finding.code);
  expect(codes).toContain(CortexStructureFindingCode.InvalidTitle);
  expect(codes).toContain(CortexStructureFindingCode.InvalidIndexEntry);
});

test('requires the root index to link the Delivery Pipeline graph', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments({
      rootExtra: '',
      devTarget: 'policy.md',
      gizmoTarget: 'policy.md',
    }).map((document) => ({
      ...document,
      content: document.content.replace(
        '- [Delivery Pipeline](teams/delivery-pipeline/index.md)\n',
        '',
      ),
    }));
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents),
  ).toContainEqual({
    code: CortexStructureFindingCode.MissingFromIndex,
    file: '.cortex/index.md',
    line: 1,
    message:
      'Root index must link the owner graph: .cortex/teams/delivery-pipeline/index.md',
  });
});

test('requires the root index to link the Gizmo Prime graph', () => {
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments({
      rootExtra: '',
      devTarget: 'policy.md',
      gizmoTarget: 'policy.md',
    }).map((document) => ({
      ...document,
      content: document.content.replace(
        '- [Gizmo Prime](docs/spec/index.md)\n',
        '',
      ),
    }));
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents),
  ).toContainEqual({
    code: CortexStructureFindingCode.MissingFromIndex,
    file: '.cortex/index.md',
    line: 1,
    message: 'Root index must link the owner graph: .cortex/docs/spec/index.md',
  });
});

test('requires the root index to link the Gizmo graph', () => {
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
      '- [Gizmo Prime](docs/spec/index.md)\n',
      '',
    ),
  };
  const findings =
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents);
  const expectedFinding = {
    code: CortexStructureFindingCode.MissingFromIndex,
    file: '.cortex/index.md',
    message: 'Root index must link the owner graph: .cortex/docs/spec/index.md',
  };
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.hasFinding(
      findings,
      expectedFinding,
    ),
  ).toBe(true);
});

test('maps Gizmo Prime-owned documents to the Gizmo Prime index', () => {
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
    file: '.cortex/docs/spec/index.md',
    message:
      'Document is not indexed in its owning index .cortex/docs/spec/index.md: .cortex/docs/spec/policy.md',
  };
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.hasFinding(
      findings,
      expectedFinding,
    ),
  ).toBe(true);
});

test('rejects section links and duplicate document entries in indexes', () => {
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
    file: '.cortex/teams/dev-core/index.md',
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
    file: '.cortex/teams/dev-core/index.md',
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
    gizmoTarget: '../../teams/dev-core/policy.md',
  };
  const gizmoFindings = CortexDocumentMapCortexDocumentStructureScenario.audit(
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments(
      gizmoIndexesTeamArgs,
    ),
  );
  const gizmoFinding = {
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: '.cortex/docs/spec/index.md',
  };
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.hasFinding(
      gizmoFindings,
      gizmoFinding,
    ),
  ).toBe(true);

  const teamIndexesGizmoArgs: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: '../../docs/spec/policy.md',
    gizmoTarget: 'policy.md',
  };
  const teamFindings = CortexDocumentMapCortexDocumentStructureScenario.audit(
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments(
      teamIndexesGizmoArgs,
    ),
  );
  const teamFinding = {
    code: CortexStructureFindingCode.InvalidIndexEntry,
    file: '.cortex/teams/dev-core/index.md',
  };
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.hasFinding(
      teamFindings,
      teamFinding,
    ),
  ).toBe(true);
});

test.each(['knowledge-graph.md', 'k-graph.md', 'INDEX.md'])(
  'requires index.md instead of the retired %s navigation filename',
  (filename) => {
    const retiredIndexArgs: MakeDocumentArgs = {
      path: `.cortex/${filename}`,
      content: INDEX_DOC_ARGS.content,
    };
    const retiredIndex =
      CortexDocumentMapCortexDocumentStructureScenario.makeDocument(
        retiredIndexArgs,
      );
    const findings = CortexDocumentMapCortexDocumentStructureScenario.audit([
      retiredIndex,
      DOCUMENT_A,
      DOCUMENT_B,
    ]);
    expect(findings.map((finding) => finding.code)).toContain(
      CortexStructureFindingCode.MissingIndex,
    );
  },
);

test('reports missing index.md when centralized index is absent', () => {
  const findings = CortexDocumentMapCortexDocumentStructureScenario.audit([
    DOCUMENT_A,
    DOCUMENT_B,
  ]);
  const codes = findings.map((finding) => finding.code);
  expect(codes).toContain(CortexStructureFindingCode.MissingIndex);
});

test('rejects index links pointing to non-existent documents', () => {
  const badIndexArgs: MakeDocumentArgs = {
    path: '.cortex/index.md',
    content: `# Cortex Index & Navigation Map

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
    path: '.cortex/index.md',
    content: `# Cortex Index & Navigation Map

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

test('reports unindexed documents missing from index.md', () => {
  const incompleteIndexArgs: MakeDocumentArgs = {
    path: '.cortex/index.md',
    content: `# Cortex Index & Navigation Map

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
