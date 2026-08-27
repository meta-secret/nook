import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
import {
  SkillOwner,
  type SkillScaffoldRequest,
} from '../codec/args/skill-scaffold.ts';
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
  readonly cardHref: string;
  readonly createExecutableWrappers: boolean;
  readonly indexContent: string;
  readonly slug: string;
};

type FindExistingSkillCardArgs = {
  readonly cortexRoot: string;
  readonly slug: string;
};

export type SkillOwnerDynamicSkillsDirectoryArgs = {
  readonly cortexRoot: string;
  readonly skillOwner: SkillOwner;
};

export function markdownPath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

export function skillOwnerDynamicSkillsDirectory(
  args: SkillOwnerDynamicSkillsDirectoryArgs,
): string {
  if (args.skillOwner === SkillOwner.Shared) {
    return path.join(args.cortexRoot, 'shared', 'dynamic-skills');
  }
  if (args.skillOwner === SkillOwner.Gizmo) {
    return path.join(args.cortexRoot, SkillOwner.Gizmo, 'dynamic-skills');
  }
  return path.join(args.cortexRoot, 'teams', args.skillOwner, 'dynamic-skills');
}

export function findExistingSkillCard(
  args: FindExistingSkillCardArgs,
): string | false {
  const owners = [
    SkillOwner.Shared,
    SkillOwner.Gizmo,
    SkillOwner.Ai,
    SkillOwner.DevCore,
    SkillOwner.Security,
    SkillOwner.Sre,
    SkillOwner.WebDev,
  ] as const;
  const ownerRoots = owners.map((skillOwner) => {
    const directoryArgs: SkillOwnerDynamicSkillsDirectoryArgs = {
      cortexRoot: args.cortexRoot,
      skillOwner,
    };
    return skillOwnerDynamicSkillsDirectory(directoryArgs);
  });
  return (
    ownerRoots
      .map((ownerRoot) => path.join(ownerRoot, `${args.slug}.md`))
      .find((candidatePath) => existsSync(candidatePath)) ?? false
  );
}

export function insertSkillCatalogEntry(
  args: InsertSkillCatalogEntryArgs,
): string {
  if (args.indexContent.includes(`(${args.cardHref})`)) {
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
    ? `\n  - Executable skill: [\`.agents/skills/${args.slug}/SKILL.md\`](../../../../.agents/skills/${args.slug}/SKILL.md)`
    : '';
  const entry = `- **[${args.slug}.md](${args.cardHref})**\n  - Purpose: TODO: purpose${executableSkill}`;
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

  const cortexRoot = path.join(repoRoot, '.cortex');
  const aiSkillsDir = path.join(cortexRoot, 'teams', 'ai', 'dynamic-skills');
  const directoryArgs: SkillOwnerDynamicSkillsDirectoryArgs = {
    cortexRoot,
    skillOwner: request.skillOwner,
  };
  const skillsDir = skillOwnerDynamicSkillsDirectory(directoryArgs);
  const templatePath = path.join(aiSkillsDir, '_template.md');
  const cardPath = path.join(skillsDir, `${slug}.md`);
  const indexPath = path.join(aiSkillsDir, 'index.md');

  if (!existsSync(templatePath)) {
    const loomFailureDetailArgs3: LoomFailureDetailArgs = {
      code: LoomFailureCode.SkillScaffoldFailed,
      text: 'Missing .cortex/teams/ai/dynamic-skills/_template.md',
    };
    loomFailureDetail(loomFailureDetailArgs3);
  }
  const existingSkillCardArgs: FindExistingSkillCardArgs = {
    cortexRoot,
    slug,
  };
  const existingSkillCard = findExistingSkillCard(existingSkillCardArgs);
  if (existingSkillCard !== false) {
    const loomFailureDetailArgs2: LoomFailureDetailArgs = {
      code: LoomFailureCode.SkillScaffoldFailed,
      text: `Skill card already exists: ${path.relative(repoRoot, existingSkillCard)}`,
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
    cardHref: markdownPath(path.relative(aiSkillsDir, cardPath)),
    createExecutableWrappers: request.createExecutableWrappers,
    indexContent: currentIndexContent,
    slug,
  };
  const indexContent = insertSkillCatalogEntry(insertArgs);
  const indexUpdated = indexContent !== currentIndexContent;

  const directoryOptions: { readonly recursive: true } = { recursive: true };
  mkdirSync(skillsDir, directoryOptions);
  writeFileSync(cardPath, card, 'utf8');
  if (indexUpdated) writeFileSync(indexPath, indexContent, 'utf8');

  const wrappersCreated: string[] = [];
  if (request.createExecutableWrappers) {
    const agentsDir = path.join(repoRoot, '.agents', 'skills', slug);
    mkdirSync(agentsDir, directoryOptions);
    const skillMd = path.join(agentsDir, 'SKILL.md');
    if (!existsSync(skillMd)) {
      const cortexLink = markdownPath(path.relative(repoRoot, cardPath));
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
