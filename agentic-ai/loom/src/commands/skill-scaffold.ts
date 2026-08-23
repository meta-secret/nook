import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
import type { SkillScaffoldRequest } from '../codec/args/skill-scaffold.ts';
import { findRepoRoot } from '../lib/repo.ts';
import {
  LoomFailureCode,
  loomFailure,
  loomFailureDetail,
} from '../loom-failure.ts';

import type { LoomFailureDetailArgs } from '../loom-failure.ts';
export type SkillScaffoldReport = {
  readonly cardPath: string;
  readonly indexUpdated: boolean;
  readonly wrappersCreated: string[];
  readonly created: boolean;
};

type RenderSkillCardArgs = {
  readonly template: string;
  readonly title: string;
};

export function renderSkillCard(args: RenderSkillCardArgs): string {
  const rendered = args.template.replace(/^# Skill name$/m, `# ${args.title}`);
  if (rendered === args.template) {
    const failureArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.SkillScaffoldFailed,
      text: 'Could not find the skill title placeholder in _template.md',
    };
    loomFailureDetail(failureArgs);
  }
  return rendered;
}

type InsertSkillCatalogEntryArgs = {
  readonly createExecutableWrappers: boolean;
  readonly indexContent: string;
  readonly slug: string;
};

export function insertSkillCatalogEntry(
  args: InsertSkillCatalogEntryArgs,
): string {
  if (args.indexContent.includes(`(${args.slug}.md)`)) {
    return args.indexContent;
  }

  const marker = /\n## How to add one\n/i;
  const markerMatch = marker.exec(args.indexContent);
  if (!markerMatch) {
    const failureArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.SkillScaffoldFailed,
      text: 'Could not find the skill-authoring section in dynamic-skills/index.md',
    };
    loomFailureDetail(failureArgs);
  }

  const executableSkill = args.createExecutableWrappers
    ? `\n  - Agent skill adapter: [\`.agents/skills/${args.slug}/SKILL.md\`](../../.agents/skills/${args.slug}/SKILL.md)`
    : '';
  const entry = `- **[${args.slug}.md](${args.slug}.md)**\n  - Purpose: TODO: purpose${executableSkill}`;
  const markerIndex = markerMatch.index;
  const before = args.indexContent.slice(0, markerIndex).trimEnd();
  const after = args.indexContent.slice(markerIndex);
  return `${before}\n${entry}\n${after}`;
}

export async function runSkillScaffold(
  request: SkillScaffoldRequest,
): Promise<SkillScaffoldReport> {
  const repoRoot = findRepoRoot();
  const slug = request.skillSlug;

  const skillsDir = path.join(repoRoot, '.cortex', 'dynamic-skills');
  const templatePath = path.join(skillsDir, '_template.md');
  const cardPath = path.join(skillsDir, `${slug}.md`);
  const indexPath = path.join(skillsDir, 'index.md');

  if (!existsSync(templatePath)) {
    const loomFailureDetailArgs3: LoomFailureDetailArgs = {
      code: LoomFailureCode.SkillScaffoldFailed,
      text: 'Missing .cortex/dynamic-skills/_template.md',
    };
    loomFailureDetail(loomFailureDetailArgs3);
  }
  if (existsSync(cardPath)) {
    const loomFailureDetailArgs2: LoomFailureDetailArgs = {
      code: LoomFailureCode.SkillScaffoldFailed,
      text: `Skill card already exists: ${path.relative(repoRoot, cardPath)}`,
    };
    loomFailureDetail(loomFailureDetailArgs2);
  }

  const title = slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const template = readFileSync(templatePath, 'utf8');
  const renderArgs: RenderSkillCardArgs = { template, title };
  const card = renderSkillCard(renderArgs);
  const currentIndexContent = readFileSync(indexPath, 'utf8');
  const insertArgs: InsertSkillCatalogEntryArgs = {
    createExecutableWrappers: request.createExecutableWrappers,
    indexContent: currentIndexContent,
    slug,
  };
  const indexContent = insertSkillCatalogEntry(insertArgs);
  const indexUpdated = indexContent !== currentIndexContent;

  writeFileSync(cardPath, card, 'utf8');
  if (indexUpdated) writeFileSync(indexPath, indexContent, 'utf8');

  const wrappersCreated: string[] = [];
  if (request.createExecutableWrappers) {
    const directoryOptions: { readonly recursive: true } = { recursive: true };
    const agentsDir = path.join(repoRoot, '.agents', 'skills', slug);
    mkdirSync(agentsDir, directoryOptions);
    const skillMd = path.join(agentsDir, 'SKILL.md');
    if (!existsSync(skillMd)) {
      const cortexLink = `.cortex/dynamic-skills/${slug}.md`;
      writeFileSync(
        skillMd,
        [
          '---',
          `name: ${slug}`,
          'description: >-',
          `  Project skill wrapper for ${cortexLink}`,
          '---',
          '',
          `# ${title}`,
          '',
          'Read and follow the canonical project skill at',
          `[${cortexLink}](../../../${cortexLink}).`,
          '',
        ].join('\n'),
        'utf8',
      );
      wrappersCreated.push(path.relative(repoRoot, skillMd));
    }

    for (const host of ['.cursor/skills', '.claude/skills'] as const) {
      const hostDir = path.join(repoRoot, host);
      mkdirSync(hostDir, directoryOptions);
      const linkPath = path.join(hostDir, slug);
      if (!existsSync(linkPath)) {
        symlinkSync(
          path.relative(
            hostDir,
            path.join(repoRoot, '.agents', 'skills', slug),
          ),
          linkPath,
        );
        wrappersCreated.push(path.relative(repoRoot, linkPath));
      }
    }
  }

  return {
    cardPath: path.relative(repoRoot, cardPath),
    indexUpdated,
    wrappersCreated,
    created: true,
  };
}
