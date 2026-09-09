import {
  SkillProviderConfigBoundaryScenario,
  CONFIGURATION_SCRIPT_EXTENSION,
  EXECUTABLE_SOURCE_EXTENSION,
} from './skill-provider-config-boundary.fixture.ts';
export { SkillProviderConfigBoundaryScenario } from './skill-provider-config-boundary.fixture.ts';
import { join } from 'node:path';

import { expect, test } from 'bun:test';

import { type ConfigurationScriptGraph } from './skill-provider-executable-script.ts';

import {
  CORTEX_AUDIT,
  LOOM_ARTICLE_ADAPTER,
  PROVIDER_APPLICATION,
  PROVIDER_ROOT,
  SkillProviderConfigApplicationScenario,
} from './skill-provider-config-application.ts';

import { SkillProviderConfigRuntimeScenario } from './skill-provider-config-runtime.ts';

import * as configTestHelpers from './skill-provider-config-test-helpers.ts';

import { ExecutableSkillRepository } from '../src/executable-skills/repository.ts';

import type {
  ActionLoaderFixture,
  ActionRuntimeGraph,
} from './skill-provider-config-types.ts';

const REPOSITORY_ROOT = join(import.meta.dir, '../../..');

test('only the Loom semantic adapter reaches the provider', async () => {
  const tracked = ExecutableSkillRepository.readTrackedFiles(REPOSITORY_ROOT);
  const allPaths = tracked.map((file) => file.path);
  const productionPaths = allPaths
    .filter((path) => path.startsWith('agentic-ai/loom/src/'))
    .filter((path) => EXECUTABLE_SOURCE_EXTENSION.test(path))
    .sort();
  expect(productionPaths).toContain('agentic-ai/loom/src/cli.ts');
  expect(productionPaths).toContain('agentic-ai/loom/src/cli-invocation.ts');
  expect(productionPaths).toContain('agentic-ai/loom/src/loom-failure.ts');
  const configPaths = allPaths.filter(
    SkillProviderConfigRuntimeScenario.isRunnableConfiguration,
  );
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
      (SkillProviderConfigRuntimeScenario.actionSourceRequiresContent(path) ||
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
    roots: configPaths.filter(
      SkillProviderConfigRuntimeScenario.isActionManifest,
    ),
    sources: actionSources,
    symlinkPaths,
  };
  const reachableActionPaths =
    SkillProviderConfigBoundaryScenario.actionRuntimePaths(actionGraph);
  const scriptGraph: ConfigurationScriptGraph = {
    executablePaths: new Set(
      tracked.filter((file) => file.mode === '100755').map((file) => file.path),
    ),
    roots: configPaths.filter(
      (path) =>
        !SkillProviderConfigApplicationScenario.isConfigurationProviderPackage(
          path,
        ),
    ),
    sources: actionSources,
    symlinkPaths,
  };
  const hydrationRequest = {
    discover: SkillProviderConfigBoundaryScenario.configurationScriptPaths,
    graph: scriptGraph,
    repositoryRoot: REPOSITORY_ROOT,
    sources: actionSources,
    unreadPaths,
  };
  const reachableScriptPaths =
    await configTestHelpers.SkillProviderConfigTestHelpersScenario.hydrateRepositorySources(
      hydrationRequest,
    );
  expect(
    await configTestHelpers.SkillProviderConfigTestHelpersScenario.pathsContainingProviderRoot(
      productionPaths,
    ),
  ).toEqual([LOOM_ARTICLE_ADAPTER]);
  const providerReferences =
    await configTestHelpers.SkillProviderConfigTestHelpersScenario.pathsContainingProviderRoot(
      [...configPaths, ...reachableActionPaths, ...reachableScriptPaths],
    );
  expect([...new Set(providerReferences)].sort()).toEqual(
    SkillProviderConfigApplicationScenario.expectedProviderReferences(allPaths),
  );
  const activeAudit = await Bun.file(
    join(REPOSITORY_ROOT, 'agentic-ai/loom/src/commands/cortex-audit.ts'),
  ).text();
  expect(activeAudit).toContain("'../lib/cortex-article-structure.ts'");
  expect(activeAudit).not.toContain('src/cortex-article-provider');
}, 15_000);

test('runnable configuration inventory includes Taskfiles and actions', () => {
  const taskfilePattern = /(^|\/)Taskfile(?:\.[^/]*)?\.ya?ml$/u;
  const allPaths = ExecutableSkillRepository.readTrackedFiles(
    REPOSITORY_ROOT,
  ).map((file) => file.path);
  const runnablePaths = allPaths.filter(
    SkillProviderConfigRuntimeScenario.isRunnableConfiguration,
  );
  const expected = allPaths.filter((path) => taskfilePattern.test(path)).sort();
  const discovered = runnablePaths
    .filter((path) => taskfilePattern.test(path))
    .sort();
  expect(discovered).toEqual(expected);
  expect(discovered.some((path) => path.includes('/'))).toBe(true);
  const expectedActions = allPaths
    .filter((path) => path.startsWith('.github/actions/'))
    .filter(SkillProviderConfigRuntimeScenario.isActionManifest)
    .sort();
  const discoveredActions = runnablePaths
    .filter(SkillProviderConfigRuntimeScenario.isActionManifest)
    .sort();
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
  expect(
    candidates.filter(
      SkillProviderConfigRuntimeScenario.isRunnableConfiguration,
    ),
  ).toEqual(expected);
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
  expect(
    SkillProviderConfigRuntimeScenario.actionSourceRequiresContent(
      '.github/actions/nested/main',
    ),
  ).toBe(true);
  expect(SkillProviderConfigBoundaryScenario.actionRuntimePaths(graph)).toEqual(
    [
      '.github/actions/nested/action.yaml',
      '.github/actions/nested/main',
      '.github/actions/nested/neutral.js',
      '.github/actions/nested/post.js',
      '.github/actions/nested/pre.js',
      '.github/actions/root/action.yml',
    ],
  );

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
  expect(() =>
    SkillProviderConfigBoundaryScenario.actionRuntimePaths(providerGraph),
  ).toThrow('runtime boundary');

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
  expect(() =>
    SkillProviderConfigBoundaryScenario.actionRuntimePaths(adapterGraph),
  ).toThrow('Unauthorized application edge');

  const unresolvedSources = new Map(sources);
  unresolvedSources.delete('.github/actions/nested/main');
  const unresolvedGraph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources: unresolvedSources,
    symlinkPaths: new Set<string>(),
  };
  expect(() =>
    SkillProviderConfigBoundaryScenario.actionRuntimePaths(unresolvedGraph),
  ).toThrow('Action entrypoint is untracked');

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
  expect(() =>
    SkillProviderConfigBoundaryScenario.actionRuntimePaths(
      unresolvedImportGraph,
    ),
  ).toThrow('Action relative import is unresolved');

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
  expect(() =>
    SkillProviderConfigBoundaryScenario.actionRuntimePaths(dockerGraph),
  ).toThrow('Unsupported Docker action runtime');

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
  expect(() =>
    SkillProviderConfigBoundaryScenario.actionRuntimePaths(dockerStepGraph),
  ).toThrow('Unsupported Docker action step');

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
  expect(() =>
    SkillProviderConfigBoundaryScenario.actionRuntimePaths(packageGraph),
  ).toThrow('repository package import is unsupported');

  const aliasSources = new Map(sources);
  aliasSources.set('.github/actions/nested/main', "import '#provider';");
  const aliasGraph: ActionRuntimeGraph = {
    roots: ['.github/actions/root/action.yml'],
    sources: aliasSources,
    symlinkPaths: new Set<string>(),
  };
  expect(() =>
    SkillProviderConfigBoundaryScenario.actionRuntimePaths(aliasGraph),
  ).toThrow('repository package import is unsupported');

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
    expect(
      () => SkillProviderConfigBoundaryScenario.actionRuntimePaths(loaderGraph),
      fixture.path,
    ).toThrow(/(?:runtime boundary|Runnable script is untracked)/u);
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
    expect(
      () =>
        SkillProviderConfigBoundaryScenario.actionRuntimePaths(symlinkGraph),
      path,
    ).toThrow(/(?:Action path|Runnable script) is a tracked symlink/u);
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
    expect(
      () => SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
      path,
    ).toThrow(/Unauthorized application edge|runtime boundary/u);
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
  expect(() =>
    SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
  ).toThrow('Runnable script is untracked');

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
  expect(
    SkillProviderConfigBoundaryScenario.configurationScriptPaths(
      inertCatalogGraph,
    ),
  ).toEqual(['scripts/catalog.ts']);
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
  expect(() =>
    SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
  ).toThrow('Article adapter violates boundary');
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
    expect(
      () => SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
      externalSource,
    ).toThrow();
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
  expect(() =>
    SkillProviderConfigBoundaryScenario.configurationScriptPaths(
      executableGraph,
    ),
  ).toThrow('Runnable script violates runtime boundary');
  const nonExecutableGraph: ConfigurationScriptGraph = {
    executablePaths: new Set<string>(),
    roots: ['Taskfile.yml'],
    sources: extensionlessSources,
    symlinkPaths: new Set<string>(),
  };
  expect(
    SkillProviderConfigBoundaryScenario.configurationScriptPaths(
      nonExecutableGraph,
    ),
  ).toEqual([]);
});
