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

const AI_TYPESCRIPT_POLICY_ROUTES = [
  {
    path: '.cortex/teams/ai/AGENTS.md',
    links: [
      '[Function ownership](../../shared/dynamic-skills/function-ownership.md)',
      '[TypeScript explicit state](../web-dev/dynamic-skills/typescript-explicit-state.md)',
    ],
  },
  {
    path: '.cortex/teams/ai/gizmo/AGENTS.md',
    links: [
      '[AI authored implementation routes](../AGENTS.md#authored-implementation-routing)',
      '[function ownership](../../../shared/dynamic-skills/function-ownership.md)',
      '[TypeScript explicit state](../../web-dev/dynamic-skills/typescript-explicit-state.md)',
    ],
  },
  {
    path: '.cortex/teams/ai/cortex-specialist/AGENTS.md',
    links: [
      '[AI authored implementation routes](../AGENTS.md#authored-implementation-routing)',
      '[function ownership](../../../shared/dynamic-skills/function-ownership.md)',
      '[TypeScript explicit state](../../web-dev/dynamic-skills/typescript-explicit-state.md)',
    ],
  },
  {
    path: '.cortex/teams/ai/loom-specialist/AGENTS.md',
    links: [
      '[AI authored implementation routes](../AGENTS.md#authored-implementation-routing)',
      '[function ownership](../../../shared/dynamic-skills/function-ownership.md)',
      '[TypeScript explicit state](../../web-dev/dynamic-skills/typescript-explicit-state.md)',
    ],
  },
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

test('routes every AI TypeScript leaf through the minimal policy authorities', () => {
  for (const route of AI_TYPESCRIPT_POLICY_ROUTES) {
    const document = CortexContextRouterScenario.normalizeMarkdown(
      readFileSync(path.join(REPOSITORY_ROOT, route.path), 'utf8'),
    );
    for (const link of route.links) {
      expect(document).toContain(link);
    }
  }

  const aiIndex = readFileSync(
    path.join(REPOSITORY_ROOT, '.cortex/teams/ai/dynamic-skills/index.md'),
    'utf8',
  );
  expect(aiIndex).toContain(
    '[AI team contract](../AGENTS.md#authored-implementation-routing)',
  );
  expect(aiIndex).toContain(
    '[typescript-explicit-state.md](../../web-dev/dynamic-skills/typescript-explicit-state.md)',
  );
});

test('keeps root and AI universal policy routes canonical', () => {
  const rootContract = CortexContextRouterScenario.normalizeMarkdown(
    readFileSync(path.join(REPOSITORY_ROOT, '.cortex/AGENTS.md'), 'utf8'),
  );
  for (const required of [
    '[function ownership](shared/dynamic-skills/function-ownership.md)',
    '[TypeScript explicit state](teams/web-dev/dynamic-skills/typescript-explicit-state.md)',
    '[domain API integrity](shared/dynamic-skills/domain-api-integrity.md)',
    '[Source file size](shared/dynamic-skills/source-file-size.md)',
    '[TypeScript and Rust automation only](shared/dynamic-skills/typescript-rust-automation-only.md)',
    '[Testing and regression coverage](shared/dynamic-skills/testing-pyramid-and-regression.md)',
    '[Prefer popular libraries](shared/dynamic-skills/prefer-popular-libraries.md)',
    '[UI design authority](teams/web-dev/dynamic-skills/ui-design-skills.md)',
  ]) {
    expect(rootContract).toContain(required);
  }

  const aiContract = CortexContextRouterScenario.normalizeMarkdown(
    readFileSync(
      path.join(REPOSITORY_ROOT, '.cortex/teams/ai/AGENTS.md'),
      'utf8',
    ),
  );
  for (const required of [
    '[Domain API integrity](../../shared/dynamic-skills/domain-api-integrity.md)',
    '[TypeScript domain structure](../web-dev/dynamic-skills/typescript-domain-structure.md)',
    '[concrete values](../web-dev/dynamic-skills/typescript-no-unknown.md)',
    '[single parameters](../web-dev/dynamic-skills/typescript-single-parameter.md)',
    '[named call arguments](../web-dev/dynamic-skills/typescript-named-args.md)',
    '[Source file size](../../shared/dynamic-skills/source-file-size.md)',
    '[TypeScript and Rust automation only](../../shared/dynamic-skills/typescript-rust-automation-only.md)',
    '[Testing and regression coverage](../../shared/dynamic-skills/testing-pyramid-and-regression.md)',
    '[Prefer popular libraries](../../shared/dynamic-skills/prefer-popular-libraries.md)',
    '[Rust coding](../dev-core/dynamic-skills/rust-coding.md)',
    '[Rust macro minimization](../dev-core/dynamic-skills/rust-macro-minimization.md)',
    '[Rust-TypeScript separation](../dev-core/dynamic-skills/rust-typescript-code-separation.md)',
    '[WASM name coherence](../dev-core/dynamic-skills/rust-wasm-name-coherence.md)',
    '[TypeScript enums over booleans](../web-dev/dynamic-skills/typescript-enums-over-booleans.md)',
    '[Svelte state modeling](../web-dev/dynamic-skills/svelte-state-modeling.md)',
    '[serial operation queues](../web-dev/dynamic-skills/typescript-serial-operation-queues.md)',
  ]) {
    expect(aiContract).toContain(required);
  }
});

test('keeps AI acceptance claims aligned with executable enforcement', () => {
  const aiContract = readFileSync(
    path.join(REPOSITORY_ROOT, '.cortex/teams/ai/AGENTS.md'),
    'utf8',
  );
  for (const required of [
    '`task loom:verify` checks Loom and every executable-skill package.',
    '`task preflight:typescript-state` checks authored `null`, `undefined`,',
    '`task preflight:source-architecture` checks source-language and source-size',
    'The acceptance record must not claim that `task loom:verify` alone proves',
  ]) {
    expect(aiContract).toContain(required);
  }

  const taskfile = readFileSync(
    path.join(REPOSITORY_ROOT, '.task/agentic-ai.yml'),
    'utf8',
  );
  const loomStart = taskfile.indexOf('  loom:verify:\n');
  const loomEnd = taskfile.indexOf('  loom:module-experts:validate:\n');
  expect(loomStart).toBeGreaterThanOrEqual(0);
  expect(loomEnd).toBeGreaterThan(loomStart);
  const loomVerify = taskfile.slice(loomStart, loomEnd);
  for (const required of [
    'task: skills:verify',
    'task: loom:format:check',
    'task: loom:lint',
    'task: loom:check',
    'task: loom:test',
  ]) {
    expect(loomVerify).toContain(required);
  }

  const preflight = readFileSync(
    path.join(REPOSITORY_ROOT, 'preflight/Taskfile.yml'),
    'utf8',
  );
  expect(preflight).toContain('  preflight:typescript-state:\n');
  expect(preflight).toContain('  preflight:source-architecture:\n');
  const dockerfile = readFileSync(
    path.join(REPOSITORY_ROOT, 'preflight/Dockerfile'),
    'utf8',
  );
  expect(dockerfile).toContain('FROM policy-source AS typescript-state');
  expect(dockerfile).toContain(
    'cargo test --locked --manifest-path preflight/Cargo.toml --test core_ownership typescript_',
  );
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
