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

test('all tracked executable application sources pass the AST capability gate', async () => {
  const options: TrackedSourceOptions = {
    cmd: ['git', 'ls-files', '--', 'agentic-ai/skills'],
    cwd: REPOSITORY_ROOT,
    stderr: 'pipe',
    stdout: 'pipe',
  };
  const result = Bun.spawnSync(options);
  expect(result.exitCode).toBe(0);
  const sources = result.stdout
    .toString()
    .split('\n')
    .filter((path) => /^agentic-ai\/skills\/[^/]+\/src\/.*\.ts$/u.test(path));
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
  const manifest = await Bun.file(
    join(
      REPOSITORY_ROOT,
      'agentic-ai/skills/cortex-article-structure/executable-skill.json',
    ),
  ).text();
  expect(manifest).not.toMatch(/"(?:command|entrypoint)"/u);
});
