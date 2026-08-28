import { join, posix } from 'node:path';
import { expect, test } from 'bun:test';
import { violatesSkillProviderBoundary } from './skill-provider-boundary.test.ts';
import {
  type ConfigurationReferenceInspection,
  type ConfigurationScriptGraph,
  type ExecutableProviderReferenceInspection,
  expandStaticShellVariables,
  executableSourceReferencesProvider,
  executableScriptViolatesBoundary,
  ShellExecutablePolicy,
} from './skill-provider-executable-script.ts';
import type { SkillProviderSourceInspection } from './skill-provider-type-context.ts';
import { cortexArticleAdapterViolatesBoundary } from './cortex-article-adapter-boundary.ts';
import {
  executableSkillPackageFromPath,
  readTrackedRepositoryFiles,
} from '../src/executable-skills/repository.ts';
import {
  CANONICAL_TASKFILE,
  hasOnlyCanonicalHostTaskEdge,
  HOST_CLI,
  HOST_CLI_TEMPLATE,
  HOST_ROOT,
  HOST_TOOLS_LIST_SOURCE_PATHS,
} from './skill-host-task-boundary.ts';

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
type RequiredLaunchInspection = {
  readonly source: string;
  readonly specifier: string;
};
type ApplicationConsumerEdge = {
  readonly dependency: string;
  readonly importer: string;
  readonly source: string;
};
type RepositoryPackageDocument = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly name?: string;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
};
const REPOSITORY_ROOT = join(import.meta.dir, '../../..');
const PROVIDER_ROOT =
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts';
const PROVIDER_APPLICATION = `${PROVIDER_ROOT}/src/application.ts`;
const PROVIDER_DOMAIN = `${PROVIDER_ROOT}/src/domain.ts`;
const PROVIDER_PACKAGE = `${PROVIDER_ROOT}/package.json`;
const CORTEX_AUDIT = 'agentic-ai/loom/src/commands/cortex-audit.ts';
const LOOM_ARTICLE_ADAPTER =
  'agentic-ai/loom/src/lib/cortex-article-structure.ts';
const EXECUTABLE_SOURCE_EXTENSION = /\.(?:[cm]?tsx?|[cm]?jsx?)$/u;
const CONFIGURATION_SCRIPT_EXTENSION = /\.(?:[cm]?tsx?|[cm]?jsx?|sh)$/u;
const CONFIGURATION_SCRIPT_REFERENCE =
  /(?:^|[\s"'`:])((?:\.{0,2}\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:[cm]?[jt]sx?|sh))(?=$|[\s"'`,;\]}])/gmu;
const EXTENSIONLESS_SCRIPT_REFERENCE =
  /(?:^|[\s"'`:=[({,])((?:\.{1,2}\/|\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)(?=$|[\s"'`,;\]})])/gmu;
const ACTION_SOURCE_SUFFIXES = [
  '',
  ...'ts tsx mts cts js jsx mjs cjs'.split(' ').map((value) => `.${value}`),
] as const;
const actionTranspilerOptions: ActionTranspilerOptions = { loader: 'tsx' };
const ACTION_IMPORT_SCANNER = new Bun.Transpiler(actionTranspilerOptions);
function isTaskConfiguration(path: string): boolean {
  return /(^|\/)Taskfile(?:\.[^/]*)?\.ya?ml$/u.test(path);
}

function isRunnableConfiguration(path: string): boolean {
  return (
    /(^|\/)package\.json$/u.test(path) ||
    isTaskConfiguration(path) ||
    /(^|\/)\.env\.[^/]+$/u.test(path) ||
    /(^|\/)vite\.config\.(?:[cm]?ts|[cm]?js)$/u.test(path) ||
    /^\.task\/(?:[^/]+\/)*[^/]+\.ya?ml$/u.test(path) ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path) ||
    /^\.github\/actions\/(?:[^/]+\/)*action\.ya?ml$/u.test(path)
  );
}

async function pathsContainingProviderRoot(
  paths: readonly string[],
): Promise<readonly string[]> {
  const matches: string[] = [];
  for (const path of paths) {
    const source = await Bun.file(join(REPOSITORY_ROOT, path)).text();
    const referenceInspection: ExecutableProviderReferenceInspection = {
      path,
      source,
    };
    if (
      path.includes(PROVIDER_ROOT) ||
      executableSourceReferencesProvider(referenceInspection)
    ) {
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

function configurationScriptPaths(
  graph: ConfigurationScriptGraph,
): readonly string[] {
  const pending = [...graph.roots];
  const visited = new Set<string>();
  const scripts = new Set<string>();
  while (pending.length > 0) {
    const importer = pending.pop();
    if (!importer || visited.has(importer)) continue;
    visited.add(importer);
    const source = graph.sources.get(importer);
    if (typeof source !== 'string' || graph.symlinkPaths.has(importer)) {
      throw new Error(`Runnable configuration path is unsafe: ${importer}`);
    }
    if (importer.startsWith(PROVIDER_ROOT)) {
      throw new Error(`Runnable configuration reaches provider: ${importer}`);
    }
    const referenceSource =
      importer === CANONICAL_TASKFILE
        ? source.replaceAll(HOST_CLI_TEMPLATE, HOST_CLI)
        : source;
    const referenceInspection: ConfigurationReferenceInspection = {
      importer,
      source: referenceSource,
    };
    for (const specifier of configurationScriptReferences(
      referenceInspection,
    )) {
      const skillPackage = executableSkillPackageFromPath(importer);
      const scriptsIndex = importer.indexOf('/scripts/');
      const packageRoot =
        skillPackage !== false
          ? skillPackage.packageRoot
          : scriptsIndex < 0
            ? importer
            : importer.slice(0, scriptsIndex);
      const candidates: readonly string[] = [
        posix.normalize(specifier.replace(/^\.\//u, '')),
        posix.normalize(posix.join(posix.dirname(importer), specifier)),
        posix.normalize(posix.join(packageRoot, specifier)),
        posix.normalize(
          posix.join(
            posix.dirname(importer),
            specifier.replace(/^dist\//u, 'src/').replace(/\.js$/u, '.ts'),
          ),
        ),
      ];
      const dependency =
        candidates.find((path) => graph.sources.has(path)) ?? false;
      if (dependency === false) {
        const launchInspection: RequiredLaunchInspection = {
          source: referenceSource,
          specifier,
        };
        if (isRequiredScriptLaunch(launchInspection)) {
          throw new Error(
            `Runnable script is untracked: ${importer} -> ${specifier}`,
          );
        }
        continue;
      }
      if (graph.symlinkPaths.has(dependency)) {
        throw new Error(`Runnable script is a tracked symlink: ${dependency}`);
      }
      const isExtensionlessExecutable =
        posix.extname(dependency).length === 0 &&
        graph.executablePaths.has(dependency);
      if (
        CONFIGURATION_SCRIPT_EXTENSION.test(dependency) ||
        isExtensionlessExecutable
      ) {
        const edge: ApplicationConsumerEdge = {
          dependency,
          importer,
          source,
        };
        const applicationEdge = isApplicationDependency(dependency);
        if (applicationEdge && !isAuthorizedApplicationEdge(edge)) {
          throw new Error(`Unauthorized application edge: ${importer}`);
        }
        const adapterInspection = {
          path: dependency,
          source: graph.sources.get(dependency) ?? '',
        };
        if (
          dependency === LOOM_ARTICLE_ADAPTER &&
          cortexArticleAdapterViolatesBoundary(adapterInspection)
        ) {
          throw new Error(`Article adapter violates boundary: ${dependency}`);
        }
        const boundaryInspection = {
          path: dependency,
          roots: new Set(graph.roots),
          shellPolicy: ShellExecutablePolicy.TrackedConfiguration,
          source: graph.sources.get(dependency) ?? '',
          sources: graph.sources,
        };
        if (
          !applicationEdge &&
          executableScriptViolatesBoundary(boundaryInspection)
        ) {
          throw new Error(
            `Runnable script violates runtime boundary: ${dependency}`,
          );
        }
        if (dependency.startsWith(PROVIDER_ROOT)) {
          continue;
        }
        scripts.add(dependency);
      }
      pending.push(dependency);
    }
  }
  return [...scripts].sort();
}

function isApplicationDependency(path: string): boolean {
  return (
    path === LOOM_ARTICLE_ADAPTER ||
    path.startsWith(`${PROVIDER_ROOT}/`) ||
    path.startsWith(HOST_ROOT)
  );
}

function isAuthorizedApplicationEdge(edge: ApplicationConsumerEdge): boolean {
  if (edge.dependency.startsWith(HOST_ROOT)) {
    return (
      (edge.importer.startsWith(HOST_ROOT) &&
        edge.dependency.startsWith(HOST_ROOT)) ||
      (edge.importer === CANONICAL_TASKFILE &&
        edge.dependency === HOST_CLI &&
        hasOnlyCanonicalHostTaskEdge(edge.source))
    );
  }
  if (edge.dependency === LOOM_ARTICLE_ADAPTER) {
    return edge.importer === CORTEX_AUDIT;
  }
  return (
    edge.importer === LOOM_ARTICLE_ADAPTER &&
    (edge.dependency === PROVIDER_APPLICATION ||
      edge.dependency === PROVIDER_DOMAIN)
  );
}

function configurationScriptReferences(
  inspection: ConfigurationReferenceInspection,
): readonly string[] {
  const source = inspection.source;
  const launchSource = source.replace(/["'\\]/gu, '');
  const expandedSource = expandStaticShellVariables(launchSource);
  const matched = [source, expandedSource].flatMap((candidate) => {
    CONFIGURATION_SCRIPT_REFERENCE.lastIndex = 0;
    EXTENSIONLESS_SCRIPT_REFERENCE.lastIndex = 0;
    return [
      ...candidate.matchAll(CONFIGURATION_SCRIPT_REFERENCE),
      ...candidate.matchAll(EXTENSIONLESS_SCRIPT_REFERENCE),
    ]
      .map((match) => match[1] ?? false)
      .filter((specifier) => specifier !== false);
  });
  if (!EXECUTABLE_SOURCE_EXTENSION.test(inspection.importer)) {
    return [...new Set(matched)];
  }
  const importSource = source.replace(/^#![^\n]*\n/u, '');
  const references = new Set(
    ACTION_IMPORT_SCANNER.scanImports(importSource).map(
      (imported) => imported.path,
    ),
  );
  for (const specifier of matched) {
    const launchInspection: RequiredLaunchInspection = {
      source: expandedSource,
      specifier,
    };
    if (isRequiredScriptLaunch(launchInspection)) references.add(specifier);
  }
  return [...references];
}

function isRequiredScriptLaunch(inspection: RequiredLaunchInspection): boolean {
  if (inspection.specifier.includes('/node_modules/.bin/')) return false;
  if (inspection.source.includes('{{')) return false;
  const escapedSpecifier = inspection.specifier.replace(
    /[.*+?^${}()|[\]\\]/gu,
    '\\$&',
  );
  const launchPattern = new RegExp(
    `(?:^|[\\s;&|"'=:\\[(])(?:bun|node|bash|sh)\\s+["']?${escapedSpecifier}(?=$|[\\s"';&|])`,
    'u',
  );
  return launchPattern.test(inspection.source);
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
      if (isApplicationDependency(dependency)) {
        throw new Error(`Unauthorized action application edge: ${importer}`);
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

test('only the semantic adapter and exact discovery task reach applications', async () => {
  const tracked = readTrackedRepositoryFiles(REPOSITORY_ROOT);
  const allPaths = tracked.map((file) => file.path);
  const productionPaths = allPaths
    .filter((path) => path.startsWith('agentic-ai/loom/src/'))
    .filter((path) => EXECUTABLE_SOURCE_EXTENSION.test(path))
    .sort();
  expect(productionPaths).toContain('agentic-ai/loom/src/cli.ts');
  expect(productionPaths).toContain('agentic-ai/loom/src/cli-invocation.ts');
  expect(productionPaths).toContain('agentic-ai/loom/src/loom-failure.ts');
  const configPaths = allPaths.filter(isRunnableConfiguration);
  const symlinkPaths = new Set(
    tracked.filter((file) => file.mode === '120000').map((file) => file.path),
  );
  const configPathSet = new Set(configPaths);
  const actionSources = new Map<string, string>();
  for (const path of allPaths) {
    const source =
      !symlinkPaths.has(path) &&
      (actionSourceRequiresContent(path) ||
        configPathSet.has(path) ||
        CONFIGURATION_SCRIPT_EXTENSION.test(path))
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
  expect(hasOnlyCanonicalHostTaskEdge(actionSources)).toBe(true);
  const scriptGraph: ConfigurationScriptGraph = {
    executablePaths: new Set(
      tracked.filter((file) => file.mode === '100755').map((file) => file.path),
    ),
    roots: configPaths.filter((path) => path !== PROVIDER_PACKAGE),
    sources: actionSources,
    symlinkPaths,
  };
  const reachableScriptPaths = configurationScriptPaths(scriptGraph);
  expect(
    reachableScriptPaths.filter((path) => path.startsWith(HOST_ROOT)),
  ).toEqual(HOST_TOOLS_LIST_SOURCE_PATHS);
  expect(await pathsContainingProviderRoot(productionPaths)).toEqual([
    LOOM_ARTICLE_ADAPTER,
  ]);
  expect(
    await pathsContainingProviderRoot([
      ...configPaths,
      ...reachableActionPaths,
      ...reachableScriptPaths,
    ]),
  ).toEqual(
    [PROVIDER_PACKAGE, CANONICAL_TASKFILE, LOOM_ARTICLE_ADAPTER].sort(),
  );

  const activeAudit = await Bun.file(
    join(REPOSITORY_ROOT, 'agentic-ai/loom/src/commands/cortex-audit.ts'),
  ).text();
  expect(activeAudit).toContain("'../lib/cortex-article-structure.ts'");
  expect(activeAudit).not.toContain('src/cortex-article-provider');
}, 15_000);

test('runnable configuration inventory includes Taskfiles and actions', () => {
  const allPaths = readTrackedRepositoryFiles(REPOSITORY_ROOT).map(
    (file) => file.path,
  );
  const runnablePaths = allPaths.filter(isRunnableConfiguration);
  const expected = allPaths.filter(isTaskConfiguration).sort();
  const discovered = runnablePaths.filter(isTaskConfiguration).sort();
  expect(discovered).toEqual(expected);
  const expectedActions = allPaths
    .filter((path) => path.startsWith('.github/actions/'))
    .filter(isActionManifest)
    .sort();
  const discoveredActions = runnablePaths.filter(isActionManifest).sort();
  expect(discoveredActions).toEqual(expectedActions);
});

test('classifies every runnable configuration category at root and nested boundaries', () => {
  const expected = [
    'package.json',
    'nested/package.json',
    'Taskfile.yml',
    'Taskfile.ci.yml',
    'nested/Taskfile.yaml',
    '.env.test',
    'nested/.env.local',
    'vite.config.ts',
    'nested/vite.config.mjs',
    '.task/root.yml',
    '.task/nested/task.yaml',
    '.task/evil\n.yml',
    '.github/workflows/policy.yml',
    '.github/actions/action.yml',
    '.github/actions/nested/action.yaml',
    '.github/actions/evil\n/action.yml',
  ];
  const candidates = [
    ...expected,
    'package.json.backup',
    '.github/workflows/nested/policy.yml',
    '.github/actions/action.yml/child',
    '.github/actions/nested/not-action.yml',
    'nested/.task/task.yml',
    '.task/evil\n.yml/child',
    '.github/actions/evil\n/not-action.yml',
    '.github/actions/evil\n/action.yml/child',
    'nested/vite.config.css',
  ];
  expect(candidates.filter(isRunnableConfiguration)).toEqual(expected);
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
      '.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/audit.ts',
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
    "export { audit } from '../../../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/audit.ts';",
  );
  const providerGraph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources: providerSources,
    symlinkPaths: new Set<string>(),
  };
  expect(() => actionRuntimePaths(providerGraph)).toThrow(
    'Action source violates runtime boundary',
  );

  const adapterSources = new Map(sources);
  adapterSources.set(
    '.github/actions/nested/neutral.js',
    `import '../../../${LOOM_ARTICLE_ADAPTER}';`,
  );
  adapterSources.set(LOOM_ARTICLE_ADAPTER, 'export const adapter = true;');
  const adapterGraph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources: adapterSources,
    symlinkPaths: new Set<string>(),
  };
  expect(() => actionRuntimePaths(adapterGraph)).toThrow(
    'Unauthorized action application edge',
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

test('follows scripts launched from every runnable configuration surface', () => {
  for (const [path, source] of [
    ['package.json', '{"scripts":{"audit":"bun scripts/facade.ts"}}'],
    ['package.json', `{"scripts":{"audit":"bun ${LOOM_ARTICLE_ADAPTER}"}}`],
    ['package.json', `{"scripts":{"audit":"bun ${HOST_CLI}"}}`],
    ['package.json', `{"scripts":{"audit":"bun ${HOST_ROOT}\\"cli.ts\\""}}`],
    ['package.json', `root=${HOST_ROOT.slice(0, -1)}; bun "$root/cli.ts"`],
    ['package.json', `a=${HOST_ROOT.slice(0, -1)}; b=$a; bun "$b/cli.ts"`],
    ['package.json', 'a=$b; b=$a; bun "$b/cli.ts"'],
    ['package.json', `root=$PWD/${HOST_ROOT}cli.ts; bun "$root"`],
    ['package.json', `root=\${PWD}/${HOST_ROOT}cli.ts; bun "$root"`],
    [
      'package.json',
      `a=${HOST_ROOT}; bun "\${a}/$(printf src)/cli.ts"; bun "\${a}/\`printf src\`/cli.ts"`,
    ],
    ['Taskfile.yml', 'tasks:\n  audit:\n    cmds: [bun scripts/facade.ts]'],
    [
      'Taskfile.yml',
      `tasks:\n  audit:\n    cmds: [bun ${LOOM_ARTICLE_ADAPTER}]`,
    ],
    [
      'Taskfile.yml',
      `tasks:\n  audit:\n    cmds: [bun ${HOST_ROOT}skill-action-registry.ts]`,
    ],
    [
      '.github/workflows/audit.yml',
      'jobs:\n  audit:\n    steps:\n      - run: bun scripts/facade.ts',
    ],
    [
      '.github/workflows/audit.yml',
      `jobs:\n  audit:\n    steps:\n      - run: bun ${LOOM_ARTICLE_ADAPTER}`,
    ],
    [
      '.github/actions/audit/action.yml',
      'runs:\n  using: composite\n  steps:\n    - run: bun scripts/facade.ts',
    ],
    [
      '.github/actions/audit/action.yml',
      `runs:\n  using: composite\n  steps:\n    - run: bun ${LOOM_ARTICLE_ADAPTER}`,
    ],
  ] as const) {
    const sources = new Map<string, string>([
      [path, source],
      ['scripts/facade.ts', "import './nested.ts';"],
      [
        'scripts/nested.ts',
        "import '../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/audit.ts';",
      ],
      [`${PROVIDER_ROOT}/src/audit.ts`, 'export const audit = true;'],
      [LOOM_ARTICLE_ADAPTER, `import '../../../${PROVIDER_APPLICATION}';`],
      [PROVIDER_APPLICATION, 'export const application = true;'],
      [HOST_CLI, 'export const main = true;'],
      [`${HOST_ROOT}skill-action-registry.ts`, 'export const registry = true;'],
    ]);
    const graph: ConfigurationScriptGraph = {
      executablePaths: new Set<string>(),
      roots: [path],
      sources,
      symlinkPaths: new Set<string>(),
    };
    expect(() => configurationScriptPaths(graph), `${path}:${source}`).toThrow(
      /Unauthorized application edge|runtime boundary|Runnable script is untracked|Task launch variable/u,
    );
  }
  const sources = new Map<string, string>([
    ['package.json', '{"scripts":{"audit":"bun scripts/missing.ts"}}'],
  ]);
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set<string>(),
    roots: ['package.json'],
    sources,
    symlinkPaths: new Set<string>(),
  };
  expect(() => configurationScriptPaths(graph)).toThrow(
    'Runnable script is untracked',
  );

  const inertCatalogSources = new Map<string, string>([
    ['package.json', '{"scripts":{"audit":"bun scripts/catalog.ts"}}'],
    [
      '.task/env-catalog.yml',
      'tasks:\n  audit:\n    cmds: ["bun scripts/catalog.ts --label $(printf $PWD)"]',
    ],
    ['scripts/catalog.ts', "const evidencePath = 'scripts/unsafe.test.ts';"],
    ['scripts/unsafe.test.ts', 'eval(source);'],
  ]);
  const inertCatalogGraph: ConfigurationScriptGraph = {
    executablePaths: new Set<string>(),
    roots: ['package.json', '.task/env-catalog.yml'],
    sources: inertCatalogSources,
    symlinkPaths: new Set<string>(),
  };
  expect(configurationScriptPaths(inertCatalogGraph)).toEqual([
    'scripts/catalog.ts',
  ]);
});

test('rejects a dangerous adapter from the canonical runnable graph', () => {
  const sources = new Map<string, string>([
    [
      'package.json',
      '{"scripts":{"audit":"bun agentic-ai/loom/src/commands/cortex-audit.ts"}}',
    ],
    [CORTEX_AUDIT, "import '../lib/cortex-article-structure.ts';"],
    [
      LOOM_ARTICLE_ADAPTER,
      `import '../../../${PROVIDER_APPLICATION}'; process.exit(0);`,
    ],
    [PROVIDER_APPLICATION, 'export const application = true;'],
  ]);
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set<string>(),
    roots: ['package.json'],
    sources,
    symlinkPaths: new Set<string>(),
  };
  expect(() => configurationScriptPaths(graph)).toThrow(
    'Article adapter violates boundary',
  );
});

test('checks external and extensionless configuration scripts as executable sources', () => {
  for (const externalSource of [
    'eval(source);',
    'await import(modulePath);',
    "import '../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/audit.ts';",
  ]) {
    const sources = new Map<string, string>([
      ['package.json', '{"scripts":{"audit":"bun scripts/external.ts"}}'],
      ['scripts/external.ts', externalSource],
    ]);
    const graph: ConfigurationScriptGraph = {
      executablePaths: new Set<string>(),
      roots: ['package.json'],
      sources,
      symlinkPaths: new Set<string>(),
    };
    expect(() => configurationScriptPaths(graph), externalSource).toThrow(
      'Runnable script violates runtime boundary',
    );
  }

  const extensionlessSources = new Map<string, string>([
    ['Taskfile.yml', 'tasks:\n  audit:\n    cmds: [./scripts/audit]'],
    ['scripts/audit', 'eval(source);'],
  ]);
  const executableGraph: ConfigurationScriptGraph = {
    executablePaths: new Set<string>(['scripts/audit']),
    roots: ['Taskfile.yml'],
    sources: extensionlessSources,
    symlinkPaths: new Set<string>(),
  };
  expect(() => configurationScriptPaths(executableGraph)).toThrow(
    'Runnable script violates runtime boundary',
  );

  const nonExecutableGraph: ConfigurationScriptGraph = {
    executablePaths: new Set<string>(),
    roots: ['Taskfile.yml'],
    sources: extensionlessSources,
    symlinkPaths: new Set<string>(),
  };
  expect(configurationScriptPaths(nonExecutableGraph)).toEqual([]);
});
