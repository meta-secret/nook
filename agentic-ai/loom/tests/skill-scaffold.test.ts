import { describe, expect, test } from 'bun:test';
import {
  insertSkillCatalogEntry,
  renderSkillCard,
} from '../src/commands/skill-scaffold.ts';

describe('skill scaffold', () => {
  test('renders the current skill-card title placeholder', () => {
    const renderArgs = {
      template: '# Skill name\n\n## Purpose\n\nDescribe the rule.\n',
      title: 'Self Improvement',
    };

    expect(renderSkillCard(renderArgs)).toStartWith('# Self Improvement\n');
  });

  test('inserts the current bullet catalog shape before authoring guidance', () => {
    const insertArgs = {
      createExecutableWrappers: true,
      indexContent:
        '# Project Skill Registry\n\n## Skill catalog\n\n' +
        '- **[existing.md](existing.md)**\n' +
        '  - Purpose: Existing rule\n\n' +
        '## How to add one\n',
      slug: 'self-improvement',
    };

    expect(insertSkillCatalogEntry(insertArgs)).toContain(
      '- **[self-improvement.md](self-improvement.md)**\n' +
        '  - Purpose: TODO: purpose\n' +
        '  - Executable skill: [`.agents/skills/self-improvement/SKILL.md`](../../.agents/skills/self-improvement/SKILL.md)\n\n' +
        '## How to add one',
    );
  });

  test('accepts the legacy title casing without duplicating an existing card', () => {
    const insertArgs = {
      createExecutableWrappers: false,
      indexContent:
        '# Registry\n\n## Skill catalog\n\n' +
        '- **[self-improvement.md](self-improvement.md)**\n\n' +
        '## How To Add One\n',
      slug: 'self-improvement',
    };

    expect(insertSkillCatalogEntry(insertArgs)).toBe(insertArgs.indexContent);
  });
});
