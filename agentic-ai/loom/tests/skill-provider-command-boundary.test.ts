import { expect, test } from 'bun:test';
import {
  analyzeShellCommands,
  runnableCommandSources,
  type ShellCommandInspection,
} from './skill-provider-command-boundary.ts';

const PROTECTED =
  '.cortex/teams/ai/dynamic-skills/example-skill/scripts/src/cli.ts';

function inspectShell(source: string) {
  const inspection: ShellCommandInspection = {
    dockerOverride: false,
    positionalArguments: false,
    source,
    sourcePath: false,
  };
  return analyzeShellCommands(inspection);
}

function inspectProtected(source: string) {
  const analysis = inspectShell(source);
  if (
    analysis.launches.some(
      (launch) =>
        launch.specifier.includes('.cortex') &&
        launch.specifier.includes('dynamic-skills') &&
        launch.specifier.includes('/scripts/'),
    )
  )
    throw new Error('Protected executable-skill launch.');
  return analysis;
}

test('extracts only schema-executable package, Task, workflow, and action values', () => {
  const packageFixture = {
    path: 'package.json',
    source:
      '{"description":"bun prose.ts","scripts":{"check":"bun scripts/check.ts"}}',
  };
  expect(runnableCommandSources(packageFixture)).toEqual([
    'bun scripts/check.ts',
  ]);
  const taskSource = `version: '3'
vars: {ROOT: scripts}
tasks:
  check:
    desc: bun prose.ts
    dir: '{{.ROOT}}'
    deps: [prepare]
    cmds: [bun check.ts, {task: verify}, {defer: bun cleanup.ts}]
    status: [bun status.ts]
    preconditions: [{sh: bun ready.ts}]
    vars: {DISCOVER: {sh: bun discover.ts}, DATA: {value: bun ignored.ts}}`;
  const taskFixture = {
    path: 'Taskfile.ci.yml',
    source: taskSource,
  };
  expect(runnableCommandSources(taskFixture)).toEqual([
    'cd "scripts" && bun check.ts',
    'cd "scripts" && task verify',
    'cd "scripts" && bun cleanup.ts',
    'cd "scripts" && bun status.ts',
    'cd "scripts" && task prepare',
    'cd "scripts" && bun ready.ts',
    'cd "scripts" && bun discover.ts',
  ]);
  const workflow = `name: bun prose.ts
jobs: {audit: {metadata: {run: bun ignored.ts}, steps: [{name: bun prose.ts, run: bun scripts/workflow.ts}]}}`;
  const workflowFixture = {
    path: '.github/workflows/audit.yml',
    source: workflow,
  };
  expect(runnableCommandSources(workflowFixture)).toEqual([
    'bun scripts/workflow.ts',
  ]);
});

test('rejects every protected runtime construction and masked launch', () => {
  const fixtures = [
    `bun ${PROTECTED.replace('example-skill', 'exampl?-skill')}`,
    `cd .cortex/teams/ai/dynamic-skills/example-skill/scripts && bun src/cli.ts`,
    ...['--cwd .', '--watch', '--'].map((flag) => `bun ${flag} ${PROTECTED}`),
    `bash -c 'bun ${PROTECTED}'`,
    `a=${PROTECTED}; b=$a; bun "$b"`,
    'bun "${A:-.cortex}/teams/ai/${B:-dynamic-skills}/example-skill/scripts/src/cli.ts"',
    `runner=$RUNTIME; "$runner" ${PROTECTED}`,
    '"$UNBOUND"',
    'TARGET=$USER_INPUT; cd "$TARGET"; bun src/cli.ts',
    'cd "${A:-.cortex}/teams/ai/${B:-dynamic-skills}/example/scripts"; bun src/cli.ts',
    `eval 'bun ${PROTECTED}'`,
    `alias audit='bun ${PROTECTED}'; audit`,
    'task skills:tools-$(printf list)',
  ];
  for (const source of fixtures)
    expect(() => inspectProtected(source), source).toThrow();
  for (const source of [
    `${'command '.repeat(33)}bun scripts/catalog.ts`,
    `${'env '.repeat(32)}bun scripts/catalog.ts`,
  ])
    expect(() => inspectShell(source), source).toThrow();
  for (const source of [`env -S 'bun ${PROTECTED}'`])
    expect(() => inspectShell(source), source).toThrow(
      'Unsupported env option',
    );
});

test('enforces UTF-8 source and token bounds before classification', () => {
  expect(() => inspectShell(`#${'a'.repeat(65_535)}`)).not.toThrow();
  expect(() => inspectShell(`#${'a'.repeat(65_536)}`)).toThrow(
    'UTF-8 byte bound',
  );
  expect(() => inspectShell('word '.repeat(4_097))).toThrow('token count');
  const inert = { inert: 'é'.repeat(32_768) };
  const huge = { path: 'package.json', source: JSON.stringify(inert) };
  expect(() => runnableCommandSources(huge)).toThrow('UTF-8 byte bound');
  const entries = [...Array(4_097).keys()].map((index) => [String(index), 'x']);
  const scripts = { scripts: Object.fromEntries(entries) };
  const many = { path: 'package.json', source: JSON.stringify(scripts) };
  expect(() => runnableCommandSources(many)).toThrow('command count');
  const amplified = {
    path: 'Taskfile.yml',
    source: `vars: {LONG: ${'a'.repeat(100)}}\ntasks: {x: {dir: '{{.LONG}}', cmds: [${'x,'.repeat(3_000)}]}}`,
  };
  expect(() => runnableCommandSources(amplified)).toThrow('command bytes');
});
