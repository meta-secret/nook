import {
  CortexNavigationExtraction,
  CortexNavigationStripping,
  CORTEX_CONTEXT_ROUTER_MARKDOWN,
} from '../src/cortex-index.ts';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../../../../../..');

class CortexContextRouterScenario {
  static normalizeMarkdown(markdown: string): string {
    return markdown.replace(/\s+/gu, ' ').trim();
  }
}

const FRESH_BASE_AUTHORITIES = [
  '.cortex/AGENTS.md',
  '.cortex/knowledge-graph.md',
  '.cortex/gizmo-prime/AGENTS.md',
  '.cortex/gizmo-prime/knowledge-graph.md',
  '.cortex/gizmo-prime/architecture/dev-delivery.md',
  '.cortex/gizmo-prime/architecture/multiagent-delivery-diagrams.md',
  '.cortex/gizmo-prime/dynamic-skills/branch-naming.md',
  '.cortex/gizmo-prime/workflows/mission-delivery.md',
  '.cortex/gizmo-prime/workflows/module-oriented-development.md',
  '.cortex/gizmo-prime/workflows/pull-requests.md',
  '.cortex/gizmo-prime/workflows/subagent-delegation.md',
  '.cortex/gizmo-prime/workflows/team-oriented-development.md',
  '.cortex/teams/ai/AGENTS.md',
  '.cortex/teams/ai/gizmo/AGENTS.md',
  '.cortex/teams/ai/cortex-specialist/AGENTS.md',
  '.cortex/teams/ai/loom-specialist/AGENTS.md',
  '.cortex/teams/ai/dynamic-skills/cortex-writer.md',
] as const;

const FRESH_BASE_BOOTSTRAP_AUTHORITIES = [
  '.cortex/AGENTS.md',
  '.cortex/knowledge-graph.md',
  '.cortex/gizmo-prime/AGENTS.md',
  '.cortex/gizmo-prime/knowledge-graph.md',
  '.cortex/gizmo-prime/architecture/dev-delivery.md',
  '.cortex/gizmo-prime/architecture/multiagent-delivery-diagrams.md',
  '.cortex/gizmo-prime/workflows/mission-delivery.md',
  '.cortex/gizmo-prime/workflows/module-oriented-development.md',
  '.cortex/gizmo-prime/workflows/subagent-delegation.md',
  '.cortex/gizmo-prime/workflows/team-oriented-development.md',
] as const;

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
  expect(markdown).not.toContain('teams/delivery-pipeline/internal/');
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
  const normalized = CortexContextRouterScenario.normalizeMarkdown(markdown);
  expect(normalized).toContain(
    'Only after both synchronizations, Prime resolves the latest committed `refs/heads/dev^{commit}`.',
  );
  expect(normalized).toContain(
    'Every new feature mission, feature branch, and worktree must use that exact latest committed canonical local `dev` commit as its base.',
  );
  expect(normalized).toContain(
    'A previously pinned or otherwise older local-dev SHA, `origin/dev`, `origin/main`, or another alternate base is invalid.',
  );
  expect(normalized).toContain('The base is preserved after feature creation.');
  expect(normalized).toContain(
    'Prime authorizes the canonical feature branch name, which is the workflow authority.',
  );
  expect(normalized).toContain(
    'Observed base and head SHAs are evidence only, not required packet fields.',
  );
  expect(markdown).not.toContain('rules.md');
  expect(markdown).not.toContain('#overview');
});

test('requires every fresh-base authority to use the post-sync local dev head', () => {
  const required = [
    'feature branch',
    'latest committed',
    'fails closed',
  ] as const;

  for (const relativePath of FRESH_BASE_AUTHORITIES) {
    const markdown = CortexContextRouterScenario.normalizeMarkdown(
      readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8'),
    );
    for (const phrase of required) {
      expect(markdown).toContain(phrase);
    }
    expect(markdown).not.toContain(
      'unless the user explicitly selects another base',
    );
    expect(markdown).not.toContain(
      'creates feature work from `pinnedLocalDevSha`',
    );
  }

  for (const relativePath of FRESH_BASE_BOOTSTRAP_AUTHORITIES) {
    const markdown = CortexContextRouterScenario.normalizeMarkdown(
      readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8'),
    );
    expect(markdown).toContain('git fetch --prune origin');
    expect(markdown).toContain('canonical local `main`');
    expect(markdown).toContain('synchroniz');
    expect(markdown).toContain('canonical local `dev`');
    expect(markdown).toContain('fails closed');
  }
});

test('renders the complete canonical Cortex context router', () => {
  const markdown = CORTEX_CONTEXT_ROUTER_MARKDOWN;
  const canonicalRouter = readFileSync(
    new URL('../../../../../../knowledge-graph.md', import.meta.url),
    'utf8',
  );

  expect(markdown.replace(/\s+/gu, ' ')).toBe(
    canonicalRouter.replace(/\s+/gu, ' '),
  );

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
    'Its owner graph routes delivery architecture and branch naming.',
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
  expect(CortexContextRouterScenario.normalizeMarkdown(markdown)).toContain(
    'Every new feature mission, feature branch, and worktree must use that exact latest committed canonical local `dev` commit as its base.',
  );
  expect(markdown).toContain('Every new feature mission');
  expect(markdown).toContain('foreign-team write requirement to Gizmo Prime');
  expect(markdown).not.toContain('teams/delivery-pipeline/internal/');
});

test('routes AI and Delivery Pipeline authorities through their owner graphs', () => {
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

  expect(aiGraph).not.toContain('../delivery-pipeline/');
  expect(aiSkills).not.toContain('dynamic-skills/dev-publish.md');
  expect(aiSkills).not.toContain('dynamic-skills/dev-promote.md');
  expect(aiSkills).toContain(
    '[Branch naming](../../../gizmo-prime/dynamic-skills/branch-naming.md)',
  );
  expect(aiSkills).toContain(
    '[Pre-push hygiene](../../sre/dynamic-skills/pre-push-hygiene.md)',
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
