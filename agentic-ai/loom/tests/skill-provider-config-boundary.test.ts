import { join, posix } from 'node:path';
import { expect, test } from 'bun:test';
import { violatesSkillProviderBoundary } from './skill-provider-boundary.test.ts';
import {
  type ConfigurationReferenceInspection,
  type ConfigurationScriptGraph,
  executableScriptViolatesBoundary,
  ShellExecutablePolicy,
} from './skill-provider-executable-script.ts';
import {
  analyzeShellCommands,
  type ShellScriptLaunch,
} from './skill-provider-command-boundary.ts';
import type { SkillProviderSourceInspection } from './skill-provider-type-context.ts';
import { cortexArticleAdapterViolatesBoundary } from './cortex-article-adapter-boundary.ts';
import {
  assertConfigurationSourceBoundary,
  CORTEX_AUDIT,
  isApplicationDependency,
  isAuthorizedApplicationEdge,
  LOOM_ARTICLE_ADAPTER,
  PROVIDER_APPLICATION,
  PROVIDER_DOMAIN,
  PROVIDER_PACKAGE,
  PROVIDER_ROOT,
} from './skill-provider-config-application.ts';
import {
  assertRunnableConfigurationBytes,
  runnableCommandSources,
  taskIncludeSpecifiers,
} from './skill-provider-config-commands.ts';
import {
  actionSourceRequiresContent,
  ACTION_SOURCE_SUFFIXES,
  configurationRootWorkingDirectory,
  CONFIGURATION_GRAPH_LIMITS as LIMITS,
  isActionManifest,
  isRepositoryBackedPackageSpecifier,
  isRunnableConfiguration,
  normalizeConfigurationShellSource,
  resolutionCandidates,
  specializePositionalArguments,
} from './skill-provider-config-runtime.ts';
import { githubScriptConfigurationReferences } from './skill-provider-github-script.ts';
import * as configTestHelpers from './skill-provider-config-test-helpers.ts';
import {
  eslintConfigurationReferences,
  type EslintConfigurationRequest,
} from './skill-provider-eslint-config.ts';
import { typescriptSubprocessCommands } from './skill-provider-typescript-subprocess.ts';
import {
  AUDITED_SOURCE_SEAMS,
  isAuditedRuntimeSource,
} from './skill-provider-sourced-seams.ts';
import { readTrackedRepositoryFiles } from '../src/executable-skills/repository.ts';
import type {
  ActionDependencyResolution,
  ActionLoaderFixture,
  ActionRuntimeGraph,
  ActionTranspilerOptions,
  ApplicationConsumerEdge,
  ConfigurationReference,
  ConfigurationReferenceRequest,
  GitHubActionDocument,
  PendingConfiguration,
} from './skill-provider-config-types.ts';

const REPOSITORY_ROOT = join(import.meta.dir, '../../..');
const EXECUTABLE_SOURCE_EXTENSION = /\.(?:[cm]?tsx?|[cm]?jsx?)$/u;
const CONFIGURATION_SCRIPT_EXTENSION = /\.(?:[cm]?tsx?|[cm]?jsx?|sh)$/u;
const actionTranspilerOptions: ActionTranspilerOptions = { loader: 'tsx' };
const ACTION_IMPORT_SCANNER = new Bun.Transpiler(actionTranspilerOptions);

export function configurationScriptPaths(
  graph: ConfigurationScriptGraph,
): readonly string[] {
  const pending: PendingConfiguration[] = graph.roots.map((importer) => ({
    importer,
    positionalArguments: false,
    shellRuntime: false,
    depth: 0,
    workingDirectory: configurationRootWorkingDirectory(importer),
  }));
  const visited = new Set<string>();
  const scripts = new Set<string>();
  while (pending.length > 0) {
    const next = pending.pop();
    if (!next) continue;
    const importer = next.importer;
    if (next.depth > LIMITS.depth || visited.size >= LIMITS.states)
      throw new Error('Runnable configuration graph exceeds its bound.');
    if (
      next.positionalArguments !== false &&
      next.positionalArguments.length > LIMITS.arguments
    )
      throw new Error('Runnable configuration arguments exceed their bound.');
    const visitKey = `${importer}\0${next.shellRuntime}\0${next.workingDirectory}\0${JSON.stringify(next.positionalArguments)}`;
    if (new TextEncoder().encode(visitKey).byteLength > LIMITS.stateBytes)
      throw new Error('Runnable configuration state exceeds its byte bound.');
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    const source = graph.sources.get(importer);
    if (typeof source !== 'string' || graph.symlinkPaths.has(importer)) {
      throw new Error(`Runnable configuration path is unsafe: ${importer}`);
    }
    const sourceBoundaryRequest = {
      path: importer,
      source,
    };
    if (graph.roots.includes(importer))
      assertConfigurationSourceBoundary(sourceBoundaryRequest);
    if (importer.startsWith(PROVIDER_ROOT)) {
      throw new Error(`Runnable configuration reaches provider: ${importer}`);
    }
    for (const seam of AUDITED_SOURCE_SEAMS.filter(
      (candidate) => candidate.sourcePath === importer,
    )) {
      if (!source.includes(seam.marker))
        throw new Error(`Audited source seam is absent: ${importer}`);
      if (seam.targetPath === false || seam.digest === false) continue;
      const target = graph.sources.get(seam.targetPath) ?? '';
      const digest = new Bun.CryptoHasher('sha256')
        .update(target)
        .digest('hex');
      if (digest !== seam.digest)
        throw new Error(
          `Audited source helper has drifted: ${seam.targetPath}`,
        );
    }
    const referenceInspection: ConfigurationReferenceInspection = {
      importer,
      source,
    };
    const configurationRequest = {
      inspection: referenceInspection,
      positionalArguments: next.positionalArguments,
      shellRuntime: next.shellRuntime,
      sources: graph.sources,
      workingDirectory: next.workingDirectory,
    };
    for (const reference of configurationScriptReferences(
      configurationRequest,
    )) {
      const specifier = reference.specifier;
      const resolutionRequest = {
        exactFirst: reference.required,
        importer,
        importerRelative: reference.importerRelative,
        specifier,
        sources: graph.sources,
        workingDirectory: next.workingDirectory,
      };
      const candidates = resolutionCandidates(resolutionRequest);
      const dependency =
        candidates.find((path) => graph.sources.has(path)) ?? false;
      if (dependency === false) {
        const packageRequest = { sources: graph.sources, specifier };
        if (isRepositoryBackedPackageSpecifier(packageRequest))
          throw new Error(
            `Runnable repository package import is unsupported: ${importer} -> ${specifier}`,
          );
        if (
          reference.required &&
          (reference.taskInclude || posix.extname(specifier).length > 0)
        ) {
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
        (!reference.requiresExecuteMode ||
          graph.executablePaths.has(dependency));
      if (
        reference.taskInclude ||
        reference.shellRuntime ||
        CONFIGURATION_SCRIPT_EXTENSION.test(dependency) ||
        isExtensionlessExecutable
      ) {
        const edge: ApplicationConsumerEdge = { dependency, importer };
        const applicationEdge = isApplicationDependency(dependency);
        if (applicationEdge && !isAuthorizedApplicationEdge(edge)) {
          throw new Error(`Unauthorized application edge: ${importer}`);
        }
        const specializationRequest = {
          arguments: reference.positionalArguments,
          source: graph.sources.get(dependency) ?? '',
        };
        const specializedSource = specializePositionalArguments(
          specializationRequest,
        );
        const adapterInspection = {
          path: dependency,
          source: specializedSource,
        };
        if (
          dependency === LOOM_ARTICLE_ADAPTER &&
          cortexArticleAdapterViolatesBoundary(adapterInspection)
        ) {
          throw new Error(`Article adapter violates boundary: ${dependency}`);
        }
        const boundaryInspection = {
          path: reference.shellRuntime ? `${dependency}.sh` : dependency,
          roots: new Set(graph.roots),
          shellPolicy: ShellExecutablePolicy.TrackedConfiguration,
          source: specializedSource,
          sources: graph.sources,
        };
        const runtimeSourceRequest = {
          path: dependency,
          source: graph.sources.get(dependency) ?? '',
        };
        if (
          !applicationEdge &&
          !reference.taskInclude &&
          !isAuditedRuntimeSource(runtimeSourceRequest) &&
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
        const pendingConfiguration: PendingConfiguration = {
          importer: dependency,
          positionalArguments: reference.positionalArguments,
          shellRuntime: reference.shellRuntime,
          depth: next.depth + 1,
          workingDirectory: reference.workingDirectory,
        };
        pending.push(pendingConfiguration);
      }
    }
  }
  return [...scripts].sort();
}

function configurationScriptReferences(request: ConfigurationReferenceRequest) {
  const inspection = request.inspection;
  const extensionlessModule =
    posix.extname(inspection.importer).length === 0 &&
    (!inspection.source.startsWith('#!') ||
      /^#![^\n]*(?:bun|node)/u.test(inspection.source)) &&
    ACTION_IMPORT_SCANNER.scanImports(inspection.source).length > 0;
  if (
    !EXECUTABLE_SOURCE_EXTENSION.test(inspection.importer) &&
    !extensionlessModule
  ) {
    const runtimeSourceRequest = {
      path: inspection.importer,
      source: inspection.source,
    };
    if (isAuditedRuntimeSource(runtimeSourceRequest)) return [];
    const commandInspection = {
      path: inspection.importer,
      source: inspection.source,
    };
    const commands = request.shellRuntime
      ? [inspection.source.replace(/^#![^\n]*(?:\n|$)/u, '')]
      : runnableCommandSources(commandInspection);
    const launches = commands.flatMap(
      (source): readonly ShellScriptLaunch[] => {
        const shellInspection = {
          positionalArguments: request.positionalArguments,
          source: normalizeConfigurationShellSource([
            source,
            inspection.importer,
          ]),
          sourcePath: inspection.importer,
        };
        return analyzeShellCommands(shellInspection).launches;
      },
    );
    const eslintRequest: EslintConfigurationRequest = {
      commands,
      importer: inspection.importer,
      sources: request.sources,
      workingDirectory: request.workingDirectory,
    };
    const references: ConfigurationReference[] = [
      ...eslintConfigurationReferences(eslintRequest),
      ...launches.map((launch) => ({
        importerRelative: false,
        positionalArguments: launch.positionalArguments,
        required: true,
        requiresExecuteMode: launch.requiresExecuteMode,
        shellRuntime: launch.shellRuntime,
        specifier: launch.specifier,
        taskInclude: false,
        workingDirectory: posix
          .normalize(
            posix.join(request.workingDirectory, launch.workingDirectory),
          )
          .replace(/^\.$/u, ''),
      })),
    ];
    if (/\.ya?ml$/u.test(inspection.importer))
      references.push(
        ...taskIncludeSpecifiers(inspection.source).map((specifier) => ({
          importerRelative: true,
          positionalArguments: false as const,
          required: true,
          requiresExecuteMode: false,
          shellRuntime: false,
          specifier,
          taskInclude: true,
          workingDirectory: request.workingDirectory,
        })),
      );
    const githubScriptRequest = {
      importer: inspection.importer,
      positionalArguments: request.positionalArguments,
      source: inspection.source,
      workingDirectory: request.workingDirectory,
    };
    references.push(
      ...githubScriptConfigurationReferences(githubScriptRequest),
    );
    return references;
  }
  const specializationRequest = {
    arguments: request.positionalArguments,
    source: inspection.source.replace(/^#![^\n]*\n/u, ''),
  };
  const importSource = specializePositionalArguments(specializationRequest);
  const imports: ConfigurationReference[] = ACTION_IMPORT_SCANNER.scanImports(
    importSource,
  ).map((imported) => ({
    importerRelative: true,
    positionalArguments: false,
    required: false,
    requiresExecuteMode: false,
    shellRuntime: false,
    specifier: imported.path,
    taskInclude: false,
    workingDirectory: request.workingDirectory,
  }));
  const subprocessInspection = {
    path: inspection.importer,
    source: importSource,
  };
  const runtimeSourceRequest = {
    path: inspection.importer,
    source: inspection.source,
  };
  const subprocesses = isAuditedRuntimeSource(runtimeSourceRequest)
    ? []
    : typescriptSubprocessCommands(subprocessInspection);
  const launches = subprocesses.flatMap(
    (source): readonly ConfigurationReference[] => {
      const shellInspection = {
        positionalArguments: request.positionalArguments,
        source,
        sourcePath: inspection.importer,
      };
      const shellLaunches = analyzeShellCommands(shellInspection).launches;
      return shellLaunches.map((launch) => ({
        importerRelative: false,
        positionalArguments: launch.positionalArguments,
        required: true,
        requiresExecuteMode: launch.requiresExecuteMode,
        shellRuntime: launch.shellRuntime,
        specifier: launch.specifier,
        taskInclude: false,
        workingDirectory: posix
          .normalize(
            posix.join(request.workingDirectory, launch.workingDirectory),
          )
          .replace(/^\.$/u, ''),
      }));
    },
  );
  return [...imports, ...launches];
}

export function actionRuntimePaths(
  graph: ActionRuntimeGraph,
): readonly string[] {
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
    assertRunnableConfigurationBytes(source);
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
  const actionConfigurationGraph: ConfigurationScriptGraph = {
    executablePaths: new Set(),
    roots: pendingSources,
    sources: graph.sources,
    symlinkPaths: graph.symlinkPaths,
  };
  const actionConfigurationPaths = configurationScriptPaths(
    actionConfigurationGraph,
  );
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
        if (isRepositoryBackedPackageSpecifier(resolution)) {
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
  for (const path of actionConfigurationPaths) runtimePaths.add(path);
  return [...runtimePaths].sort();
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

test('only the Loom semantic adapter reaches the provider', async () => {
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
  const actionPaths = allPaths;
  const symlinkPaths = new Set(
    tracked.filter((file) => file.mode === '120000').map((file) => file.path),
  );
  const configPathSet = new Set(configPaths);
  const actionSources = new Map<string, string>();
  const unreadPaths = new Set<string>();
  for (const path of actionPaths) {
    const source =
      !symlinkPaths.has(path) &&
      (actionSourceRequiresContent(path) ||
        configPathSet.has(path) ||
        /(^|\/)tsconfig(?:\.[^/]*)?\.json$/u.test(path) ||
        /\.ya?ml$/u.test(path) ||
        CONFIGURATION_SCRIPT_EXTENSION.test(path))
        ? await Bun.file(join(REPOSITORY_ROOT, path)).text()
        : '';
    actionSources.set(path, source);
    if (source === '' && !symlinkPaths.has(path)) unreadPaths.add(path);
  }
  const actionGraph: ActionRuntimeGraph = {
    roots: configPaths.filter(isActionManifest),
    sources: actionSources,
    symlinkPaths,
  };
  const reachableActionPaths = actionRuntimePaths(actionGraph);
  const scriptGraph: ConfigurationScriptGraph = {
    executablePaths: new Set(
      tracked.filter((file) => file.mode === '100755').map((file) => file.path),
    ),
    roots: configPaths.filter((path) => path !== PROVIDER_PACKAGE),
    sources: actionSources,
    symlinkPaths,
  };
  const hydrationRequest = {
    discover: configurationScriptPaths,
    graph: scriptGraph,
    repositoryRoot: REPOSITORY_ROOT,
    sources: actionSources,
    unreadPaths,
  };
  const reachableScriptPaths =
    await configTestHelpers.hydrateRepositorySources(hydrationRequest);
  expect(
    await configTestHelpers.pathsContainingProviderRoot(productionPaths),
  ).toEqual([LOOM_ARTICLE_ADAPTER]);
  expect(
    await configTestHelpers.pathsContainingProviderRoot([
      ...configPaths,
      ...reachableActionPaths,
      ...reachableScriptPaths,
    ]),
  ).toEqual([PROVIDER_PACKAGE, LOOM_ARTICLE_ADAPTER].sort());
  const activeAudit = await Bun.file(
    join(REPOSITORY_ROOT, 'agentic-ai/loom/src/commands/cortex-audit.ts'),
  ).text();
  expect(activeAudit).toContain("'../lib/cortex-article-structure.ts'");
  expect(activeAudit).not.toContain('src/cortex-article-provider');
}, 15_000);
test('runnable configuration inventory includes Taskfiles and actions', () => {
  const taskfilePattern = /(^|\/)Taskfile(?:\.[^/]*)?\.ya?ml$/u;
  const allPaths = readTrackedRepositoryFiles(REPOSITORY_ROOT).map(
    (file) => file.path,
  );
  const runnablePaths = allPaths.filter(isRunnableConfiguration);
  const expected = allPaths.filter((path) => taskfilePattern.test(path)).sort();
  const discovered = runnablePaths
    .filter((path) => taskfilePattern.test(path))
    .sort();
  expect(discovered).toEqual(expected);
  expect(discovered.some((path) => path.includes('/'))).toBe(true);
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
    '.task/root.yml',
    '.task/nested/task.yaml',
    '.task/evil\n.yml',
    '.github/workflows/policy.yml',
    '.github/actions/action.yml',
    '.github/actions/nested/action.yaml',
    '.github/actions/evil\n/action.yml',
    'vite.config.ts',
    'nested/svelte.config.js',
    'scripts/audit/action.yml',
  ];
  const candidates = [
    ...expected,
    'package.json.backup',
    '.github/workflows/nested/policy.yml',
    '.github/actions/action.yml/child',
    '.github/actions/nested/not-action.yml',
    'nested/.task/task.yml',
    '.env.test',
    '.task/evil\n.yml/child',
    '.github/actions/evil\n/not-action.yml',
    '.github/actions/evil\n/action.yml/child',
    'nested/vite.config.css',
    'nested/svelte.config.css',
    'scripts/audit/not-action.yml',
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
  expect(() => actionRuntimePaths(providerGraph)).toThrow('runtime boundary');

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
    'Unauthorized application edge',
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
    'repository package import is unsupported',
  );

  const aliasSources = new Map(sources);
  aliasSources.set('.github/actions/nested/main', "import '#provider';");
  const aliasGraph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources: aliasSources,
    symlinkPaths: new Set<string>(),
  };
  expect(() => actionRuntimePaths(aliasGraph)).toThrow(
    'repository package import is unsupported',
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
      /(?:runtime boundary|Runnable script is untracked)/u,
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
      /(?:Action path|Runnable script) is a tracked symlink/u,
    );
  }
});

test('follows scripts launched from every runnable configuration surface', () => {
  for (const [path, source] of [
    ['package.json', '{"scripts":{"audit":"bun scripts/facade.ts"}}'],
    ['package.json', `{"scripts":{"audit":"bun ${LOOM_ARTICLE_ADAPTER}"}}`],
    ['Taskfile.yml', 'tasks:\n  audit:\n    cmds: [bun scripts/facade.ts]'],
    [
      'Taskfile.yml',
      `tasks:\n  audit:\n    cmds: [bun ${LOOM_ARTICLE_ADAPTER}]`,
    ],
    [
      '.github/workflows/audit.yml',
      'jobs:\n  audit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun scripts/facade.ts',
    ],
    [
      '.github/workflows/audit.yml',
      `jobs:\n  audit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun ${LOOM_ARTICLE_ADAPTER}`,
    ],
    [
      '.github/actions/audit/action.yml',
      'runs:\n  using: composite\n  steps:\n    - run: bun scripts/facade.ts\n      shell: bash',
    ],
    [
      '.github/actions/audit/action.yml',
      `runs:\n  using: composite\n  steps:\n    - run: bun ${LOOM_ARTICLE_ADAPTER}\n      shell: bash`,
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
    ]);
    const graph: ConfigurationScriptGraph = {
      executablePaths: new Set<string>(),
      roots: [path],
      sources,
      symlinkPaths: new Set<string>(),
    };
    expect(() => configurationScriptPaths(graph), path).toThrow(
      /Unauthorized application edge|runtime boundary/u,
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
    ['scripts/catalog.ts', "const evidencePath = 'scripts/unsafe.test.ts';"],
    ['scripts/unsafe.test.ts', 'eval(source);'],
  ]);
  const inertCatalogGraph: ConfigurationScriptGraph = {
    executablePaths: new Set<string>(),
    roots: ['package.json'],
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
    "import '../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/audit.ts';",
    "const root = '.cortex/teams/ai/' + 'dynamic-skills/cortex-article-structure/scripts'; await import(`${root}/src/audit.ts`);",
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
    expect(() => configurationScriptPaths(graph), externalSource).toThrow();
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
