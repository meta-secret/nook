import { expect, test } from 'bun:test';
import { analyzeShellCommands } from './skill-provider-command-boundary.ts';
import {
  actionRuntimePaths,
  configurationScriptPaths,
} from './skill-provider-config-boundary.test.ts';
import { runnableCommandSources } from './skill-provider-config-commands.ts';
import { commandConfigurationReferences } from './skill-provider-eslint-config.ts';
import {
  isActionManifest,
  isRunnableConfiguration,
  normalizeConfigurationShellSource,
} from './skill-provider-config-runtime.ts';
import type { ConfigurationScriptGraph } from './skill-provider-executable-script.ts';
import type { ActionRuntimeGraph } from './skill-provider-config-types.ts';

const PROVIDER_ROOT = '.cortex/teams/ai/dynamic-skills/example/scripts/src';
const PROVIDER_CLI = `${PROVIDER_ROOT}/cli.ts`;

type GraphRequest = {
  readonly roots: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
};

function graph(request: GraphRequest): ConfigurationScriptGraph {
  return {
    executablePaths: new Set(),
    roots: request.roots,
    sources: request.sources,
    symlinkPaths: new Set(),
  };
}

function expectProviderReachable(candidate: ConfigurationScriptGraph): void {
  expect(configurationScriptPaths(candidate)).toContain(PROVIDER_CLI);
}

test('nested package scripts resolve relative to their package first', () => {
  const sources = new Map([
    ['nested/package.json', '{"scripts":{"audit":"bun scripts/a.ts"}}'],
    ['scripts/a.ts', 'export {};'],
    ['nested/scripts/a.ts', `await import('${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['nested/package.json'], sources };
  expectProviderReachable(graph(request));
});

test('Vite configs are runnable roots', () => {
  expect(isRunnableConfiguration('nested/vite.config.ts')).toBe(true);
  expect(isRunnableConfiguration('nested/vite.config.mjs')).toBe(true);
  const vite = 'nested/vite.config.ts';
  const sources = new Map([
    [vite, `await import('${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: [vite], sources };
  expectProviderReachable(graph(request));
});

test('global Task vars and env shell values remain executable', () => {
  const source = `
vars:
  GENERATED: {sh: bun ${PROVIDER_CLI}}
env:
  CHECKED: {sh: bun ${PROVIDER_CLI}}
  ROOT: ${PROVIDER_ROOT}
tasks:
  audit:
    cmds: [bun "$ROOT/cli.ts"]
`;
  const commandInspection = {
    path: 'Taskfile.yml',
    source,
  };
  const launches = runnableCommandSources(commandInspection).flatMap(
    (command) => {
      const shellInspection = {
        positionalArguments: false,
        source: command,
        sourcePath: 'Taskfile.yml',
      } as const;
      return analyzeShellCommands(shellInspection).launches;
    },
  );
  expect(launches.map((launch) => launch.specifier)).toEqual([
    PROVIDER_CLI,
    PROVIDER_CLI,
    PROVIDER_CLI,
  ]);
});

test('argv-driven TypeScript loaders are checked fail-closed', () => {
  const sources = new Map([
    [
      'Taskfile.yml',
      `tasks: {audit: {cmds: [bun scripts/loader.ts ${PROVIDER_CLI}]}}`,
    ],
    ['scripts/loader.ts', 'await import(process.argv[2]);'],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['Taskfile.yml'], sources };
  expectProviderReachable(graph(request));
});

test('Task includes with arbitrary filenames join the runnable graph', () => {
  const included = 'infra/tasks/custom.yml';
  const sources = new Map([
    ['infra/Taskfile.yml', `includes: {custom: {taskfile: tasks/custom.yml}}`],
    [included, `tasks: {audit: {cmds: [bun ${PROVIDER_CLI}]}}`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['infra/Taskfile.yml'], sources };
  expectProviderReachable(graph(request));
});

test('explicit Taskfile selections join the runnable graph', () => {
  for (const command of [
    'task -t scripts/commands.yml audit',
    'task --taskfile scripts/commands.yml audit',
    'task -t=scripts/commands.yml audit',
    'go-task --taskfile=scripts/commands.yml audit',
    'command task --taskfile scripts/commands.yml audit',
    'exec task -t scripts/commands.yml audit',
    'env SAFE=1 command task --taskfile=scripts/commands.yml audit',
  ]) {
    const sources = new Map([
      ['package.json', `{"scripts":{"audit":"${command}"}}`],
      ['scripts/commands.yml', `tasks: {audit: {cmds: [bun ${PROVIDER_CLI}]}}`],
      [PROVIDER_CLI, 'export {};'],
    ]);
    const request = { roots: ['package.json'], sources };
    expectProviderReachable(graph(request));
  }
});

test('repository explicit Taskfile selection preserves relative cwd', () => {
  const repositorySelectionRequest = {
    commands: ['task --taskfile agentic-ai/minds/hive/Taskfile.yml format'],
    importer: '.task/agentic-ai.yml',
    sources: new Map<string, string>(),
    workingDirectory: '',
  };
  expect(commandConfigurationReferences(repositorySelectionRequest)).toEqual([
    {
      importerRelative: true,
      positionalArguments: false,
      required: true,
      requiresExecuteMode: false,
      shellRuntime: false,
      specifier: '../agentic-ai/minds/hive/Taskfile.yml',
      taskInclude: true,
      workingDirectory: '',
    },
  ]);
  const sources = new Map([
    [
      'package.json',
      '{"scripts":{"audit":"cd nested && task --taskfile ../scripts/commands.yml audit"}}',
    ],
    ['scripts/commands.yml', 'tasks: {audit: {cmds: [bun scripts/facade.ts]}}'],
    ['scripts/facade.ts', 'export const safe = true;'],
    ['nested/scripts/facade.ts', `await import('../../${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const collisionRequest = { roots: ['package.json'], sources };
  expectProviderReachable(graph(collisionRequest));
});

test('dynamic and malformed Taskfile selections fail closed', () => {
  for (const command of [
    'task --taskfile "$TASKFILE" audit',
    'task "$OPTION" scripts/commands.yml audit',
    'task --taskfile audit',
    'task --taskfile= audit',
    'task -t scripts/a.yml --taskfile scripts/b.yml audit',
    'task --taskfile ../../outside.yml audit',
    'command "$RUNTIME" --taskfile scripts/commands.yml audit',
    '"$WRAPPER" task --taskfile scripts/commands.yml audit',
  ]) {
    const sources = new Map([
      ['package.json', `{"scripts":{"audit":${JSON.stringify(command)}}}`],
    ]);
    const request = { roots: ['package.json'], sources };
    expect(() => configurationScriptPaths(graph(request)), command).toThrow();
  }
});

test('module-flavor imports resolve to tracked TypeScript sources', () => {
  for (const [specifier, dependency] of [
    ['./facade.mjs', 'scripts/facade.mts'],
    ['./facade.cjs', 'scripts/facade.cts'],
  ] as const) {
    const sources = new Map([
      ['scripts/vite.config.ts', `await import('${specifier}');`],
      [dependency, `await import('../${PROVIDER_CLI}');`],
      [PROVIDER_CLI, 'export {};'],
    ]);
    const request = { roots: ['scripts/vite.config.ts'], sources };
    expectProviderReachable(graph(request));
  }
});

test('tracked local actions are roots outside the conventional directory', () => {
  const manifest = 'scripts/audit-action/action.yml';
  const entrypoint = 'scripts/audit-action/index.js';
  const sources = new Map([
    [
      '.github/workflows/audit.yml',
      'jobs: {audit: {steps: [{uses: ./scripts/audit-action}]}}',
    ],
    [manifest, 'runs: {using: node24, main: index.js}'],
    [entrypoint, `await import('../../${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const roots = [...sources.keys()].filter(isRunnableConfiguration);
  expect(roots).toContain(manifest);
  const actionGraph: ActionRuntimeGraph = {
    roots: roots.filter(isActionManifest),
    sources,
    symlinkPaths: new Set(),
  };
  expect(actionRuntimePaths(actionGraph)).toContain(PROVIDER_CLI);

  const symlinkGraph: ActionRuntimeGraph = {
    ...actionGraph,
    symlinkPaths: new Set([manifest]),
  };
  expect(() => actionRuntimePaths(symlinkGraph)).toThrow('tracked symlink');
  const untrackedGraph: ActionRuntimeGraph = {
    ...actionGraph,
    sources: new Map([[manifest, 'runs: {using: node24, main: missing.js}']]),
  };
  expect(() => actionRuntimePaths(untrackedGraph)).toThrow(
    'entrypoint is untracked',
  );
});

test('workflow env precedence is propagated into run analysis', () => {
  const workflow = '.github/workflows/audit.yml';
  const sources = new Map([
    [
      workflow,
      `env: {ROOT: safe}\njobs: {audit: {env: {ROOT: ${PROVIDER_ROOT}}, steps: [{env: {UNUSED: value}, run: 'bun "$ROOT/cli.ts"'}]}}`,
    ],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: [workflow], sources };
  expectProviderReachable(graph(request));
});

test('extensionless TypeScript imports are resolved before optional pruning', () => {
  for (const [specifier, dependency] of [
    ['./nested', 'scripts/nested.ts'],
    ['./directory', 'scripts/directory/index.js'],
  ] as const) {
    const sources = new Map([
      ['package.json', '{"scripts":{"audit":"bun scripts/loader.ts"}}'],
      ['scripts/loader.ts', `import '${specifier}';`],
      [specifier === './nested' ? 'scripts/nested' : 'scripts/directory', ''],
      [dependency, `await import('${PROVIDER_CLI}');`],
      [PROVIDER_CLI, 'export {};'],
    ]);
    const request = { roots: ['package.json'], sources };
    expectProviderReachable(graph(request));
  }
});

test('runtime-launched extensionless files do not require execute mode', () => {
  for (const runtime of ['bun', 'node']) {
    const sources = new Map([
      ['package.json', `{"scripts":{"audit":"${runtime} scripts/loader"}}`],
      ['scripts/loader', `await import('../${PROVIDER_CLI}');`],
      [PROVIDER_CLI, 'export {};'],
    ]);
    const request = { roots: ['package.json'], sources };
    expectProviderReachable(graph(request));
  }
});

test('workflow and composite custom shells fail closed', () => {
  for (const [path, source] of [
    [
      '.github/workflows/default.yml',
      'defaults: {run: {shell: scripts/runner {0}}}\njobs: {audit: {steps: [{run: echo safe}]}}',
    ],
    [
      '.github/workflows/step.yml',
      'jobs: {audit: {steps: [{shell: "${{ matrix.shell }}", run: echo safe}]}}',
    ],
    [
      '.github/actions/audit/action.yml',
      'runs: {using: composite, steps: [{shell: scripts/runner {0}, run: echo safe}]}',
    ],
  ] as const) {
    const inspection = { path, source };
    expect(() => runnableCommandSources(inspection), path).toThrow(
      /(?:Custom|Dynamic) workflow shell is forbidden/u,
    );
  }
});

test('nested package commands select the nearest implicit ESLint config', () => {
  const sources = new Map([
    ['nested/package.json', '{"scripts":{"lint":"eslint src"}}'],
    ['eslint.config.js', 'export const rootDecoy = true;'],
    ['nested/eslint.config.js', `await import('../${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['nested/package.json'], sources };
  expectProviderReachable(graph(request));
});

test('explicit ESLint config selection follows package-command cd', () => {
  const sources = new Map([
    [
      'nested/package.json',
      '{"scripts":{"lint":"cd .. && node_modules/.bin/eslint --config config/eslint.cjs src"}}',
    ],
    ['nested/eslint.config.js', 'export const nestedDecoy = true;'],
    ['config/eslint.cjs', `await import('../${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['nested/package.json'], sources };
  expectProviderReachable(graph(request));
});

test('ESLint no-config-lookup suppresses implicit config execution', () => {
  const sources = new Map([
    [
      'nested/package.json',
      '{"scripts":{"lint":"eslint --no-config-lookup src"}}',
    ],
    ['nested/eslint.config.js', `await import('../${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['nested/package.json'], sources };
  expect(configurationScriptPaths(graph(request))).not.toContain(PROVIDER_CLI);
});

test('dynamic ESLint config selection fails closed', () => {
  const sources = new Map([
    [
      'package.json',
      '{"scripts":{"lint":"eslint --config \\"$CONFIG\\" src"}}',
    ],
  ]);
  const request = { roots: ['package.json'], sources };
  expect(() => configurationScriptPaths(graph(request))).toThrow(
    'Dynamic ESLint configuration selection',
  );
});

test('wrapped Playwright commands select the nearest implicit config', () => {
  const sources = new Map([
    ['nested/package.json', '{"scripts":{"test:e2e":"npx playwright test"}}'],
    ['playwright.config.ts', 'export const rootDecoy = true;'],
    ['nested/playwright.config.mts', `await import('../${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['nested/package.json'], sources };
  expectProviderReachable(graph(request));
});

test('explicit Playwright config forms follow package-command cd', () => {
  for (const command of [
    'cd .. && bunx playwright test --config config/playwright.cjs',
    'cd .. && npx playwright test --config=config/playwright.cjs',
    'cd .. && playwright test -c config/playwright.cjs',
  ]) {
    const sources = new Map([
      ['nested/package.json', `{"scripts":{"test:e2e":"${command}"}}`],
      ['nested/playwright.config.ts', 'export const nestedDecoy = true;'],
      ['config/playwright.cjs', `await import('../${PROVIDER_CLI}');`],
      [PROVIDER_CLI, 'export {};'],
    ]);
    const request = { roots: ['nested/package.json'], sources };
    expectProviderReachable(graph(request));
  }
});

test('dynamic Playwright config selection fails closed', () => {
  const sources = new Map([
    [
      'package.json',
      '{"scripts":{"test:e2e":"npx playwright test --config \\"$CONFIG\\""}}',
    ],
  ]);
  const request = { roots: ['package.json'], sources };
  expect(() => configurationScriptPaths(graph(request))).toThrow(
    'Dynamic Playwright configuration selection',
  );
});

test('ESLint no-config-lookup does not suppress Playwright config lookup', () => {
  const sources = new Map([
    [
      'nested/package.json',
      '{"scripts":{"test:e2e":"playwright test --no-config-lookup"}}',
    ],
    ['nested/playwright.config.cts', `await import('../${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['nested/package.json'], sources };
  expectProviderReachable(graph(request));
});

test('complex Task templates cannot hide executable entrypoints', () => {
  const sources = new Map([
    [
      'Taskfile.yml',
      `vars:
  ROOT: scripts
  TARGET: '{{default (printf "%s/facade.ts" .ROOT) .TARGET}}'
tasks:
  audit:
    cmds: ['bun {{.TARGET}}']`,
    ],
    ['scripts/facade.ts', `await import('../${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['Taskfile.yml'], sources };
  expect(() => configurationScriptPaths(graph(request))).toThrow(
    /(?:Dynamic bun executable construction|Shell expansion in an executable)/u,
  );
});

test('supported static Task templates reach executable providers', () => {
  const sources = new Map([
    [
      'Taskfile.yml',
      `vars: {TARGET: scripts/facade.ts}
tasks: {audit: {cmds: ['bun {{.TARGET}}']}}`,
    ],
    ['scripts/facade.ts', `await import('../${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['Taskfile.yml'], sources };
  expectProviderReachable(graph(request));
});

test('unresolved Task arguments do not hide a known executable entrypoint', () => {
  const sources = new Map([
    [
      'Taskfile.yml',
      `tasks: {audit: {cmds: ['bun scripts/facade.ts "{{.REQUEST}}"']}}`,
    ],
    ['scripts/facade.ts', `await import('../${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['Taskfile.yml'], sources };
  expectProviderReachable(graph(request));
});

test('repository-backed bare package imports fail closed', () => {
  const sources = new Map([
    ['package.json', '{"scripts":{"audit":"bun scripts/config.ts"}}'],
    ['scripts/config.ts', "import 'workspace-helper';"],
    ['packages/helper/package.json', '{"name":"workspace-helper"}'],
    ['packages/helper/index.ts', `await import('../../${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['package.json'], sources };
  expect(() => configurationScriptPaths(graph(request))).toThrow(
    'Runnable repository package import is unsupported',
  );
});

test('AGENT_EOF exemptions reject wrong provenance and content', () => {
  const source = 'delim="AGENT_EOF_123"; payload="safe"';
  for (const path of [
    '.github/workflows/not-agent-implement.yml',
    '.github/workflows/agent-implement.yml',
  ])
    expect(
      () => normalizeConfigurationShellSource([source, path]),
      path,
    ).toThrow('Unaudited AGENT_EOF shell exemption');
});

test('successor launches preserve package cwd through child-process cd', () => {
  const sources = new Map([
    ['nested/package.json', '{"scripts":{"audit":"bun config/loader.ts"}}'],
    [
      'nested/config/loader.ts',
      "import {execSync} from 'node:child_process'; execSync('cd child && bun scripts/facade.ts');",
    ],
    ['scripts/facade.ts', 'export const rootDecoy = true;'],
    ['nested/config/scripts/facade.ts', 'export const importerDecoy = true;'],
    [
      'nested/child/scripts/facade.ts',
      "import {spawnSync} from 'node:child_process'; spawnSync('bun',['provider-loader.ts']);",
    ],
    ['provider-loader.ts', 'export const rootDecoy = true;'],
    ['nested/provider-loader.ts', 'export const packageDecoy = true;'],
    [
      'nested/child/provider-loader.ts',
      `await import('../../${PROVIDER_CLI}');`,
    ],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['nested/package.json'], sources };
  expectProviderReachable(graph(request));
});

test('CommonJS helpers contribute subprocess successors', () => {
  const sources = new Map([
    ['package.json', '{"scripts":{"audit":"bun scripts/loader.cjs"}}'],
    [
      'scripts/loader.cjs',
      "const {spawnSync}=require('node:child_process'); spawnSync('bun',['scripts/facade.ts']);",
    ],
    ['scripts/facade.ts', `await import('../${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['package.json'], sources };
  expectProviderReachable(graph(request));
});
