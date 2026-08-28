import { expect, test } from 'bun:test';
import { configurationScriptPaths } from './skill-provider-config-boundary.test.ts';
import type { ConfigurationScriptGraph } from './skill-provider-executable-script.ts';
import {
  SKILL_HOST_CLI,
  SKILL_HOST_REGISTRY,
  SKILL_HOST_TASK,
  SKILL_PROVIDER_APPLICATION,
  SKILL_PROVIDER_ACTION,
  SKILL_PROVIDER_CODEC,
  SKILL_PROVIDER_DOMAIN,
} from './skill-consumer-boundary.ts';
const HOST_SOURCES = new Map<string, string>([
  [
    SKILL_HOST_CLI,
    await Bun.file(`${import.meta.dir}/../../../${SKILL_HOST_CLI}`).text(),
  ],
  [
    SKILL_HOST_REGISTRY,
    await Bun.file(`${import.meta.dir}/../../../${SKILL_HOST_REGISTRY}`).text(),
  ],
  [SKILL_PROVIDER_APPLICATION, 'export const application = true;'],
  [SKILL_PROVIDER_CODEC, 'export const codec = true;'],
  [SKILL_PROVIDER_DOMAIN, 'export const domain = true;'],
  ['scripts/alternate.ts', `import '../${SKILL_HOST_REGISTRY}';`],
]);
const HOST_INTERNAL_NAMES = [
  'skill-cli-invocation.ts',
  'skill-command-domain.ts',
  'skill-command-path.ts',
  'skill-schema-validator.ts',
  'skill-yaml-codec.ts',
] as const;
for (const name of HOST_INTERNAL_NAMES) {
  const path = SKILL_HOST_CLI.replace('cli.ts', name);
  HOST_SOURCES.set(
    path,
    await Bun.file(`${import.meta.dir}/../../../${path}`).text(),
  );
}
HOST_SOURCES.set(SKILL_PROVIDER_ACTION, 'export const action = true;');
const CANONICAL_TASK_SOURCE = `tasks: {skills:run: {desc: "Run one executable skill action from a domain YAML request (CONFIG=<request.yaml>).", deps: [skills:install], requires: {vars: [CONFIG]}, env: {NOOK_SKILL_CONFIG: "{{.CONFIG}}"}, cmds: ['bun ${SKILL_HOST_CLI} "$NOOK_SKILL_CONFIG"']}, skills:tools-list: {desc: "List executable skill actions, YAML examples, and request schemas.", deps: [skills:install], cmds: [bun ${SKILL_HOST_CLI} --default toolsList]}}`;
type HostGraphRequest = { readonly root: string; readonly source: string };
function graph(request: HostGraphRequest): ConfigurationScriptGraph {
  const sources = new Map(HOST_SOURCES);
  sources.set(request.root, request.source);
  return {
    executablePaths: new Set<string>(),
    roots: [request.root],
    sources,
    symlinkPaths: new Set<string>(),
  };
}
test('admits only the canonical Task to CLI to registry chain', () => {
  const request: HostGraphRequest = {
    root: SKILL_HOST_TASK,
    source: CANONICAL_TASK_SOURCE,
  };
  const fixture = graph(request);
  expect(configurationScriptPaths(fixture)).toEqual([
    SKILL_HOST_CLI,
    SKILL_HOST_REGISTRY,
    ...HOST_INTERNAL_NAMES.map((name) =>
      SKILL_HOST_CLI.replace('cli.ts', name),
    ),
  ]);
  const sources = new Map(fixture.sources);
  sources.set(SKILL_HOST_CLI, "fetch('x')");
  const dangerousGraph: ConfigurationScriptGraph = { ...fixture, sources };
  expect(() => configurationScriptPaths(dangerousGraph)).toThrow();
});
test('rejects alternate launchers and Task path semantics', () => {
  for (const [root, source] of [
    ['package.json', `{"scripts":{"run":"bun ${SKILL_HOST_CLI}"}}`],
    ['Taskfile.yml', `tasks: {run: {cmds: [bun ${SKILL_HOST_REGISTRY}]}}`],
    ...[
      'bun cli.ts], dir: .cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts',
      'bun --cwd .cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts cli.ts]',
      'bun --cwd=.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts cli.ts]',
      'bun --cwd=".cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts" cli.ts]',
    ].map(
      (command) =>
        ['Taskfile.yml', `tasks: {run: {cmds: [${command}}}`] as const,
    ),
    [
      'Taskfile.yml',
      `tasks:\n  run:\n    cmds: [bun "{{.REPO_ROOT}}/${SKILL_HOST_CLI}"]`,
    ],
    [
      'Taskfile.yml',
      'vars: {SKILLS_DIR: .cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts}\ntasks:\n  run:\n    cmds: [bun "{{.SKILLS_DIR}}/cli.ts"]',
    ],
    [
      'Taskfile.yml',
      'tasks:\n  run:\n    cmds: [bun "{{.UNKNOWN_DIR}}/cli.ts"]',
    ],
    ['package.json', '{"scripts":{"run":"bun scripts/alternate.ts"}}'],
    ...[
      'tasks: {alternate: {cmds: [task skills:run]}}',
      'tasks: {alternate: {deps: [skills:run]}}',
      'tasks: {alternate: {cmds: [{task: skills:run}]}}',
      'tasks: {alternate: {deps: [{task: skills:run}]}}',
      `tasks: {alternate: {env: {HOST: "bun ${SKILL_HOST_CLI}"}, cmds: ["$HOST"]}}`,
      `tasks: {alternate: {vars: {HOST: "bun ${SKILL_HOST_CLI}"}, cmds: ["{{.HOST}}"]}}`,
      'tasks: {alternate: {vars: {TARGET: skills:run}, cmds: [task "{{.TARGET}}"]}}',
      `"tasks": {alternate: {cmds: [bun ${SKILL_HOST_CLI}]}}`,
      `tasks : {alternate: {cmds: [bun ${SKILL_HOST_CLI}]}}`,
      'vars: {host2: .cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts}\ntasks: {alternate: {cmds: [bun "{{.host2}}/cli.ts"]}}',
      `vars: {host2: ${SKILL_HOST_CLI}}\ntasks: {alternate: {cmds: [bun "{{.host2 | quote}}"]}}`,
    ].map((taskfile) => [SKILL_HOST_TASK, taskfile] as const),
    ...['cmds', 'status', 'preconditions', 'vars'].map(
      (field) =>
        [
          SKILL_HOST_TASK,
          `tasks:\n  alternate:\n    ${field}: ${field === 'vars' ? `{HOST: {sh: "bun ${SKILL_HOST_CLI}"}}` : `[bun ${SKILL_HOST_CLI}]`}`,
        ] as const,
    ),
    [
      SKILL_HOST_TASK,
      `vars: {HOST: {sh: "bun ${SKILL_HOST_CLI}"}}\ntasks: {noop: {cmds: [bun --version]}}`,
    ],
    [
      SKILL_HOST_TASK,
      `vars: {CONFIG: {sh: "touch /tmp/pwn"}}\n${CANONICAL_TASK_SOURCE}`,
    ],
    [
      SKILL_HOST_TASK,
      CANONICAL_TASK_SOURCE.replace(
        `bun ${SKILL_HOST_CLI} "$NOOK_SKILL_CONFIG"`,
        `bun ${SKILL_HOST_CLI} "$NOOK_SKILL_CONFIG" --smuggled`,
      ),
    ],
  ] as const) {
    const request: HostGraphRequest = { root, source };
    expect(() => configurationScriptPaths(graph(request)), source).toThrow();
  }
});
