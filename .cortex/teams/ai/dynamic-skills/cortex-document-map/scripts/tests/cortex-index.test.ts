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

const TRUSTED_HANDOFF_DUPLICATION_SURFACES = [
  '.cortex/AGENTS.md',
  '.cortex/teams/ai/docs/spec/functional-ownership.md',
  '.cortex/teams/ai/docs/architecture/refactoring-experts.md',
  '.cortex/teams/ai/workflows/structural-refactoring.md',
  'agentic-ai/loom/.cortex/docs/spec/loom-tools.md',
  '.cortex/teams/ai/dynamic-skills/code-refactoring-expert.md',
  '.cortex/teams/ai/dynamic-skills/cortex-refactoring-expert.md',
  '.cortex/teams/ai/dynamic-skills/module-expert.md',
  '.cortex/teams/ai/dynamic-skills/system-coherence-synthesizer.md',
  'agentic-ai/loom/README.md',
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
      absolutePath: '/repo/.cortex/shared/docs/spec/spec-a.md',
      relativePath: '.cortex/shared/docs/spec/spec-a.md',
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
  expect(markdown).toContain('# Nook Cortex Index');
  expect(markdown).toContain('## Product and operational contexts');
  expect(markdown).toContain(
    '[Prime, single Team Gizmo, and delivery](docs/spec/index.md)',
  );
  expect(markdown).not.toContain('[Gizmo Prime](teams/gizmo/index.md)');
  expect(markdown).toContain(
    '[Delivery Pipeline](teams/delivery-pipeline/index.md)',
  );
  expect(markdown).not.toContain('teams/pr-lifecycle-gizmo/');
  expect(markdown).not.toContain('teams/delivery-pipeline/internal/');
  expect(markdown).toContain('[AI](teams/ai/index.md)');
  expect(markdown).toContain('[Security](teams/security/index.md)');
  expect(markdown).toContain('[Shared knowledge](shared/index.md)');
  expect(markdown).toContain('meta-cortex-integration.md');
  expect(markdown).toContain(
    '../.meta-cortex/teams/gizmo-team/agents/gizmo/AGENTS.md',
  );
  expect(markdown).not.toContain('rules.md');
  expect(markdown).not.toContain('#overview');
});

test('renders the complete canonical Cortex context router', () => {
  const markdown = CORTEX_CONTEXT_ROUTER_MARKDOWN;
  const canonicalRouter = readFileSync(
    new URL('../../../../../../index.md', import.meta.url),
    'utf8',
  );

  expect(markdown.replace(/\s+/gu, ' ')).toBe(
    canonicalRouter.replace(/\s+/gu, ' '),
  );

  const requiredSections = [
    '## Required entry',
    '## Project-local context',
    '## Product and operational contexts',
  ];
  for (const section of requiredSections) {
    expect(markdown).toContain(section);
  }

  const teamOwnershipContracts = [
    '[Prime, single Team Gizmo, and delivery](docs/spec/index.md)',
    '[Delivery Pipeline](teams/delivery-pipeline/index.md)',
    '[AI](teams/ai/index.md)',
    '[Development Core](teams/dev-core/index.md)',
    '[Security](teams/security/index.md)',
    '[SRE](teams/sre/index.md)',
    '[Web Development](teams/web-dev/index.md)',
  ];
  for (const contract of teamOwnershipContracts) {
    expect(markdown).toContain(contract);
  }

  expect(markdown).toContain('meta-cortex-integration.md');
  expect(markdown).not.toContain('canonical local `dev`');
});

test('keeps trusted-agent prohibitions single-sourced in the circuit breaker', () => {
  const prohibitedDuplicates = [
    'anti-forgery checks, key registries, or authority registries',
    'one-use capability issuance or consumption theatrics',
    'No signature, anti-forgery check, replay gate, digest',
    'signatures, encrypted receipts, capability registries, replay ledgers',
  ] as const;

  for (const relativePath of TRUSTED_HANDOFF_DUPLICATION_SURFACES) {
    const document = readFileSync(
      path.join(REPOSITORY_ROOT, relativePath),
      'utf8',
    );
    for (const duplicate of prohibitedDuplicates) {
      expect(document).not.toContain(duplicate);
    }
  }
});

test('keeps direct remote Task and BuildKit execution authoritative', () => {
  const circuitBreaker = CortexContextRouterScenario.normalizeMarkdown(
    readFileSync(
      path.join(REPOSITORY_ROOT, '.cortex/CIRCUIT-BREAKER.md'),
      'utf8',
    ),
  );
  expect(circuitBreaker).toContain(
    'Forward the user-requested remote Task selector without checking whether it exists in a local catalog.',
  );
  expect(circuitBreaker).toContain(
    'An unknown or missing selector is valid dispatch input and fails naturally on the GitHub Actions runner.',
  );
  expect(circuitBreaker).toContain(
    'Do not add selector discovery, existence validation, aliases, fallback resolution, or pre-dispatch build machinery.',
  );
  expect(circuitBreaker).toContain(
    'Forward and execute the remote Task directly.',
  );
  expect(circuitBreaker).toContain(
    'The actual terminal outcome from GitHub Actions is the execution evidence.',
  );
  expect(circuitBreaker).toContain(
    'Do not create or maintain preflight mocks, simulations, or contract tests for remote Task dispatch.',
  );
  expect(circuitBreaker).toContain(
    'This prohibition includes shell invocation arguments, environment wiring, task existence, shell behavior, retry or failure paths, and expected dispatch results.',
  );
  expect(circuitBreaker).toContain(
    'Treat agent-authored reproductions of Docker or BuildKit cache functionality as P1 violations.',
  );
  expect(circuitBreaker).toContain(
    'Dockerfiles, Bake HCL, and Docker or BuildKit-backed simulations and proofs are required and allowed.',
  );
  expect(circuitBreaker).toContain(
    'Run actual cold, warm, cache-import, and cache-export builds.',
  );
  expect(circuitBreaker).toContain(
    'Inspect the resulting cache and build artifacts.',
  );
  expect(circuitBreaker).toContain(
    'This prohibition applies only to Rust, application, or other custom code that computes cache keys, invalidates dependencies, selects caches, or decides layer reuse without invoking Docker or BuildKit.',
  );
  expect(circuitBreaker).toContain(
    'Docker and BuildKit are the sole authority for Docker layer-cache validity.',
  );
  expect(circuitBreaker).toContain(
    'Import available BuildKit cache, run the actual Docker build to validate and reuse layers, then export the updated cache.',
  );
  expect(circuitBreaker).toContain(
    'Preserve real build contexts, build arguments, actual build results, and structured statistics artifacts.',
  );
  expect(circuitBreaker).toContain(
    'Preserve the complete sccache health policy, including its zero-hit gate.',
  );
});

test('keeps AI acceptance claims aligned with executable enforcement', () => {
  const aiContract = readFileSync(
    path.join(
      REPOSITORY_ROOT,
      '.cortex/teams/ai/docs/spec/functional-ownership.md',
    ),
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

test('routes project requirements through specification owners', () => {
  const ai = readFileSync(
    path.join(REPOSITORY_ROOT, '.cortex/teams/ai/index.md'),
    'utf8',
  );
  const delivery = readFileSync(
    path.join(REPOSITORY_ROOT, '.cortex/teams/delivery-pipeline/index.md'),
    'utf8',
  );
  expect(ai).toContain('docs/spec/index.md');
  expect(delivery).toContain('docs/spec/index.md');
  expect(delivery).not.toContain('gizmo/index.md');
  expect(delivery).not.toContain('pr-lifecycle/index.md');
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

test('uses upstream roles directly with Nook project requirements', () => {
  const root = readFileSync(
    path.join(REPOSITORY_ROOT, '.cortex/AGENTS.md'),
    'utf8',
  );
  const routing = readFileSync(
    path.join(REPOSITORY_ROOT, '.cortex/docs/spec/upstream-role-routing.md'),
    'utf8',
  );
  const delivery = readFileSync(
    path.join(REPOSITORY_ROOT, '.cortex/docs/architecture/dev-delivery.md'),
    'utf8',
  );
  expect(root.indexOf('CIRCUIT-BREAKER.md')).toBeLessThan(
    root.indexOf('../.meta-cortex/AGENTS.md'),
  );
  expect(root).toContain(
    '../.meta-cortex/teams/gizmo-team/agents/gizmo-prime/AGENTS.md',
  );
  expect(root).toContain(
    '../.meta-cortex/teams/gizmo-team/agents/gizmo/AGENTS.md',
  );
  expect(root).toContain(
    'Nook project root and shared Meta-Cortex library root',
  );
  expect(root).toContain('each worker branch and worktree in dependency order');
  expect(routing).toContain('same upstream role');
  expect(routing).toContain('functional team keys only');
  expect(delivery).toContain('git fetch --prune origin');
  expect(delivery).toContain(
    'freshly fetched ' +
      String.fromCharCode(96) +
      'origin/main' +
      String.fromCharCode(96) +
      ' base branch',
  );
});
