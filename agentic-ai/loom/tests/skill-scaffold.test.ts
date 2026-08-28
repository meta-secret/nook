import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findExistingSkillCard,
  insertSkillCatalogEntry,
  markdownPath,
  renderSkillCard,
  skillOwnerDynamicSkillsDirectory,
  type SkillOwnerDynamicSkillsDirectoryArgs,
} from '../src/commands/skill-scaffold.ts';
import {
  decodeSkillScaffoldRequest,
  SkillOwner,
  type SkillScaffoldRequest,
} from '../src/codec/args/skill-scaffold.ts';
import { DecodeStatus, type DecodeOutcome } from '../src/codec/field-error.ts';
import type { UntrustedYamlNode } from '../src/lib/guards.ts';

describe('skill scaffold', () => {
  test('normalizes Markdown links across platforms', () => {
    expect(markdownPath('sre\\recovery.md')).toBe('sre/recovery.md');
  });

  test('renders the current skill-card title placeholder', () => {
    const renderArgs = {
      template: '# Skill name\n\n## Purpose\n\nDescribe the rule.\n',
      title: 'Self Improvement',
    };

    expect(renderSkillCard(renderArgs)).toStartWith('# Self Improvement\n');
  });

  test('inserts the current bullet catalog shape before authoring guidance', () => {
    const insertArgs = {
      cardHref: 'self-improvement.md',
      indexContent:
        '# Project Skill Registry\n\n## Skill catalog\n\n' +
        '- **[existing.md](existing.md)**\n' +
        '  - Purpose: Existing rule\n\n' +
        '## How to add one\n',
    };

    expect(insertSkillCatalogEntry(insertArgs)).toContain(
      '- **[self-improvement.md](self-improvement.md)**\n' +
        '  - Purpose: TODO: purpose\n\n' +
        '## How to add one',
    );
  });

  test('accepts the legacy title casing without duplicating an existing card', () => {
    const insertArgs = {
      cardHref: 'self-improvement.md',
      indexContent:
        '# Registry\n\n## Skill catalog\n\n' +
        '- **[self-improvement.md](self-improvement.md)**\n\n' +
        '## How To Add One\n',
    };

    expect(insertSkillCatalogEntry(insertArgs)).toBe(insertArgs.indexContent);
  });

  test('inserts a team-owned skill by its path from the AI registry', () => {
    const insertArgs = {
      cardHref: '../../sre/dynamic-skills/cluster-recovery.md',
      indexContent: '# Registry\n\n## Skill catalog\n\n## How to add one\n',
    };

    expect(insertSkillCatalogEntry(insertArgs)).toContain(
      '- **[cluster-recovery.md](../../sre/dynamic-skills/cluster-recovery.md)**',
    );
  });

  test('inserts an executable skill by its canonical SKILL path', () => {
    const insertArgs = {
      cardHref: 'article-audit/SKILL.md',
      indexContent: '# Registry\n\n## Skill catalog\n\n## How to add one\n',
    };

    expect(insertSkillCatalogEntry(insertArgs)).toContain(
      '- **[article-audit/SKILL.md](article-audit/SKILL.md)**',
    );
  });

  test('routes Gizmo-owned skills outside the teams directory', () => {
    const directoryArgs: SkillOwnerDynamicSkillsDirectoryArgs = {
      cortexRoot: '/repo/.cortex',
      skillOwner: SkillOwner.Gizmo,
    };
    expect(skillOwnerDynamicSkillsDirectory(directoryArgs)).toBe(
      '/repo/.cortex/gizmo/dynamic-skills',
    );
  });

  test('decodes Gizmo as a supported skill owner', () => {
    const requestNode: UntrustedYamlNode = {
      skillSlug: 'workflow-routing',
      skillOwner: 'gizmo',
    };
    const outcome = decodeSkillScaffoldRequest(requestNode);
    const expectedOutcome: DecodeOutcome<SkillScaffoldRequest> = {
      status: DecodeStatus.Ok,
      value: {
        skillSlug: 'workflow-routing',
        skillOwner: SkillOwner.Gizmo,
      },
    };
    expect(outcome).toEqual(expectedOutcome);
  });

  test('preserves Security skill ownership under the teams directory', () => {
    const directoryArgs: SkillOwnerDynamicSkillsDirectoryArgs = {
      cortexRoot: '/repo/.cortex',
      skillOwner: SkillOwner.Security,
    };
    expect(skillOwnerDynamicSkillsDirectory(directoryArgs)).toBe(
      '/repo/.cortex/teams/security/dynamic-skills',
    );
  });

  test('rejects a duplicate skill slug owned by another team', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-skill-scaffold-'));
    const cortexRoot = join(fixtureRoot, '.cortex');
    const existingCard = join(
      cortexRoot,
      'teams',
      'sre',
      'dynamic-skills',
      'cluster-recovery.md',
    );

    try {
      const directoryOptions = {
        recursive: true,
      } as const;
      await mkdir(
        join(cortexRoot, 'teams', 'sre', 'dynamic-skills'),
        directoryOptions,
      );
      await writeFile(existingCard, '# Cluster Recovery\n', 'utf8');

      const findArgs = { cortexRoot, slug: 'cluster-recovery' };
      expect(findExistingSkillCard(findArgs)).toBe(existingCard);
    } finally {
      const removeOptions = { recursive: true, force: true } as const;
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('finds an existing security-owned skill card', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-security-skill-'));
    const cortexRoot = join(fixtureRoot, '.cortex');
    const securityCard = join(
      cortexRoot,
      'teams',
      'security',
      'dynamic-skills',
      'threat-review.md',
    );

    try {
      const directoryOptions = { recursive: true } as const;
      await mkdir(
        join(cortexRoot, 'teams', 'security', 'dynamic-skills'),
        directoryOptions,
      );
      await writeFile(securityCard, '# Threat Review\n', 'utf8');

      const findArgs = { cortexRoot, slug: 'threat-review' };
      expect(findExistingSkillCard(findArgs)).toBe(securityCard);
    } finally {
      const removeOptions = { recursive: true, force: true } as const;
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('rejects a duplicate executable skill directory', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-executable-skill-'));
    const cortexRoot = join(fixtureRoot, '.cortex');
    const skillRoot = join(
      cortexRoot,
      'teams',
      'ai',
      'dynamic-skills',
      'article-audit',
    );

    try {
      const directoryOptions = { recursive: true } as const;
      await mkdir(skillRoot, directoryOptions);
      const skillPath = join(skillRoot, 'SKILL.md');
      await writeFile(skillPath, '# Article Audit\n', 'utf8');

      const findArgs = { cortexRoot, slug: 'article-audit' };
      expect(findExistingSkillCard(findArgs)).toBe(skillRoot);
    } finally {
      const removeOptions = { recursive: true, force: true } as const;
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('rejects an existing malformed skill directory without SKILL.md', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-malformed-skill-'));
    const cortexRoot = join(fixtureRoot, '.cortex');
    const skillRoot = join(
      cortexRoot,
      'teams',
      'ai',
      'dynamic-skills',
      'article-audit',
    );
    try {
      const directoryOptions = { recursive: true } as const;
      await mkdir(skillRoot, directoryOptions);
      const findArgs = { cortexRoot, slug: 'article-audit' };
      expect(findExistingSkillCard(findArgs)).toBe(skillRoot);
    } finally {
      const removeOptions = { recursive: true, force: true } as const;
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('finds an existing Gizmo-owned skill card', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-gizmo-skill-'));
    const cortexRoot = join(fixtureRoot, '.cortex');
    const gizmoCard = join(
      cortexRoot,
      'gizmo',
      'dynamic-skills',
      'workflow-routing.md',
    );

    try {
      const directoryOptions = { recursive: true } as const;
      await mkdir(
        join(cortexRoot, 'gizmo', 'dynamic-skills'),
        directoryOptions,
      );
      await writeFile(gizmoCard, '# Workflow Routing\n', 'utf8');

      const findArgs = { cortexRoot, slug: 'workflow-routing' };
      expect(findExistingSkillCard(findArgs)).toBe(gizmoCard);
    } finally {
      const removeOptions = { recursive: true, force: true } as const;
      await rm(fixtureRoot, removeOptions);
    }
  });
});
