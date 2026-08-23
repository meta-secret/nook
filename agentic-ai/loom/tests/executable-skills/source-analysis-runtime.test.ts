import { expect, setDefaultTimeout, test } from 'bun:test';
import { runExecutableSkillSourceAnalysis } from '../../src/executable-skills/source-analysis-runtime.ts';
import type { RunExecutableSkillSourceAnalysisRequest } from '../../src/executable-skills/source-analysis-runtime.ts';
import type { ExecutableSkillSourceAnalysis } from '../../src/executable-skills/source-policy.ts';

setDefaultTimeout(60_000);

const SOURCE_PATH = '.agents/skills/fixture/src/runner.ts';

test('analyzes source only through the bounded worker protocol', async () => {
  const request: RunExecutableSkillSourceAnalysisRequest = {
    deadlineExpiresAt: Date.now() + 30_000,
    relativePath: SOURCE_PATH,
    signal: false,
    source: "import { value } from './support.ts';\nexport { value };\n",
  };
  const expected: ExecutableSkillSourceAnalysis = {
    moduleSpecifiers: ['./support.ts'],
  };
  await expect(runExecutableSkillSourceAnalysis(request)).resolves.toEqual(
    expected,
  );
});

test('abort interrupts source analysis only after the worker is reaped', async () => {
  const controller = new AbortController();
  const source = new Array<string>(120_000)
    .fill('export const value = 1;')
    .join('\n');
  const request: RunExecutableSkillSourceAnalysisRequest = {
    deadlineExpiresAt: Date.now() + 30_000,
    relativePath: SOURCE_PATH,
    signal: controller.signal,
    source,
  };
  const analysis = runExecutableSkillSourceAnalysis(request);
  setTimeout(() => controller.abort(), 5);
  await expect(analysis).rejects.toThrow('cancelled');
});

test('deadline kills and awaits a running source analysis worker', async () => {
  const source = new Array<string>(120_000)
    .fill('export const value = 1;')
    .join('\n');
  const request: RunExecutableSkillSourceAnalysisRequest = {
    deadlineExpiresAt: Date.now() + 5,
    relativePath: SOURCE_PATH,
    signal: false,
    source,
  };
  await expect(runExecutableSkillSourceAnalysis(request)).rejects.toThrow(
    'deadline',
  );
});
