import { join, posix } from 'node:path';
import { expect, test } from 'bun:test';
import { analyzeExecutableSkillSource } from '../src/executable-skills/source-policy.ts';

type TrackedSourceOptions = {
  readonly cmd: string[];
  readonly cwd: string;
  readonly stderr: 'pipe';
  readonly stdout: 'pipe';
};

const REPOSITORY_ROOT = join(import.meta.dir, '../../..');
const ARTICLE_ROOT =
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/';
const EXECUTABLE_SKILL_SOURCE =
  /^\.cortex\/(?:gizmo|shared|teams\/[^/]+)\/dynamic-skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/scripts\/src\/.*\.ts$/u;

test('all tracked executable application sources pass the AST capability gate', async () => {
  const options: TrackedSourceOptions = {
    cmd: ['git', 'ls-files', '--', '.cortex'],
    cwd: REPOSITORY_ROOT,
    stderr: 'pipe',
    stdout: 'pipe',
  };
  const result = Bun.spawnSync(options);
  expect(result.exitCode).toBe(0);
  const sources = result.stdout
    .toString()
    .split('\n')
    .filter((path) => EXECUTABLE_SKILL_SOURCE.test(path));
  expect(sources.length).toBeGreaterThan(0);
  for (const path of sources) {
    const source = await Bun.file(join(REPOSITORY_ROOT, path)).text();
    const analysisRequest = { relativePath: path, source };
    const analysis = analyzeExecutableSkillSource(analysisRequest);
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
  const manifests = result.stdout
    .toString()
    .split('\n')
    .filter((path) => path.endsWith('/scripts/executable-skill.json'));
  expect(manifests).toContain(`${ARTICLE_ROOT}executable-skill.json`);
  for (const path of manifests) {
    const manifest = await Bun.file(join(REPOSITORY_ROOT, path)).text();
    expect(manifest).not.toMatch(/"(?:command|entrypoint)"/u);
  }
});
