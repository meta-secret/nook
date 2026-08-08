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

export type SkillScaffoldReport = {
  readonly cardPath: string;
  readonly indexUpdated: boolean;
  readonly wrappersCreated: string[];
  readonly created: boolean;
};

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
    loomFailureDetail({
      code: LoomFailureCode.SkillScaffoldFailed,
      text: 'Missing .cortex/dynamic-skills/_template.md',
    });
  }
  if (existsSync(cardPath)) {
    loomFailureDetail({
      code: LoomFailureCode.SkillScaffoldFailed,
      text: `Skill card already exists: ${path.relative(repoRoot, cardPath)}`,
    });
  }

  const title = slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const template = readFileSync(templatePath, 'utf8');
  const card = template.replace('<Skill Name>', title);
  writeFileSync(cardPath, card, 'utf8');

  let indexUpdated = false;
  let indexContent = readFileSync(indexPath, 'utf8');
  const row = `| [${slug}.md](${slug}.md) | TODO: purpose | |`;
  if (!indexContent.includes(`(${slug}.md)`)) {
    const marker = '\n## How To Add One\n';
    const markerIndex = indexContent.indexOf(marker);
    if (markerIndex < 0) {
      loomFailureDetail({
        code: LoomFailureCode.SkillScaffoldFailed,
        text: 'Could not find "## How To Add One" in dynamic-skills/index.md',
      });
    }
    const before = indexContent.slice(0, markerIndex).trimEnd();
    const after = indexContent.slice(markerIndex);
    indexContent = `${before}\n${row}\n${after}`;
    writeFileSync(indexPath, indexContent, 'utf8');
    indexUpdated = true;
  }

  const wrappersCreated: string[] = [];
  if (request.createExecutableWrappers) {
    const agentsDir = path.join(repoRoot, '.agents', 'skills', slug);
    mkdirSync(agentsDir, { recursive: true });
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
      mkdirSync(hostDir, { recursive: true });
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
