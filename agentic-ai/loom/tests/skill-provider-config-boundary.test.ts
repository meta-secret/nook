import { join, posix } from 'node:path';
import { expect, test } from 'bun:test';

type TrackedPathsRequest = {
  readonly pathspecs: readonly string[];
};

type SourceScanOptions = {
  readonly cwd: string;
  readonly onlyFiles: true;
};

type ActionRuntimeGraph = {
  readonly roots: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
};

type GitHubActionStep = {
  readonly uses?: string;
};

type GitHubActionRuns = {
  readonly main?: string;
  readonly post?: string;
  readonly pre?: string;
  readonly steps?: readonly GitHubActionStep[];
  readonly using?: string;
};

type GitHubActionDocument = {
  readonly runs?: GitHubActionRuns;
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
  ':(glob).github/actions/**/action.yml',
  ':(glob).github/actions/**/action.yaml',
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
    if (path.includes(PROVIDER_ROOT) || source.includes(PROVIDER_ROOT)) {
      matches.push(path);
    }
  }
  return matches;
}

function isActionManifest(path: string): boolean {
  return /(^|\/)action\.ya?ml$/u.test(path);
}

function actionRuntimePaths(graph: ActionRuntimeGraph): readonly string[] {
  const pending = [...graph.roots];
  const visited = new Set<string>();
  const runtimePaths = new Set<string>();
  while (pending.length > 0) {
    const manifestPath = pending.pop();
    if (!manifestPath || visited.has(manifestPath)) continue;
    visited.add(manifestPath);
    runtimePaths.add(manifestPath);
    const source = graph.sources.get(manifestPath);
    if (typeof source !== 'string') {
      throw new Error(`Tracked action manifest is unreadable: ${manifestPath}`);
    }
    const document = Bun.YAML.parse(source) as GitHubActionDocument;
    const runs = document?.runs;
    if (!runs || typeof runs.using !== 'string') {
      throw new Error(`Tracked action has no runs.using: ${manifestPath}`);
    }
    if (runs.using === 'composite') {
      if (!Array.isArray(runs.steps)) {
        throw new Error(`Composite action has no steps: ${manifestPath}`);
      }
      for (const step of runs.steps) {
        if (typeof step.uses !== 'string' || !step.uses.startsWith('./')) {
          continue;
        }
        const localRoot = posix.normalize(step.uses.slice(2));
        if (localRoot.startsWith('../') || posix.isAbsolute(localRoot)) {
          throw new Error(`Local action escapes the repository: ${step.uses}`);
        }
        const candidates = [
          posix.join(localRoot, 'action.yml'),
          posix.join(localRoot, 'action.yaml'),
        ].filter((path) => graph.sources.has(path));
        if (candidates.length !== 1) {
          throw new Error(`Local action manifest is unresolved: ${step.uses}`);
        }
        const nestedManifest = candidates[0];
        if (nestedManifest) pending.push(nestedManifest);
      }
      continue;
    }
    if (runs.using === 'docker') continue;
    if (!runs.using.startsWith('node') || typeof runs.main !== 'string') {
      throw new Error(`Unsupported action runtime: ${manifestPath}`);
    }
    for (const field of ['pre', 'post'] as const) {
      if (field in runs && typeof runs[field] !== 'string') {
        throw new Error(`Invalid action ${field} entrypoint: ${manifestPath}`);
      }
    }
    for (const entrypoint of [runs.main, runs.pre, runs.post]) {
      if (typeof entrypoint !== 'string') continue;
      const runtimePath = posix.normalize(
        posix.join(posix.dirname(manifestPath), entrypoint),
      );
      if (!graph.sources.has(runtimePath)) {
        throw new Error(`Action entrypoint is untracked: ${runtimePath}`);
      }
      runtimePaths.add(runtimePath);
    }
  }
  return [...runtimePaths].sort();
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
  const actionPathsRequest: TrackedPathsRequest = { pathspecs: [] };
  const productionPaths = [...trackedPaths(productionRequest)].sort();
  const expectedProductionPaths = trackedPaths(productionRootRequest)
    .filter((path) => EXECUTABLE_SOURCE_EXTENSION.test(path))
    .sort();
  expect(productionPaths).toEqual(expectedProductionPaths);
  expect(productionPaths).toContain('agentic-ai/loom/src/cli.ts');
  expect(productionPaths).toContain('agentic-ai/loom/src/cli-invocation.ts');
  expect(productionPaths).toContain('agentic-ai/loom/src/loom-failure.ts');
  const configPaths = trackedPaths(configRequest);
  const actionPaths = trackedPaths(actionPathsRequest);
  const actionSources = new Map<string, string>();
  for (const path of actionPaths) {
    const source = isActionManifest(path)
      ? await Bun.file(join(REPOSITORY_ROOT, path)).text()
      : '';
    actionSources.set(path, source);
  }
  const actionGraph: ActionRuntimeGraph = {
    roots: configPaths.filter(isActionManifest),
    sources: actionSources,
  };
  const reachableActionPaths = actionRuntimePaths(actionGraph);
  expect(
    await pathsContainingProviderRoot([
      ...productionPaths,
      ...configPaths,
      ...reachableActionPaths,
    ]),
  ).toEqual([]);

  const activeAudit = await Bun.file(
    join(REPOSITORY_ROOT, 'agentic-ai/loom/src/commands/cortex-audit.ts'),
  ).text();
  expect(activeAudit).toContain("'../lib/cortex-article-structure.ts'");
  expect(activeAudit).not.toContain(PROVIDER_ROOT);
});

test('runnable configuration inventory includes Taskfiles and actions', () => {
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
  const expectedActions = trackedPaths(allPathsRequest)
    .filter((path) => path.startsWith('.github/actions/'))
    .filter(isActionManifest)
    .sort();
  const discoveredActions = trackedPaths(runnableConfigRequest)
    .filter(isActionManifest)
    .sort();
  expect(discoveredActions).toEqual(expectedActions);
});

test('follows JavaScript action entrypoints and nested local actions', () => {
  const sources = new Map<string, string>([
    [
      '.github/actions/root/action.yml',
      'runs:\n  using: composite\n  steps:\n    - uses: ./.github/actions/nested',
    ],
    [
      '.github/actions/nested/action.yaml',
      'runs:\n  using: node24\n  main: main.js\n  pre: pre.js\n  post: post.js',
    ],
    ['.github/actions/nested/main.js', 'main();'],
    ['.github/actions/nested/pre.js', 'prepare();'],
    ['.github/actions/nested/post.js', 'cleanup();'],
  ]);
  const graph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources,
  };
  expect(actionRuntimePaths(graph)).toEqual([
    '.github/actions/nested/action.yaml',
    '.github/actions/nested/main.js',
    '.github/actions/nested/post.js',
    '.github/actions/nested/pre.js',
    '.github/actions/root/action.yml',
  ]);

  const unresolvedSources = new Map(sources);
  unresolvedSources.delete('.github/actions/nested/main.js');
  const unresolvedGraph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources: unresolvedSources,
  };
  expect(() => actionRuntimePaths(unresolvedGraph)).toThrow(
    'Action entrypoint is untracked',
  );
});
