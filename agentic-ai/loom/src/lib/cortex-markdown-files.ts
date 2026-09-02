import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function listPersistentCortexMarkdownFiles(root: string): string[] {
  return listCortexMarkdownFiles(root).filter((filePath) => {
    const relativePath = path.relative(root, filePath);
    return (
      relativePath !== '.session' &&
      !relativePath.startsWith(`.session${path.sep}`)
    );
  });
}

export function listCortexMarkdownFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  const directoryReadOptions: { readonly withFileTypes: true } = {
    withFileTypes: true,
  };
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current !== 'string') break;
    for (const entry of readdirSync(current, directoryReadOptions)) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (full === path.join(root, 'node_modules')) continue;
        const scriptsDirectoryArgs: IsExecutableSkillScriptsDirectoryArgs = {
          cortexRoot: root,
          candidate: full,
        };
        if (isExecutableSkillScriptsDirectory(scriptsDirectoryArgs)) continue;
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
  }
  return out.sort();
}

const EXECUTABLE_SKILL_PROJECT_FILES = [
  '.gitignore',
  '.prettierrc',
  'eslint.config.js',
  'executable-skill.json',
  'package.json',
  'tsconfig.json',
] as const;

function nestedSkillCards(scriptsRoot: string): readonly string[] {
  const skillCards: string[] = [];
  const pending = [scriptsRoot];
  const directoryOptions: { readonly withFileTypes: true } = {
    withFileTypes: true,
  };
  while (pending.length > 0) {
    const directory = pending.pop();
    if (typeof directory !== 'string') break;
    for (const entry of readdirSync(directory, directoryOptions)) {
      if (entry.name === 'node_modules') continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      if (entry.isFile() && entry.name === 'SKILL.md')
        skillCards.push(entryPath);
    }
  }
  return skillCards.sort();
}

type IsExecutableSkillScriptsDirectoryArgs = {
  readonly cortexRoot: string;
  readonly candidate: string;
};

function isExecutableSkillScriptsDirectory(
  args: IsExecutableSkillScriptsDirectoryArgs,
): boolean {
  if (path.basename(args.candidate) !== 'scripts') return false;
  const skillRoot = path.dirname(args.candidate);
  const slug = path.basename(skillRoot);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) return false;
  const skillPath = path.join(skillRoot, 'SKILL.md');
  if (!isRegularFile(skillPath)) return false;
  const ownerRoot = path.dirname(skillRoot);
  if (path.basename(ownerRoot) !== 'dynamic-skills') return false;
  const relativeOwner = path.relative(args.cortexRoot, ownerRoot);
  const canonicalOwner =
    relativeOwner === path.join('gizmo', 'dynamic-skills') ||
    relativeOwner === path.join('shared', 'dynamic-skills') ||
    ['ai', 'dev-core', 'security', 'sre', 'web-dev'].some(
      (team) => relativeOwner === path.join('teams', team, 'dynamic-skills'),
    );
  if (!canonicalOwner) return false;
  return (
    EXECUTABLE_SKILL_PROJECT_FILES.every((name) =>
      isRegularFile(path.join(args.candidate, name)),
    ) &&
    ['src', 'tests'].every((name) =>
      isRegularDirectory(path.join(args.candidate, name)),
    ) &&
    nestedSkillCards(args.candidate).length === 0
  );
}

function isRegularFile(filePath: string): boolean {
  try {
    const metadata = lstatSync(filePath);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function isRegularDirectory(directoryPath: string): boolean {
  try {
    const metadata = lstatSync(directoryPath);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}
