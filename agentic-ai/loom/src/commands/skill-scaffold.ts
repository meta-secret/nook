import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  readonly indexContent: string;
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
      .flatMap((ownerRoot) => [
        path.join(ownerRoot, `${args.slug}.md`),
        path.join(ownerRoot, args.slug),
      ])
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

  const slug = args.cardHref.endsWith('/SKILL.md')
    ? path.basename(path.dirname(args.cardHref))
    : path.basename(args.cardHref, '.md');
  const label = args.cardHref.endsWith('/SKILL.md')
    ? `${slug}/SKILL.md`
    : `${slug}.md`;
  const entry = `- **[${label}](${args.cardHref})**\n  - Purpose: TODO: purpose`;
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
    indexContent: currentIndexContent,
  };
  const indexContent = insertSkillCatalogEntry(insertArgs);
  const indexUpdated = indexContent !== currentIndexContent;

  const directoryOptions: { readonly recursive: true } = { recursive: true };
  mkdirSync(skillsDir, directoryOptions);
  writeFileSync(cardPath, card, 'utf8');
  if (indexUpdated) writeFileSync(indexPath, indexContent, 'utf8');

  return {
    cardPath: path.relative(repoRoot, cardPath),
    indexUpdated,
    created: true,
  };
}
