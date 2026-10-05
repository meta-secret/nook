import { expect, test } from 'bun:test';
import { CortexStructureFindingCode } from '../src/cortex-document-structure.ts';
import { CortexDocumentMapCortexDocumentStructureScenario } from './cortex-document-structure-scenario.ts';
import type {
  DistributedDocumentsArgs,
  MakeDocumentArgs,
} from './cortex-document-structure-scenario.ts';

test('audits local owners, missing destinations, fragments, and ownership boundaries', () => {
  const localIndex =
    'nook-app/nook-platform/nook-core/.cortex/docs/spec/index.md';
  const localDocument =
    'nook-app/nook-platform/nook-core/.cortex/docs/spec/items.md';
  const documents = [
    {
      path: '.cortex/index.md',
      content:
        '# Root\n\n- [Core](../nook-app/nook-platform/nook-core/.cortex/docs/spec/index.md)\n',
    },
    { path: localIndex, content: '# Core\n\n- [Items](items.md)\n' },
    { path: localDocument, content: '# Items\n\n## Rules\n' },
  ].map((request) =>
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument(request),
  );
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents),
  ).toEqual([]);

  const missingDocument = documents.filter(
    (document) => document.relativePath !== localDocument,
  );
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(missingDocument).map(
      (finding) => finding.code,
    ),
  ).toContain(CortexStructureFindingCode.InvalidIndexEntry);

  const brokenFragment = documents.map((document) => ({
    ...document,
    content: document.content.replace('items.md', 'items.md#missing'),
  }));
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(brokenFragment).map(
      (finding) => finding.code,
    ),
  ).toContain(CortexStructureFindingCode.BrokenFragment);

  const unindexed = documents.map((document) => ({
    ...document,
    content: document.content.replace('- [Items](items.md)', ''),
  }));
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(unindexed).map(
      (finding) => finding.code,
    ),
  ).toContain(CortexStructureFindingCode.MissingFromIndex);

  const wrongOwnerRequest: MakeDocumentArgs = {
    path: 'nook-app/.cortex/docs/spec/index.md',
    content:
      '# App\n\n- [Core item](../../../nook-platform/nook-core/.cortex/docs/spec/items.md)\n',
  };
  const wrongOwner = [
    ...documents,
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument(
      wrongOwnerRequest,
    ),
  ];
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(wrongOwner).map(
      (finding) => finding.code,
    ),
  ).toContain(CortexStructureFindingCode.InvalidIndexEntry);
});

test('routes retained global documents through their canonical subject index', () => {
  const distributedRequest: DistributedDocumentsArgs = {
    rootExtra: '',
    devTarget: 'docs/architecture/index.md',
    gizmoTarget: 'policy.md',
  };
  const documents =
    CortexDocumentMapCortexDocumentStructureScenario.distributedDocuments(
      distributedRequest,
    ).map((document) => ({
      ...document,
      relativePath: document.relativePath.replace(
        'dev-core/policy.md',
        'dev-core/docs/architecture/policy.md',
      ),
    }));
  const subjectIndexRequest: MakeDocumentArgs = {
    path: '.cortex/teams/dev-core/docs/architecture/index.md',
    content: '# Development Architecture\n\n- [Policy](policy.md)\n',
  };
  documents.push(
    CortexDocumentMapCortexDocumentStructureScenario.makeDocument(
      subjectIndexRequest,
    ),
  );
  expect(
    CortexDocumentMapCortexDocumentStructureScenario.audit(documents),
  ).toEqual([]);
});
