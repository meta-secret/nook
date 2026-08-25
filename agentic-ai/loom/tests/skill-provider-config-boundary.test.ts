import { join } from 'node:path';
import { expect, test } from 'bun:test';

type TrackedPathsRequest = {
  readonly pathspecs: readonly string[];
};

type SourceScanOptions = {
  readonly cwd: string;
  readonly onlyFiles: true;
};

const REPOSITORY_ROOT = join(import.meta.dir, '../../..');
const PROVIDER_ROOT = '.agents/skills/cortex-article-structure';
const PROVIDER_RUNNER = `${PROVIDER_ROOT}/src/runner.ts`;
const PROVIDER_SOURCE_GLOB = '**/*';
const PROVIDER_SOURCE_PATHS = [
  `${PROVIDER_ROOT}/src/audit.ts`,
  `${PROVIDER_ROOT}/src/codec.ts`,
  `${PROVIDER_ROOT}/src/domain.ts`,
  `${PROVIDER_ROOT}/src/verification.ts`,
] as const;
const RUNNABLE_CONFIG_PATHS = [
  ':(glob)**/package.json',
  ':(glob)**/Taskfile.yml',
  ':(glob)**/Taskfile.yaml',
  ':(glob).task/**/*.yml',
  ':(glob).task/**/*.yaml',
  ':(glob).github/workflows/*.yml',
  ':(glob).github/workflows/*.yaml',
] as const;
const PRODUCTION_LOOM_PATHS = [
  ':(glob)agentic-ai/loom/src/**/*.ts',
  ':(glob)agentic-ai/loom/src/**/*.tsx',
  ':(glob)agentic-ai/loom/src/**/*.mts',
  ':(glob)agentic-ai/loom/src/**/*.cts',
  ':(glob)agentic-ai/loom/src/**/*.js',
  ':(glob)agentic-ai/loom/src/**/*.jsx',
  ':(glob)agentic-ai/loom/src/**/*.mjs',
  ':(glob)agentic-ai/loom/src/**/*.cjs',
] as const;
const PRODUCTION_LOOM_ROOT_PATHS = ['agentic-ai/loom/src'] as const;
const EXECUTABLE_SOURCE_EXTENSION = /\.(?:[cm]?tsx?|[cm]?jsx?)$/u;

function trackedPaths(request: TrackedPathsRequest): readonly string[] {
  const command = ['git', 'ls-files', '--', ...request.pathspecs];
  const spawnOptions = {
    cmd: command,
    cwd: REPOSITORY_ROOT,
    stderr: 'pipe' as const,
    stdout: 'pipe' as const,
  };
  const result = Bun.spawnSync(spawnOptions);
  if (result.exitCode !== 0) {
    throw new Error(`Unable to enumerate tracked paths: ${result.stderr}`);
  }
  return result.stdout
    .toString()
    .split('\n')
    .filter((path) => path.length > 0);
}

async function pathsContainingProviderRoot(
  paths: readonly string[],
): Promise<readonly string[]> {
  const matches: string[] = [];
  for (const path of paths) {
    const source = await Bun.file(join(REPOSITORY_ROOT, path)).text();
    if (source.includes(PROVIDER_ROOT)) matches.push(path);
  }
  return matches;
}

test('dormant provider exposes no runnable adapter or side-effect entrypoint', async () => {
  expect(await Bun.file(join(REPOSITORY_ROOT, PROVIDER_RUNNER)).exists()).toBe(
    false,
  );
  const providerSourceGlob = new Bun.Glob(PROVIDER_SOURCE_GLOB);
  expect(providerSourceGlob.match('runtime/runner.ts')).toBe(true);
  expect(providerSourceGlob.match('runtime/runner.tsx')).toBe(true);
  expect(providerSourceGlob.match('runtime/runner.mjs')).toBe(true);
  expect(providerSourceGlob.match('runtime/runner.sh')).toBe(true);
  expect(providerSourceGlob.match('runtime/runner')).toBe(true);
  const scanOptions: SourceScanOptions = {
    cwd: join(REPOSITORY_ROOT, PROVIDER_ROOT, 'src'),
    onlyFiles: true,
  };
  const providerSources = (
    await Array.fromAsync(providerSourceGlob.scan(scanOptions))
  )
    .map((path) => `${PROVIDER_ROOT}/src/${path}`)
    .sort();
  expect(providerSources).toEqual([...PROVIDER_SOURCE_PATHS].sort());

  for (const path of providerSources) {
    const source = await Bun.file(join(REPOSITORY_ROOT, path)).text();
    expect(source, path).not.toContain('import.meta.main');
    expect(source, path).not.toContain('Bun.stdin');
    expect(source, path).not.toContain('Bun.stdout');
    expect(source, path).not.toContain('process.stdin');
    expect(source, path).not.toContain('process.stdout');
    expect(source, path).not.toMatch(
      /\bexport\s+(?:async\s+)?(?:function|const|let|var)\s+run\b/u,
    );
  }

  const manifest = await Bun.file(
    join(REPOSITORY_ROOT, PROVIDER_ROOT, 'executable-skill.json'),
  ).text();
  expect(manifest).not.toContain('"entrypoint"');
  expect(manifest).not.toContain('"command"');
});

test('production Loom and runnable configuration do not consume the provider', async () => {
  const productionRequest: TrackedPathsRequest = {
    pathspecs: PRODUCTION_LOOM_PATHS,
  };
  const configRequest: TrackedPathsRequest = {
    pathspecs: RUNNABLE_CONFIG_PATHS,
  };
  const productionRootRequest: TrackedPathsRequest = {
    pathspecs: PRODUCTION_LOOM_ROOT_PATHS,
  };
  const productionPaths = [...trackedPaths(productionRequest)].sort();
  const expectedProductionPaths = trackedPaths(productionRootRequest)
    .filter((path) => EXECUTABLE_SOURCE_EXTENSION.test(path))
    .sort();
  expect(productionPaths).toEqual(expectedProductionPaths);
  expect(productionPaths).toContain('agentic-ai/loom/src/cli.ts');
  expect(productionPaths).toContain('agentic-ai/loom/src/cli-invocation.ts');
  expect(productionPaths).toContain('agentic-ai/loom/src/loom-failure.ts');
  const configPaths = trackedPaths(configRequest);
  expect(
    await pathsContainingProviderRoot([...productionPaths, ...configPaths]),
  ).toEqual([]);

  const activeAudit = await Bun.file(
    join(REPOSITORY_ROOT, 'agentic-ai/loom/src/commands/cortex-audit.ts'),
  ).text();
  expect(activeAudit).toContain("'../lib/cortex-article-structure.ts'");
  expect(activeAudit).not.toContain(PROVIDER_ROOT);
});

test('runnable configuration inventory includes every tracked Taskfile', () => {
  const taskfilePattern = /(^|\/)Taskfile\.ya?ml$/u;
  const allPathsRequest: TrackedPathsRequest = { pathspecs: [] };
  const runnableConfigRequest: TrackedPathsRequest = {
    pathspecs: RUNNABLE_CONFIG_PATHS,
  };
  const expected = trackedPaths(allPathsRequest)
    .filter((path) => taskfilePattern.test(path))
    .sort();
  const discovered = trackedPaths(runnableConfigRequest)
    .filter((path) => taskfilePattern.test(path))
    .sort();
  expect(discovered).toEqual(expected);
  expect(discovered.some((path) => path.includes('/'))).toBe(true);
});
