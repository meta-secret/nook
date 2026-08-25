import { join, posix } from 'node:path';
import { expect, test } from 'bun:test';
import { violatesSkillProviderBoundary } from './skill-provider-boundary.test.ts';
import type { SkillProviderSourceInspection } from './skill-provider-type-context.ts';

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
  readonly symlinkPaths: ReadonlySet<string>;
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

type ActionDependencyResolution = {
  readonly importer: string;
  readonly sources: ReadonlyMap<string, string>;
  readonly specifier: string;
};

type ActionTranspilerOptions = {
  readonly loader: 'tsx';
};

type ActionLoaderFixture = {
  readonly path: string;
  readonly source: string;
};

type RepositoryPackageDocument = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly name?: string;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
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
const ACTION_SOURCE_SUFFIXES = [
  '',
  ...'ts tsx mts cts js jsx mjs cjs'.split(' ').map((value) => `.${value}`),
] as const;
const actionTranspilerOptions: ActionTranspilerOptions = { loader: 'tsx' };
const ACTION_IMPORT_SCANNER = new Bun.Transpiler(actionTranspilerOptions);

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

function trackedSymlinkPaths(): ReadonlySet<string> {
  const spawnOptions = {
    cmd: ['git', 'ls-files', '--stage', '-z'],
    cwd: REPOSITORY_ROOT,
    stderr: 'pipe' as const,
    stdout: 'pipe' as const,
  };
  const result = Bun.spawnSync(spawnOptions);
  if (result.exitCode !== 0) {
    throw new Error(`Unable to enumerate tracked modes: ${result.stderr}`);
  }
  const symlinkPaths = new Set<string>();
  for (const entry of result.stdout.toString().split('\0').filter(Boolean)) {
    const separator = entry.indexOf('\t');
    if (separator < 0) throw new Error('Tracked mode record has no path');
    if (entry.startsWith('120000 ')) {
      symlinkPaths.add(entry.slice(separator + 1));
    }
  }
  return symlinkPaths;
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

function actionSourceRequiresContent(path: string): boolean {
  return (
    isActionManifest(path) ||
    EXECUTABLE_SOURCE_EXTENSION.test(path) ||
    posix.extname(path) === '' ||
    path.endsWith('package.json')
  );
}

function actionRuntimePaths(graph: ActionRuntimeGraph): readonly string[] {
  const pending = [...graph.roots];
  const pendingSources: string[] = [];
  const visited = new Set<string>();
  const runtimePaths = new Set<string>();
  while (pending.length > 0) {
    const manifestPath = pending.pop();
    if (!manifestPath || visited.has(manifestPath)) continue;
    if (graph.symlinkPaths.has(manifestPath)) {
      throw new Error(`Action path is a tracked symlink: ${manifestPath}`);
    }
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
        if (typeof step.uses !== 'string') {
          continue;
        }
        if (step.uses.startsWith('docker://')) {
          throw new Error(`Unsupported Docker action step: ${step.uses}`);
        }
        if (!step.uses.startsWith('./')) continue;
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
    if (runs.using === 'docker') {
      throw new Error(`Unsupported Docker action runtime: ${manifestPath}`);
    }
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
      if (graph.symlinkPaths.has(runtimePath)) {
        throw new Error(`Action path is a tracked symlink: ${runtimePath}`);
      }
      if (!graph.sources.has(runtimePath)) {
        throw new Error(`Action entrypoint is untracked: ${runtimePath}`);
      }
      runtimePaths.add(runtimePath);
      pendingSources.push(runtimePath);
    }
  }
  const visitedSources = new Set<string>();
  while (pendingSources.length > 0) {
    const importer = pendingSources.pop();
    if (!importer || visitedSources.has(importer)) continue;
    visitedSources.add(importer);
    const source = graph.sources.get(importer);
    if (typeof source !== 'string') {
      throw new Error(`Action source is unreadable: ${importer}`);
    }
    const boundaryInspection: SkillProviderSourceInspection = {
      filePath: posix.extname(importer) === '' ? `${importer}.js` : importer,
      source,
    };
    if (violatesSkillProviderBoundary(boundaryInspection)) {
      throw new Error(`Action source violates runtime boundary: ${importer}`);
    }
    for (const imported of ACTION_IMPORT_SCANNER.scanImports(source)) {
      const resolution: ActionDependencyResolution = {
        importer,
        sources: graph.sources,
        specifier: imported.path,
      };
      if (!imported.path.startsWith('.')) {
        if (isRepositoryBackedActionSpecifier(resolution)) {
          throw new Error(
            `Action repository import is unsupported: ${importer} -> ${imported.path}`,
          );
        }
        continue;
      }
      const dependency = resolveActionDependency(resolution);
      if (
        dependency === false ||
        !EXECUTABLE_SOURCE_EXTENSION.test(dependency)
      ) {
        throw new Error(
          `Action relative import is unresolved: ${importer} -> ${imported.path}`,
        );
      }
      if (graph.symlinkPaths.has(dependency)) {
        throw new Error(`Action path is a tracked symlink: ${dependency}`);
      }
      if (!runtimePaths.has(dependency)) {
        runtimePaths.add(dependency);
        pendingSources.push(dependency);
      }
    }
  }
  return [...runtimePaths].sort();
}

function isRepositoryBackedActionSpecifier(
  resolution: ActionDependencyResolution,
): boolean {
  const specifier = resolution.specifier;
  if (specifier.startsWith('#') || specifier.startsWith('file:')) return true;
  if (specifier.startsWith('.') || specifier.startsWith('node:')) return false;
  const segments = specifier.split('/');
  const packageName = specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : (segments[0] ?? '');
  for (const [path, source] of resolution.sources) {
    if (!path.endsWith('package.json') || source.length === 0) continue;
    let document: RepositoryPackageDocument;
    try {
      document = JSON.parse(source) as RepositoryPackageDocument;
    } catch {
      continue;
    }
    if (document.name === packageName) return true;
    for (const dependencies of [
      document.dependencies,
      document.devDependencies,
      document.optionalDependencies,
    ]) {
      const dependency = dependencies?.[packageName] ?? false;
      if (
        dependency !== false &&
        (dependency.startsWith('file:') || dependency.startsWith('workspace:'))
      ) {
        return true;
      }
    }
  }
  return false;
}

function resolveActionDependency(
  resolution: ActionDependencyResolution,
): string | false {
  const base = posix.normalize(
    posix.join(posix.dirname(resolution.importer), resolution.specifier),
  );
  for (const suffix of ACTION_SOURCE_SUFFIXES) {
    const direct = `${base}${suffix}`;
    if (resolution.sources.has(direct)) return direct;
    const indexed = posix.join(base, `index${suffix}`);
    if (resolution.sources.has(indexed)) return indexed;
  }
  return false;
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
  const symlinkPaths = trackedSymlinkPaths();
  const actionSources = new Map<string, string>();
  for (const path of actionPaths) {
    const source =
      !symlinkPaths.has(path) && actionSourceRequiresContent(path)
        ? await Bun.file(join(REPOSITORY_ROOT, path)).text()
        : '';
    actionSources.set(path, source);
  }
  const actionGraph: ActionRuntimeGraph = {
    roots: configPaths.filter(isActionManifest),
    sources: actionSources,
    symlinkPaths,
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
      'runs:\n  using: node24\n  main: main\n  pre: pre.js\n  post: post.js',
    ],
    ['.github/actions/nested/main', "import './neutral.js'; main();"],
    ['.github/actions/nested/neutral.js', 'export const safe = true;'],
    ['.github/actions/nested/pre.js', 'prepare();'],
    ['.github/actions/nested/post.js', 'cleanup();'],
    [
      '.agents/skills/cortex-article-structure/src/audit.ts',
      'export const audit = true;',
    ],
  ]);
  const graph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources,
    symlinkPaths: new Set<string>(),
  };
  expect(actionSourceRequiresContent('.github/actions/nested/main')).toBe(true);
  expect(actionRuntimePaths(graph)).toEqual([
    '.github/actions/nested/action.yaml',
    '.github/actions/nested/main',
    '.github/actions/nested/neutral.js',
    '.github/actions/nested/post.js',
    '.github/actions/nested/pre.js',
    '.github/actions/root/action.yml',
  ]);

  const providerSources = new Map(sources);
  providerSources.set(
    '.github/actions/nested/neutral.js',
    "export { audit } from '../../../.agents/skills/cortex-article-structure/src/audit.ts';",
  );
  const providerGraph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources: providerSources,
    symlinkPaths: new Set<string>(),
  };
  expect(() => actionRuntimePaths(providerGraph)).toThrow(
    'Action source violates runtime boundary',
  );

  const unresolvedSources = new Map(sources);
  unresolvedSources.delete('.github/actions/nested/main');
  const unresolvedGraph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources: unresolvedSources,
    symlinkPaths: new Set<string>(),
  };
  expect(() => actionRuntimePaths(unresolvedGraph)).toThrow(
    'Action entrypoint is untracked',
  );

  const unresolvedImportSources = new Map(sources);
  unresolvedImportSources.set(
    '.github/actions/nested/neutral.js',
    "export { audit } from './missing.js';",
  );
  const unresolvedImportGraph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources: unresolvedImportSources,
    symlinkPaths: new Set<string>(),
  };
  expect(() => actionRuntimePaths(unresolvedImportGraph)).toThrow(
    'Action relative import is unresolved',
  );

  const dockerSources = new Map(sources);
  dockerSources.set(
    '.github/actions/root/action.yml',
    'runs:\n  using: docker\n  image: Dockerfile',
  );
  const dockerGraph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources: dockerSources,
    symlinkPaths: new Set<string>(),
  };
  expect(() => actionRuntimePaths(dockerGraph)).toThrow(
    'Unsupported Docker action runtime',
  );

  const dockerStepSources = new Map(sources);
  dockerStepSources.set(
    '.github/actions/root/action.yml',
    'runs:\n  using: composite\n  steps:\n    - uses: docker://alpine:3.20',
  );
  const dockerStepGraph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources: dockerStepSources,
    symlinkPaths: new Set<string>(),
  };
  expect(() => actionRuntimePaths(dockerStepGraph)).toThrow(
    'Unsupported Docker action step',
  );

  const packageSources = new Map(sources);
  packageSources.set(
    '.github/actions/nested/main',
    "import 'local-action/provider';",
  );
  packageSources.set(
    '.github/actions/nested/package.json',
    '{"name":"local-action","exports":{"./provider":"./neutral.js"}}',
  );
  const packageGraph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources: packageSources,
    symlinkPaths: new Set<string>(),
  };
  expect(() => actionRuntimePaths(packageGraph)).toThrow(
    'Action repository import is unsupported',
  );

  const aliasSources = new Map(sources);
  aliasSources.set('.github/actions/nested/main', "import '#provider';");
  const aliasGraph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources: aliasSources,
    symlinkPaths: new Set<string>(),
  };
  expect(() => actionRuntimePaths(aliasGraph)).toThrow(
    'Action repository import is unsupported',
  );

  const loaderFixtures: readonly ActionLoaderFixture[] = [
    {
      path: '.github/actions/nested/main',
      source: 'module.require(modulePath);',
    },
    {
      path: '.github/actions/nested/pre.js',
      source: 'require.call(undefined, modulePath);',
    },
    {
      path: '.github/actions/nested/post.js',
      source: 'require.resolve(modulePath);',
    },
    {
      path: '.github/actions/nested/neutral.js',
      source: 'process.mainModule.require(modulePath);',
    },
  ];
  for (const fixture of loaderFixtures) {
    const loaderSources = new Map(sources);
    loaderSources.set(fixture.path, fixture.source);
    const loaderGraph: ActionRuntimeGraph = {
      roots: ['.github/actions/root/action.yml'],
      sources: loaderSources,
      symlinkPaths: new Set<string>(),
    };
    expect(() => actionRuntimePaths(loaderGraph), fixture.path).toThrow(
      'Action source violates runtime boundary',
    );
  }

  for (const path of [
    '.github/actions/root/action.yml',
    '.github/actions/nested/main',
    '.github/actions/nested/pre.js',
    '.github/actions/nested/post.js',
    '.github/actions/nested/neutral.js',
  ]) {
    const symlinkPaths = new Set<string>();
    symlinkPaths.add(path);
    const symlinkGraph: ActionRuntimeGraph = {
      roots: ['.github/actions/root/action.yml'],
      sources,
      symlinkPaths,
    };
    expect(() => actionRuntimePaths(symlinkGraph), path).toThrow(
      'Action path is a tracked symlink',
    );
  }
});
