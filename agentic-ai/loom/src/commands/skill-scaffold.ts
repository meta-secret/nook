import { err, ok, type Result } from 'neverthrow';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import path from 'node:path';

import {
  SkillOwner,
  type SkillScaffoldRequest,
} from '../codec/args/skill-scaffold.ts';

export class SkillScaffoldCommand {
  constructor(
    private readonly input: {
      readonly request: SkillScaffoldRequest;
      readonly repoRoot: string;
    },
  ) {}

  execute(): Result<SkillScaffoldReport, SkillScaffoldFailure> {
    const { request, repoRoot } = this.input;
    const slug = request.skillSlug;

    const cortexRoot = path.join(repoRoot, '.cortex');
    const aiSkillsDir = path.join(cortexRoot, 'teams', 'ai', 'dynamic-skills');
    const directoryArgs: SkillOwnerDynamicSkillsDirectoryArgs = {
      cortexRoot,
      skillOwner: request.skillOwner,
    };
    const skillsDir = new SkillOwnerDirectory(directoryArgs).path();
    const templatePath = path.join(aiSkillsDir, '_template.md');
    const cardPath = path.join(skillsDir, `${slug}.md`);
    const indexPath = path.join(aiSkillsDir, 'index.md');

    if (!existsSync(templatePath)) {
      return err({
        kind: SkillScaffoldFailureKind.Admission,
        message: 'Missing .cortex/teams/ai/dynamic-skills/_template.md',
      });
    }
    const existingSkillCardArgs: FindExistingSkillCardArgs = {
      cortexRoot,
      slug,
    };
    const existingSkillCard = new SkillCardLocation(
      existingSkillCardArgs,
    ).existing();
    if (existingSkillCard !== false) {
      return err({
        kind: SkillScaffoldFailureKind.Admission,
        message: `Skill card already exists: ${path.relative(repoRoot, existingSkillCard)}`,
      });
    }

    const title = slug
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    const templateRead = new SkillScaffoldFile(templatePath).read();
    if (templateRead.isErr()) return err(templateRead.error);
    const template = templateRead.value;
    const renderArgs: RenderSkillCardArgs = { template, title };
    const rendered = new SkillCardTemplate(renderArgs).render();
    if (rendered.isErr()) return err(rendered.error);
    const card = rendered.value;
    const indexRead = new SkillScaffoldFile(indexPath).read();
    if (indexRead.isErr()) return err(indexRead.error);
    const currentIndexContent = indexRead.value;
    const insertArgs: InsertSkillCatalogEntryArgs = {
      cardHref: new SkillMarkdownPath(
        path.relative(aiSkillsDir, cardPath),
      ).value(),
      indexContent: currentIndexContent,
    };
    const inserted = new SkillCatalogEntry(insertArgs).insert();
    if (inserted.isErr()) return err(inserted.error);
    const indexContent = inserted.value;
    const indexUpdated = indexContent !== currentIndexContent;

    const cardWrite = new SkillScaffoldFile(cardPath).write(card);
    if (cardWrite.isErr()) return err(cardWrite.error);
    if (indexUpdated) {
      const indexWrite = new SkillScaffoldFile(indexPath).write(indexContent);
      if (indexWrite.isErr()) return err(indexWrite.error);
    }

    return ok({
      cardPath: path.relative(repoRoot, cardPath),
      indexUpdated,
      created: true,
    });
  }
}

export type SkillScaffoldReport = {
  readonly cardPath: string;
  readonly indexUpdated: boolean;
  readonly created: boolean;
};

type RenderSkillCardArgs = {
  readonly template: string;
  readonly title: string;
};

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

export class SkillCardTemplate {
  constructor(private readonly request: RenderSkillCardArgs) {}
  render(): Result<string, SkillScaffoldFailure> {
    const args = this.request;
    const rendered = args.template.replace(
      /^# Skill name$/m,
      `# ${args.title}`,
    );
    if (rendered === args.template) {
      return err({
        kind: SkillScaffoldFailureKind.Template,
        message: 'Could not find the skill title placeholder in _template.md',
      });
    }
    return ok(rendered);
  }
}

export class SkillMarkdownPath {
  constructor(private readonly request: string) {}
  value(): string {
    const filePath = this.request;
    return filePath.replaceAll('\\', '/');
  }
}

export class SkillOwnerDirectory {
  constructor(private readonly request: SkillOwnerDynamicSkillsDirectoryArgs) {}
  path(): string {
    const args = this.request;
    if (args.skillOwner === SkillOwner.Shared) {
      return path.join(args.cortexRoot, 'shared', 'dynamic-skills');
    }
    if (args.skillOwner === SkillOwner.Gizmo) {
      return path.join(args.cortexRoot, SkillOwner.Gizmo, 'dynamic-skills');
    }
    return path.join(
      args.cortexRoot,
      'teams',
      args.skillOwner,
      'dynamic-skills',
    );
  }
}

export class SkillCardLocation {
  constructor(private readonly request: FindExistingSkillCardArgs) {}
  existing(): string | false {
    const args = this.request;
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
      return new SkillOwnerDirectory(directoryArgs).path();
    });
    const [defaulted1 = false] = [
      ownerRoots
        .flatMap((ownerRoot) => [
          path.join(ownerRoot, `${args.slug}.md`),
          path.join(ownerRoot, args.slug),
        ])
        .find((candidatePath) => existsSync(candidatePath)),
    ];
    return defaulted1;
  }
}

export class SkillCatalogEntry {
  constructor(private readonly request: InsertSkillCatalogEntryArgs) {}
  insert(): Result<string, SkillScaffoldFailure> {
    const args = this.request;
    if (args.indexContent.includes(`(${args.cardHref})`)) {
      return ok(args.indexContent);
    }

    const marker = /\n## How to add one\n/i;
    const markerMatch = marker.exec(args.indexContent);
    if (!markerMatch) {
      return err({
        kind: SkillScaffoldFailureKind.Template,
        message:
          'Could not find the skill-authoring section in dynamic-skills/index.md',
      });
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
    return ok(`${before}\n${entry}\n${after}`);
  }
}

export enum SkillScaffoldFailureKind {
  Admission = 'admission',
  Template = 'template',
  Read = 'read',
  Write = 'write',
}
export type SkillScaffoldFailure = {
  readonly kind: SkillScaffoldFailureKind;
  readonly message: string;
};
class SkillScaffoldFile {
  constructor(private readonly filePath: string) {}
  read(): Result<string, SkillScaffoldFailure> {
    try {
      return ok(readFileSync(this.filePath, 'utf8'));
    } catch {
      return err({
        kind: SkillScaffoldFailureKind.Read,
        message: `Cannot read skill scaffold file: ${this.filePath}`,
      });
    }
  }
  write(content: string): Result<void, SkillScaffoldFailure> {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, content, 'utf8');
      return ok(undefined);
    } catch {
      return err({
        kind: SkillScaffoldFailureKind.Write,
        message: `Cannot write skill scaffold file: ${this.filePath}`,
      });
    }
  }
}
