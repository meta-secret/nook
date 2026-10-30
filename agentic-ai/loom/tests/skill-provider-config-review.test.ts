import { expect, test } from 'bun:test';
import { SkillProviderConfigBoundaryScenario } from './skill-provider-config-boundary.test.ts';
import { SkillProviderConfigRuntimeScenario } from './skill-provider-config-runtime.ts';
import { SkillProviderConfigTestHelpersScenario } from './skill-provider-config-test-helpers.ts';
import type { ConfigurationScriptGraph } from './skill-provider-executable-script.ts';
import type { ActionRuntimeGraph } from './skill-provider-config-types.ts';
import { SettledRejection } from './settled-rejection.ts';

const PROVIDER =
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/application.ts';

test('static Node eval cannot erase repository execution', async () => {
  expect(() =>
    SkillProviderConfigRuntimeScenario.normalizeConfigurationShellSource([
      `node -e "import('./scripts/facade.mjs')"`,
      'package.json',
    ]),
  ).toThrow('Node eval execution is forbidden');
  for (const source of [
    `node -e 'console.log("bounded")'`,
    "node --eval 'require(String.raw`./scripts/facade.cjs`)'",
    "node -e 'const load = require; load(`./scripts/facade.cjs`)'",
  ]) {
    expect(() =>
      SkillProviderConfigRuntimeScenario.normalizeConfigurationShellSource([
        source,
        'package.json',
      ]),
    ).toThrow('Node eval execution is forbidden');
  }
});

test('configuration roots receive the executable loader boundary', async () => {
  const sources = new Map([
    [
      'vite.config.ts',
      "import {createRequire} from 'node:module'; const load=createRequire(import.meta.url); load('./scripts/facade.cjs');",
    ],
    ['scripts/facade.cjs', `require('../${PROVIDER}');`],
    [PROVIDER, 'export {};'],
  ]);
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set(),
    roots: ['vite.config.ts'],
    sources,
    symlinkPaths: new Set(),
  };
  expect(
    await SettledRejection.message(
      SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
    ),
  ).toMatch('root violates runtime boundary');
});

test('configuration roots cannot recover ambient loader aliases', async () => {
  for (const source of [
    "const get = process['getBuiltinModule']; const {createRequire}=get('node:module'); createRequire(import.meta.url)('./scripts/facade.cjs');",
    "const target='./scripts/facade.cjs'; require(target);",
    "const load=require; const target='./scripts/facade.cjs'; load(target);",
  ]) {
    const sources = new Map([['vite.config.cjs', source]]);
    const graph: ConfigurationScriptGraph = {
      executablePaths: new Set(),
      roots: ['vite.config.cjs'],
      sources,
      symlinkPaths: new Set(),
    };
    expect(
      await SettledRejection.message(
        SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
      ),
      source,
    ).toMatch('root violates runtime boundary');
  }
});

test('configuration roots reject computed dynamic imports', async () => {
  const sources = new Map([
    [
      'vite.config.ts',
      "const target='./scripts/facade.ts'; await import(target);",
    ],
    ['scripts/facade.ts', `await import('../${PROVIDER}');`],
    [PROVIDER, 'export {};'],
  ]);
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set(),
    roots: ['vite.config.ts'],
    sources,
    symlinkPaths: new Set(),
  };
  expect(
    await SettledRejection.message(
      SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
    ),
  ).toMatch('root violates runtime boundary');
});

test('production hydration loads every statically reached shell target', async () => {
  const sources = new Map([
    ['package.json', '{"scripts":{"audit":"bash scripts/first.bash"}}'],
    ['scripts/first.bash', ''],
    ['scripts/second.command', ''],
    ['scripts/provider.ts', 'export {};'],
  ]);
  const unreadPaths = new Set(['scripts/first.bash', 'scripts/second.command']);
  const storedSources = new Map([
    ['scripts/first.bash', 'sh scripts/second.command'],
    ['scripts/second.command', 'bun scripts/provider.ts'],
  ]);
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set(),
    roots: ['package.json'],
    sources,
    symlinkPaths: new Set(),
  };
  const request = {
    discover: SkillProviderConfigBoundaryScenario.configurationScriptPaths,
    graph,
    // The hydration API owns this injected callback boundary; keep its
    // implementation limited to reading the fixture's already-admitted map.
    readSource: async (path: string): Promise<string> => {
      const source = storedSources.get(path);
      if (!source) throw new Error(`Unexpected source read: ${path}`);
      return source;
    },
    sources,
    unreadPaths,
  };
  expect(
    await SkillProviderConfigTestHelpersScenario.hydrateReachableSources(
      request,
    ),
  ).toContain('scripts/provider.ts');
  expect(unreadPaths).toEqual(new Set());
});

test('Node action subprocesses join the runnable configuration graph', async () => {
  const sources = new Map([
    [
      '.github/actions/example/action.yml',
      'runs: {using: node24, main: index.js}',
    ],
    [
      '.github/actions/example/index.js',
      "import {spawnSync} from 'node:child_process'; spawnSync('bun',['scripts/facade.ts']);",
    ],
    ['scripts/facade.ts', `await import('../${PROVIDER}');`],
    [PROVIDER, 'export {};'],
  ]);
  const graph: ActionRuntimeGraph = {
    roots: ['.github/actions/example/action.yml'],
    sources,
    symlinkPaths: new Set(),
  };
  expect(
    await SettledRejection.message(
      SkillProviderConfigBoundaryScenario.actionRuntimePaths(graph),
    ),
  ).toMatch(
    /(?:Unauthorized application edge|reaches provider|runtime boundary)/u,
  );
});

test('shell runtimes audit tracked scripts regardless of suffix', async () => {
  const sources = new Map([
    ['package.json', '{"scripts":{"audit":"bash scripts/facade.bash"}}'],
    ['scripts/facade.bash', `bun ${PROVIDER}`],
    [PROVIDER, 'export {};'],
  ]);
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set(),
    roots: ['package.json'],
    sources,
    symlinkPaths: new Set(),
  };
  expect(
    await SettledRejection.message(
      SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
    ),
  ).toMatch(/(?:reaches provider|runtime boundary)/u);
});

test('find command-executing predicates fail closed', async () => {
  for (const [runtime, predicate] of [
    ['find', '-exec'],
    ['/usr/bin/find', '-execdir'],
    ['/bin/find', '-ok'],
    ['./tools/find', '-okdir'],
  ]) {
    const sources = new Map([
      [
        'package.json',
        `{"scripts":{"audit":"${runtime} . ${predicate} bun scripts/facade.ts \\\\;"}}`,
      ],
    ]);
    const graph: ConfigurationScriptGraph = {
      executablePaths: new Set(),
      roots: ['package.json'],
      sources,
      symlinkPaths: new Set(),
    };
    expect(
      await SettledRejection.message(
        SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
      ),
      runtime,
    ).toMatch('Find command-executing predicate is forbidden');
  }
});

test('scalar Task preconditions join the runnable graph', async () => {
  const sources = new Map([
    [
      'Taskfile.yml',
      'tasks:\n  audit:\n    preconditions: [bun scripts/facade.ts]',
    ],
    ['scripts/facade.ts', `await import('../${PROVIDER}');`],
    [PROVIDER, 'export {};'],
  ]);
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set(),
    roots: ['Taskfile.yml'],
    sources,
    symlinkPaths: new Set(),
  };
  expect(
    await SettledRejection.message(
      SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
    ),
  ).toMatch(/(?:reaches provider|runtime boundary)/u);
});

test('nested Vite and Svelte roots preserve their runtime cwd', async () => {
  for (const root of ['nested/vite.config.ts', 'nested/svelte.config.js']) {
    const sources = new Map([
      [
        root,
        "import {spawnSync} from 'node:child_process'; spawnSync('bun',['scripts/facade.ts']);",
      ],
      ['scripts/facade.ts', 'export const safe = true;'],
      ['nested/scripts/facade.ts', `await import('../../${PROVIDER}');`],
      [PROVIDER, 'export {};'],
    ]);
    const graph: ConfigurationScriptGraph = {
      executablePaths: new Set(),
      roots: [root],
      sources,
      symlinkPaths: new Set(),
    };
    expect(
      await SettledRejection.message(
        SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
      ),
      root,
    ).toMatch(/(?:reaches provider|runtime boundary)/u);
  }
});

test('github-script module loads and subprocesses join the graph', async () => {
  for (const script of [
    'require(`${process.env.GITHUB_WORKSPACE}/scripts/facade.cjs`)',
    "const {execFileSync}=require('node:child_process'); execFileSync('bun',['scripts/facade.cjs']);",
  ]) {
    const workflow = `jobs:\n  audit:\n    steps:\n      - uses: actions/github-script@v9\n        with:\n          script: ${JSON.stringify(script)}`;
    const sources = new Map([
      ['.github/workflows/audit.yml', workflow],
      ['scripts/facade.cjs', `require('../${PROVIDER}');`],
      [PROVIDER, 'export {};'],
    ]);
    const graph: ConfigurationScriptGraph = {
      executablePaths: new Set(),
      roots: ['.github/workflows/audit.yml'],
      sources,
      symlinkPaths: new Set(),
    };
    expect(
      await SettledRejection.message(
        SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
      ),
      script,
    ).toMatch(/(?:reaches provider|runtime boundary)/u);
  }
});

test('github-script rejects dynamic module loading', async () => {
  const workflow = `jobs:\n  audit:\n    steps:\n      - uses: actions/github-script@v9\n        with:\n          script: require(modulePath)`;
  const sources = new Map([['.github/workflows/audit.yml', workflow]]);
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set(),
    roots: ['.github/workflows/audit.yml'],
    sources,
    symlinkPaths: new Set(),
  };
  expect(
    await SettledRejection.message(
      SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
    ),
  ).toMatch('Dynamic github-script module load is forbidden');
});
