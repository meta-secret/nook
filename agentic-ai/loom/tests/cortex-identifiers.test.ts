import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  auditCortexIdentifierRegistry,
  auditCortexIdentifierStability,
  CortexIdentifierKind,
  cortexIdentifierSet,
} from '../src/lib/cortex-identifiers.ts';
import {
  assertCortexReferences,
  CortexReferenceRelation,
} from '../src/agent-workflow/cortex-references.ts';

const REMOVE_OPTIONS: RmOptions = { recursive: true, force: true };

describe('Cortex identifiers', () => {
  test('accepts stable category, document, and item locators', async () => {
    const repoRoot = await fixtureRepository();
    try {
      const audit = auditCortexIdentifierRegistry(repoRoot);
      expect(audit.findings).toEqual([]);
      expect(audit.registry).not.toBe(false);
      if (!audit.registry) throw new Error('Expected a decoded registry.');
      const identifiers = cortexIdentifierSet(audit.registry);
      expect(identifiers).toEqual(
        new Set(['CX-AI', 'CX-AI-4D7NQ', 'CX-AI-7K3M2']),
      );
      const referenceArgs = {
        references: [
          {
            id: 'CX-AI-7K3M2',
            relation: CortexReferenceRelation.Validated,
          },
        ],
        knownIdentifiers: identifiers,
      };
      expect(() => assertCortexReferences(referenceArgs)).not.toThrow();
    } finally {
      await rm(repoRoot, REMOVE_OPTIONS);
    }
  });

  test('rejects duplicate locators, missing fragments, and unknown references', async () => {
    const repoRoot = await fixtureRepository();
    try {
      const registryPath = join(repoRoot, '.cortex', 'identifiers.json');
      await writeFile(join(repoRoot, 'outside.md'), '# Outside\n', 'utf8');
      await symlink(
        '../outside.md',
        join(repoRoot, '.cortex', 'linked-policy.md'),
      );
      await mkdir(join(repoRoot, 'outside'));
      await writeFile(
        join(repoRoot, 'outside', 'policy.md'),
        '# Outside policy\n',
        'utf8',
      );
      await symlink('../outside', join(repoRoot, '.cortex', 'external'));
      await mkdir(join(repoRoot, '.cortex', 'scripts'));
      await writeFile(
        join(repoRoot, '.cortex', 'scripts', 'README.md'),
        '# Script package\n',
        'utf8',
      );
      const invalidRegistry = {
        schemaVersion: 1,
        entries: [
          categoryEntry(),
          {
            id: 'CX-AI-4D7NQ',
            kind: CortexIdentifierKind.Document,
            authority: 'document',
            categoryId: 'CX-AI',
            title: 'Document',
            locator: '.cortex/policy.md',
          },
          {
            id: 'CX-AI-7K3M2',
            kind: CortexIdentifierKind.Item,
            authority: 'missing-item',
            categoryId: 'CX-AI',
            title: 'Missing item',
            locator: '.cortex/policy.md#missing-item',
          },
          {
            id: 'CX-AI-8M4P6',
            kind: CortexIdentifierKind.Document,
            authority: 'document',
            categoryId: 'CX-AI',
            title: 'Duplicate locator',
            locator: '.cortex/policy.md',
          },
          {
            id: 'CX-AI-9N5Q7',
            kind: CortexIdentifierKind.Document,
            authority: 'noncanonical-locator',
            categoryId: 'CX-AI',
            title: 'Noncanonical locator',
            locator: '.cortex/nested/../policy.md',
          },
          {
            id: 'CX-AI-2R6T8',
            kind: CortexIdentifierKind.Document,
            authority: 'linked-locator',
            categoryId: 'CX-AI',
            title: 'Linked locator',
            locator: '.cortex/linked-policy.md',
          },
          {
            id: 'CX-AI-3T7V9',
            kind: CortexIdentifierKind.Document,
            authority: 'linked-directory-locator',
            categoryId: 'CX-AI',
            title: 'Linked directory locator',
            locator: '.cortex/external/policy.md',
          },
          {
            id: 'CX-AI-5V9X2',
            kind: CortexIdentifierKind.Document,
            authority: 'empty-category',
            categoryId: '',
            title: 'Empty category',
            locator: '.cortex/policy.md',
          },
          {
            id: 'CX-AI-6W2Y4',
            kind: CortexIdentifierKind.Document,
            authority: 'script-package',
            categoryId: 'CX-AI',
            title: 'Script package',
            locator: '.cortex/scripts/README.md',
          },
        ],
      };
      await writeFile(registryPath, JSON.stringify(invalidRegistry), 'utf8');
      const audit = auditCortexIdentifierRegistry(repoRoot);
      expect(audit.findings.map((finding) => finding.message)).toEqual(
        expect.arrayContaining([
          'Cortex locator .cortex/policy.md#missing-item has no matching heading.',
          'Cortex locator .cortex/policy.md is duplicated.',
          'Cortex authority document is duplicated.',
          'Cortex locator .cortex/nested/../policy.md is not canonical.',
          'Cortex locator .cortex/linked-policy.md does not name a regular Cortex document.',
          'Cortex locator .cortex/external/policy.md escapes the Cortex root.',
          'Cortex identifier CX-AI-5V9X2 has an invalid category.',
          'Cortex locator .cortex/scripts/README.md is invalid.',
        ]),
      );
      const unknownReferenceArgs = {
        references: [
          {
            id: 'CX-AI-XXXXX',
            relation: CortexReferenceRelation.Loaded,
          },
        ],
        knownIdentifiers: new Set(['CX-AI']),
      };
      expect(() => assertCortexReferences(unknownReferenceArgs)).toThrow(
        'invalid Cortex reference',
      );
      const extraFieldArgs = {
        references: [
          {
            id: 'CX-AI',
            relation: CortexReferenceRelation.Applied,
            prompt: 'must not persist',
          },
        ],
        knownIdentifiers: new Set(['CX-AI']),
      } as never;
      expect(() => assertCortexReferences(extraFieldArgs)).toThrow(
        'invalid Cortex reference',
      );
    } finally {
      await rm(repoRoot, REMOVE_OPTIONS);
    }
  });

  test('derives heading fragments from Markdown syntax', async () => {
    const repoRoot = await fixtureRepository();
    try {
      await writeFile(
        join(repoRoot, '.cortex', 'policy.md'),
        [
          '# Policy',
          '',
          '```markdown',
          '## Event evidence',
          '```',
          '',
          'Event *evidence*',
          '----------------',
          '',
        ].join('\n'),
        'utf8',
      );
      expect(auditCortexIdentifierRegistry(repoRoot).findings).toEqual([]);
    } finally {
      await rm(repoRoot, REMOVE_OPTIONS);
    }
  });

  test('excludes skill frontmatter from registered fragments', async () => {
    const repoRoot = await fixtureRepository();
    try {
      const skillRoot = join(repoRoot, '.cortex', 'skill');
      await mkdir(skillRoot);
      await writeFile(
        join(skillRoot, 'SKILL.md'),
        [
          '---',
          'name: synthetic',
          'description: card',
          '---',
          '',
          '# Skill card',
          '',
          '## Real guidance',
          '',
        ].join('\n'),
        'utf8',
      );
      const registryPath = join(repoRoot, '.cortex', 'identifiers.json');
      const registry = JSON.parse(await readFile(registryPath, 'utf8')) as {
        schemaVersion: 1;
        entries: Record<string, string>[];
      };
      registry.entries.push({
        id: 'CX-AI-8M4P6',
        kind: CortexIdentifierKind.Item,
        authority: 'frontmatter-heading',
        categoryId: 'CX-AI',
        title: 'Frontmatter heading',
        locator: '.cortex/skill/SKILL.md#name-synthetic-description-card',
      });
      await writeFile(registryPath, JSON.stringify(registry), 'utf8');
      expect(
        auditCortexIdentifierRegistry(repoRoot).findings.map(
          (finding) => finding.message,
        ),
      ).toContain(
        'Cortex locator .cortex/skill/SKILL.md#name-synthetic-description-card has no matching heading.',
      );
    } finally {
      await rm(repoRoot, REMOVE_OPTIONS);
    }
  });

  test('rejects removal or reassignment of published identifiers', async () => {
    const repoRoot = await fixtureRepository();
    try {
      const currentAudit = auditCortexIdentifierRegistry(repoRoot);
      expect(currentAudit.registry).not.toBe(false);
      if (!currentAudit.registry) throw new Error('Expected current registry.');
      const published = {
        ...currentAudit.registry,
        entries: [
          ...currentAudit.registry.entries,
          {
            id: 'CX-AI-8M4P6',
            kind: CortexIdentifierKind.Document,
            authority: 'retired-policy',
            categoryId: 'CX-AI',
            title: 'Retired policy',
            locator: '.cortex/retired-policy.md',
          },
        ],
      };
      const reassigned = {
        ...currentAudit.registry,
        entries: currentAudit.registry.entries.map((entry) =>
          entry.id === 'CX-AI-4D7NQ'
            ? { ...entry, authority: 'different-policy' }
            : entry,
        ),
      };
      expect(
        auditCortexIdentifierStability({
          current: reassigned,
          published,
        }).map((finding) => finding.message),
      ).toEqual(
        expect.arrayContaining([
          'Published Cortex identifier CX-AI-4D7NQ was reassigned to a different authority.',
          'Published Cortex identifier CX-AI-8M4P6 was removed; retain its assignment or an explicit tombstone.',
        ]),
      );
    } finally {
      await rm(repoRoot, REMOVE_OPTIONS);
    }
  });
});

async function fixtureRepository(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'cortex-identifiers-'));
  const cortexRoot = join(repoRoot, '.cortex');
  await mkdir(cortexRoot);
  await writeFile(
    join(cortexRoot, 'knowledge-graph.md'),
    '# Knowledge graph\n',
    'utf8',
  );
  await writeFile(
    join(cortexRoot, 'policy.md'),
    '# Policy\n\n## Event evidence\n',
    'utf8',
  );
  const registry = {
    schemaVersion: 1,
    entries: [
      categoryEntry(),
      {
        id: 'CX-AI-4D7NQ',
        kind: CortexIdentifierKind.Document,
        authority: 'policy',
        categoryId: 'CX-AI',
        title: 'Policy',
        locator: '.cortex/policy.md',
      },
      {
        id: 'CX-AI-7K3M2',
        kind: CortexIdentifierKind.Item,
        authority: 'event-evidence',
        categoryId: 'CX-AI',
        title: 'Event evidence',
        locator: '.cortex/policy.md#event-evidence',
      },
    ],
  };
  await writeFile(
    join(cortexRoot, 'identifiers.json'),
    JSON.stringify(registry),
    'utf8',
  );
  return repoRoot;
}

function categoryEntry(): Record<string, string> {
  return {
    id: 'CX-AI',
    kind: CortexIdentifierKind.Category,
    authority: 'ai',
    title: 'AI',
    locator: '.cortex/knowledge-graph.md',
  };
}
