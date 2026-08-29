import { expect, test } from 'bun:test';
import {
  actionRuntimePaths,
  configurationScriptPaths,
} from './skill-provider-config-boundary.test.ts';
import { normalizeConfigurationShellSource } from './skill-provider-config-runtime.ts';
import { hydrateReachableSources } from './skill-provider-config-test-helpers.ts';
import type { ConfigurationScriptGraph } from './skill-provider-executable-script.ts';
import type { ActionRuntimeGraph } from './skill-provider-config-types.ts';

const PROVIDER =
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/application.ts';

test('static Node eval cannot erase repository execution', () => {
  expect(() =>
    normalizeConfigurationShellSource([
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
      normalizeConfigurationShellSource([source, 'package.json']),
    ).toThrow('Node eval execution is forbidden');
  }
});

test('configuration roots receive the executable loader boundary', () => {
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
  expect(() => configurationScriptPaths(graph)).toThrow(
    'root violates runtime boundary',
  );
});

test('configuration roots cannot recover ambient loader aliases', () => {
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
    expect(() => configurationScriptPaths(graph), source).toThrow(
      'root violates runtime boundary',
    );
  }
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
  const readSource = async (path: string): Promise<string> => {
    const source = storedSources.get(path);
    if (!source) throw new Error(`Unexpected source read: ${path}`);
    return source;
  };
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set(),
    roots: ['package.json'],
    sources,
    symlinkPaths: new Set(),
  };
  const request = {
    discover: configurationScriptPaths,
    graph,
    readSource,
    sources,
    unreadPaths,
  };
  expect(await hydrateReachableSources(request)).toContain(
    'scripts/provider.ts',
  );
  expect(unreadPaths).toEqual(new Set());
});

test('Node action subprocesses join the runnable configuration graph', () => {
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
  expect(() => actionRuntimePaths(graph)).toThrow(
    /(?:Unauthorized application edge|reaches provider|runtime boundary)/u,
  );
});

test('shell runtimes audit tracked scripts regardless of suffix', () => {
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
  expect(() => configurationScriptPaths(graph)).toThrow(
    /(?:reaches provider|runtime boundary)/u,
  );
});

test('find command-executing predicates fail closed', () => {
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
    expect(() => configurationScriptPaths(graph), runtime).toThrow(
      'Find command-executing predicate is forbidden',
    );
  }
});

test('scalar Task preconditions join the runnable graph', () => {
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
  expect(() => configurationScriptPaths(graph)).toThrow(
    /(?:reaches provider|runtime boundary)/u,
  );
});

test('nested Vite and Svelte roots preserve their runtime cwd', () => {
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
    expect(() => configurationScriptPaths(graph), root).toThrow(
      /(?:reaches provider|runtime boundary)/u,
    );
  }
});

test('github-script module loads and subprocesses join the graph', () => {
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
    expect(() => configurationScriptPaths(graph), script).toThrow(
      /(?:reaches provider|runtime boundary)/u,
    );
  }
});

test('github-script rejects dynamic module loading', () => {
  const workflow = `jobs:\n  audit:\n    steps:\n      - uses: actions/github-script@v9\n        with:\n          script: require(modulePath)`;
  const sources = new Map([['.github/workflows/audit.yml', workflow]]);
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set(),
    roots: ['.github/workflows/audit.yml'],
    sources,
    symlinkPaths: new Set(),
  };
  expect(() => configurationScriptPaths(graph)).toThrow(
    'Dynamic github-script module load is forbidden',
  );
});
