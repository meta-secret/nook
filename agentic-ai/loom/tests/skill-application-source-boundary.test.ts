import { lstatSync } from 'node:fs';
import { join, posix } from 'node:path';
import { expect, test } from 'bun:test';
import {
  analyzeExecutableSkillSource,
  isExecutableSkillApplicationSourcePath,
} from '../src/executable-skills/source-policy.ts';

type TrackedSourceOptions = {
  readonly cmd: string[];
  readonly cwd: string;
  readonly stderr: 'pipe';
  readonly stdout: 'pipe';
};

const REPOSITORY_ROOT = join(import.meta.dir, '../../..');
const ARTICLE_ROOT =
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/';
type ExecutableSkillSourceProfile = typeof analyzeExecutableSkillSource;
const SOURCE_PROFILES: ReadonlyMap<string, ExecutableSkillSourceProfile> =
  new Map([[ARTICLE_ROOT.slice(0, -1), analyzeExecutableSkillSource]]);

function executableSkillRootFromTrackedPath(path: string): string | false {
  const marker = '/scripts/';
  const index = path.lastIndexOf(marker);
  const root = index < 0 ? '' : path.slice(0, index + marker.length - 1);
  return isExecutableSkillApplicationSourcePath(`${root}/src/index.ts`)
    ? root
    : false;
}

test('all tracked executable application sources pass the AST capability gate', async () => {
  const options: TrackedSourceOptions = {
    cmd: ['git', 'ls-files', '--', '.cortex'],
    cwd: REPOSITORY_ROOT,
    stderr: 'pipe',
    stdout: 'pipe',
  };
  const result = Bun.spawnSync(options);
  expect(result.exitCode).toBe(0);
  const tracked = result.stdout.toString().split('\n').filter(Boolean);
  const packageRoots = tracked
    .filter((path) => path.endsWith('/scripts/package.json'))
    .map((path) => posix.dirname(path))
    .filter((root) =>
      isExecutableSkillApplicationSourcePath(`${root}/src/index.ts`),
    )
    .sort();
  const implementationRoots = [
    ...new Set(
      tracked.flatMap((path) => {
        const root = executableSkillRootFromTrackedPath(path);
        return root === false ? [] : [root];
      }),
    ),
  ].sort();
  expect(implementationRoots).toEqual(packageRoots);
  expect([...SOURCE_PROFILES.keys()].sort()).toEqual(packageRoots);
  for (const root of packageRoots) {
    const skillRoot = posix.dirname(root);
    const slug = posix.basename(skillRoot);
    expect(tracked).not.toContain(`${skillRoot}.md`);
    for (const required of [
      `${skillRoot}/SKILL.md`,
      `${root}/bun.lock`,
      `${root}/executable-skill.json`,
    ]) {
      expect(tracked, required).toContain(required);
    }
    for (const requiredDirectory of [`${root}/src/`, `${root}/tests/`]) {
      expect(
        tracked.some((path) => path.startsWith(requiredDirectory)),
        requiredDirectory,
      ).toBe(true);
    }
    for (const path of tracked.filter(
      (path) => path === `${skillRoot}/SKILL.md` || path.startsWith(`${root}/`),
    )) {
      expect(
        lstatSync(join(REPOSITORY_ROOT, path)).isSymbolicLink(),
        path,
      ).toBe(false);
    }
    const skill = await Bun.file(
      join(REPOSITORY_ROOT, skillRoot, 'SKILL.md'),
    ).text();
    const packageDocument = await Bun.file(
      join(REPOSITORY_ROOT, root, 'package.json'),
    ).text();
    const lockfile = await Bun.file(
      join(REPOSITORY_ROOT, root, 'bun.lock'),
    ).text();
    expect(skill.startsWith(`---\nname: ${slug}\ndescription:`)).toBe(true);
    expect(packageDocument).toContain(`"name": "@nook/${slug}-skill"`);
    expect(lockfile).toContain(`"name": "@nook/${slug}-skill"`);
  }
  const sources = tracked.filter(isExecutableSkillApplicationSourcePath);
  expect(sources.length).toBeGreaterThan(0);
  for (const path of sources) {
    const packageRoot = packageRoots.find((root) =>
      path.startsWith(`${root}/src/`),
    );
    const profile = packageRoot
      ? (SOURCE_PROFILES.get(packageRoot) ?? false)
      : false;
    expect(profile, path).not.toBe(false);
    if (profile === false) throw new Error(`Missing source profile: ${path}`);
    const source = await Bun.file(join(REPOSITORY_ROOT, path)).text();
    const analysisRequest = { relativePath: path, source };
    const analysis = profile(analysisRequest);
    for (const specifier of analysis.moduleSpecifiers) {
      const dependency = posix.normalize(
        posix.join(posix.dirname(path), specifier),
      );
      expect(sources, `${path} -> ${specifier}`).toContain(dependency);
    }
    expect(source, path).not.toContain('import.meta.main');
    expect(source, path).not.toMatch(
      /\bexport\s+(?:async\s+)?(?:function|const|let|var)\s+run\b/u,
    );
  }
  const manifests = tracked.filter((path) =>
    path.endsWith('/scripts/executable-skill.json'),
  );
  expect(manifests).toContain(`${ARTICLE_ROOT}executable-skill.json`);
  for (const path of manifests) {
    const manifest = await Bun.file(join(REPOSITORY_ROOT, path)).text();
    expect(manifest).not.toMatch(/"(?:command|entrypoint)"/u);
  }
});

test('does not exempt misspelled team owners from repository source policy', () => {
  const typoPath = ARTICLE_ROOT.replace('/ai/', '/a1/').concat('src/audit.ts');
  expect(isExecutableSkillApplicationSourcePath(typoPath)).toBe(false);
  expect(
    isExecutableSkillApplicationSourcePath(`${ARTICLE_ROOT}src/audit.ts`),
  ).toBe(true);
});

test('derives package roots from the final scripts delimiter', () => {
  const source =
    '.cortex/teams/ai/dynamic-skills/scripts/scripts/src/application.ts';
  expect(executableSkillRootFromTrackedPath(source)).toBe(
    '.cortex/teams/ai/dynamic-skills/scripts/scripts',
  );
});
