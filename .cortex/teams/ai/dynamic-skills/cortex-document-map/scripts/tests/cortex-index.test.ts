import {
  CortexNavigationExtraction,
  CortexNavigationStripping,
  CORTEX_CONTEXT_ROUTER_MARKDOWN,
} from '../src/cortex-index.ts';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('extracts index metadata and renders markdown', () => {
  const documents = [
    {
      absolutePath: '/repo/.cortex/rules.md',
      relativePath: '.cortex/rules.md',
      content: `# Rules

Overview intro.

## Overview

Overview text.

## Golden principles

Golden text.
`,
    },
    {
      absolutePath: '/repo/.cortex/shared/product-specs/spec-a.md',
      relativePath: '.cortex/shared/product-specs/spec-a.md',
      content: `# Spec A

Spec intro.

## Product model

Model text.
`,
    },
  ];

  const extractArgs = { documents, repoRoot: '/repo' };
  const index = new CortexNavigationExtraction(extractArgs).execute();
  expect(index.documents.length).toBe(2);

  const renderArgs = { index };
  const markdown = CORTEX_CONTEXT_ROUTER_MARKDOWN;
  expect(markdown).toContain('# Cortex Context Router');
  expect(markdown).toContain('## Owning contexts');
  expect(markdown).toContain('[Gizmo Prime](gizmo-prime/knowledge-graph.md)');
  expect(markdown).not.toContain(
    '[Gizmo Prime](teams/gizmo/knowledge-graph.md)',
  );
  expect(markdown).toContain(
    '[Delivery Pipeline](teams/delivery-pipeline/knowledge-graph.md)',
  );
  expect(markdown).not.toContain('teams/dev-manager-gizmo/');
  expect(markdown).not.toContain(
    'teams/delivery-pipeline/internal/',
  );
  expect(markdown).toContain('[AI](teams/ai/knowledge-graph.md)');
  expect(markdown).toContain('[Security](teams/security/knowledge-graph.md)');
  expect(markdown).toContain('[Shared knowledge](shared/knowledge-graph.md)');
  expect(markdown).toContain(
    'Every Team Gizmo uses `gpt-5.6-sol` with `low` reasoning.',
  );
  expect(markdown).toContain(
    'Each Team Gizmo requests Fast mode with `service_tier: fast`',
  );
  expect(markdown).toContain(
    'Before planning, delegation, worktree creation, or edits, Gizmo Prime runs',
  );
  expect(markdown).toContain(
    '`git fetch --prune origin`; a fetch failure fails closed.',
  );
  expect(markdown).toContain(
    '`pinnedLocalDevSha` unless the user explicitly selects another base',
  );
  expect(markdown).toContain('`originMainSha`');
  expect(markdown).toContain('`pinnedLocalDevSha`');
  expect(markdown).not.toContain('rules.md');
  expect(markdown).not.toContain('#overview');
});

test('renders the complete canonical Cortex context router', () => {
  const markdown = CORTEX_CONTEXT_ROUTER_MARKDOWN;
  const canonicalRouter = readFileSync(
    new URL('../../../../../../knowledge-graph.md', import.meta.url),
    'utf8',
  );

  expect(markdown).toBe(canonicalRouter);

  const requiredSections = [
    '## Entry contract',
    '## Owning contexts',
    '## Shared dependency route',
  ];
  for (const section of requiredSections) {
    expect(markdown).toContain(section);
  }

  const teamOwnershipContracts = [
    '[Gizmo Prime](gizmo-prime/knowledge-graph.md): planning, delegation, integration,',
    'New feature and child branches follow the [branch naming contract](gizmo-prime/dynamic-skills/branch-naming.md).',
    '[Dev delivery architecture](gizmo-prime/architecture/dev-delivery.md): canonical',
    'feature review, feature acceptance, local landing requests, and Workbench.',
    '[Delivery Pipeline](teams/delivery-pipeline/knowledge-graph.md): operational',
    '[AI](teams/ai/knowledge-graph.md): Cortex, Loom, agent skills, workflows,',
    '[Development core](teams/dev-core/knowledge-graph.md): portable Rust, vault',
    '[Security](teams/security/knowledge-graph.md): security architecture,',
    '[SRE](teams/sre/knowledge-graph.md): CI/CD, clusters, deployments, runners,',
    '[Web development](teams/web-dev/knowledge-graph.md): TypeScript, Svelte,',
  ];
  for (const contract of teamOwnershipContracts) {
    expect(markdown).toContain(contract);
  }

  expect(markdown).toContain('return to the selected owning context');
  expect(markdown).toContain('foreign-team write requirement to Gizmo Prime');
  expect(markdown).not.toContain('teams/delivery-pipeline/internal/');
});

test('keeps AI and Delivery Pipeline authority links on the canonical tree', () => {
  const aiGraph = readFileSync(
    new URL('../../../../../../teams/ai/knowledge-graph.md', import.meta.url),
    'utf8',
  );
  const aiSkills = readFileSync(
    new URL(
      '../../../../../../teams/ai/dynamic-skills/index.md',
      import.meta.url,
    ),
    'utf8',
  );
  const pipelineGizmo = readFileSync(
    new URL(
      '../../../../../../teams/delivery-pipeline/gizmo/AGENTS.md',
      import.meta.url,
    ),
    'utf8',
  );
  const pipelineGraph = readFileSync(
    new URL(
      '../../../../../../teams/delivery-pipeline/gizmo/knowledge-graph.md',
      import.meta.url,
    ),
    'utf8',
  );

  expect(aiGraph).toContain(
    '[Dev manager context](../delivery-pipeline/dev-manager/AGENTS.md)',
  );
  expect(aiSkills).toContain(
    '[Dev publication](../../delivery-pipeline/dev-manager/dynamic-skills/dev-publish.md)',
  );
  expect(aiSkills).toContain(
    '[Dev promotion](../../delivery-pipeline/dev-manager/dynamic-skills/dev-promote.md)',
  );
  expect(pipelineGizmo).toContain(
    '[Delivery Pipeline team contract](../AGENTS.md)',
  );
  expect(pipelineGraph).toContain(
    '[Delivery Pipeline team contract](../AGENTS.md)',
  );
});

test('keeps Delivery Pipeline direct-child ownership in its parent graph', () => {
  const deliveryPipelineGraph = readFileSync(
    new URL(
      '../../../../../../teams/delivery-pipeline/knowledge-graph.md',
      import.meta.url,
    ),
    'utf8',
  );

  expect(deliveryPipelineGraph).toContain(
    '- [Team Gizmo knowledge graph](gizmo/knowledge-graph.md)',
  );
  expect(deliveryPipelineGraph).toContain(
    '- [Dev Manager knowledge graph](dev-manager/knowledge-graph.md)',
  );
  expect(deliveryPipelineGraph).toContain(
    '- [PR Lifecycle Agent knowledge graph](pr-lifecycle/knowledge-graph.md)',
  );
  expect(deliveryPipelineGraph).not.toContain('internal/');
});

test('stripDocumentNavigation strips relationships and document map', () => {
  const content = `# Sample Doc

Intro paragraph.

## Relationships

- [Other](other.md)
  - Other explanation.
  - Read when needed.

## Document map

- [Overview](#overview)
  - Overview explanation.
  - Read first.

## Overview

This is the actual overview text.
`;

  const stripArgs = { content };
  const stripped = new CortexNavigationStripping(stripArgs).execute();
  expect(stripped).toContain('# Sample Doc');
  expect(stripped).toContain('Intro paragraph.');
  expect(stripped).toContain('## Overview');
  expect(stripped).toContain('This is the actual overview text.');
  expect(stripped).not.toContain('## Relationships');
  expect(stripped).not.toContain('## Document map');
  expect(stripped).not.toContain('- [Other](other.md)');
});
