import { expect, test } from 'bun:test';
import {
  actionRuntimePaths,
  configurationScriptPaths,
} from './skill-provider-config-boundary.test.ts';
import { normalizeConfigurationShellSource } from './skill-provider-config-runtime.ts';
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
  const sources = new Map([
    [
      'vite.config.ts',
      "const get = process['getBuiltinModule']; const {createRequire}=get('node:module'); createRequire(import.meta.url)('./scripts/facade.cjs');",
    ],
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
