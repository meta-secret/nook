import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  auditCortexIdentifierRegistry,
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
      const invalidRegistry = {
        schemaVersion: 1,
        entries: [
          categoryEntry(),
          {
            id: 'CX-AI-4D7NQ',
            kind: CortexIdentifierKind.Document,
            categoryId: 'CX-AI',
            title: 'Document',
            locator: '.cortex/policy.md',
          },
          {
            id: 'CX-AI-7K3M2',
            kind: CortexIdentifierKind.Item,
            categoryId: 'CX-AI',
            title: 'Missing item',
            locator: '.cortex/policy.md#missing-item',
          },
          {
            id: 'CX-AI-8M4P6',
            kind: CortexIdentifierKind.Document,
            categoryId: 'CX-AI',
            title: 'Duplicate locator',
            locator: '.cortex/policy.md',
          },
          {
            id: 'CX-AI-9N5Q7',
            kind: CortexIdentifierKind.Document,
            categoryId: 'CX-AI',
            title: 'Noncanonical locator',
            locator: '.cortex/nested/../policy.md',
          },
          {
            id: 'CX-AI-2R6T8',
            kind: CortexIdentifierKind.Document,
            categoryId: 'CX-AI',
            title: 'Linked locator',
            locator: '.cortex/linked-policy.md',
          },
        ],
      };
      await writeFile(registryPath, JSON.stringify(invalidRegistry), 'utf8');
      const audit = auditCortexIdentifierRegistry(repoRoot);
      expect(audit.findings.map((finding) => finding.message)).toEqual(
        expect.arrayContaining([
          'Cortex locator .cortex/policy.md#missing-item has no matching heading.',
          'Cortex locator .cortex/policy.md is duplicated.',
          'Cortex locator .cortex/nested/../policy.md is not canonical.',
          'Cortex locator .cortex/linked-policy.md does not name a regular Cortex document.',
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
        categoryId: 'CX-AI',
        title: 'Policy',
        locator: '.cortex/policy.md',
      },
      {
        id: 'CX-AI-7K3M2',
        kind: CortexIdentifierKind.Item,
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
    title: 'AI',
    locator: '.cortex/knowledge-graph.md',
  };
}
