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
    positionalArguments: false,
    source,
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

function inspectDelegation([caller, wrapper]: readonly [string, string]) {
  const launch = inspectShell(caller).launches[0];
  const inspection: ShellCommandInspection = {
    positionalArguments: launch?.positionalArguments ?? false,
    source: wrapper,
  };
  return analyzeShellCommands(inspection);
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
  const action = `name: bun prose.ts
runs: {using: composite, metadata: {run: bun ignored.ts}, steps: [{run: bun scripts/action.ts}]}`;
  const actionFixture = {
    path: '.github/actions/audit/action.yml',
    source: action,
  };
  expect(runnableCommandSources(actionFixture)).toEqual([
    'bun scripts/action.ts',
  ]);
});

test('applies effective workflow and composite working directories', () => {
  const workflow = (source: string) => {
    const fixture = { path: '.github/workflows/audit.yml', source };
    return runnableCommandSources(fixture);
  };
  const directory = PROTECTED.replace('/src/cli.ts', '');
  for (const source of [
    `defaults: {run: {working-directory: ${directory}}}\njobs: {audit: {steps: [{run: bun src/cli.ts}]}}`,
    `jobs: {audit: {defaults: {run: {working-directory: ${directory}}}, steps: [{run: bun src/cli.ts}]}}`,
    `jobs: {audit: {steps: [{working-directory: ${directory}, run: bun src/cli.ts}]}}`,
  ])
    expect(() => inspectProtected(workflow(source)[0] ?? ''), source).toThrow();
  expect(
    workflow(`defaults: {run: {working-directory: ${directory}}}
jobs: {audit: {defaults: {run: {working-directory: ignored}}, steps: [{working-directory: scripts, run: bun catalog.ts}]}}`),
  ).toEqual(['cd "scripts" && bun catalog.ts']);
  const action = {
    path: '.github/actions/audit/action.yml',
    source:
      'runs: {using: composite, steps: [{working-directory: scripts, run: bun catalog.ts}]}',
  };
  expect(runnableCommandSources(action)).toEqual([
    'cd "scripts" && bun catalog.ts',
  ]);
});

test('rejects every protected runtime construction and masked launch', () => {
  const fixtures = [
    `bun ${PROTECTED.replace('example-skill', 'exampl?-skill')}`,
    `bun .cortex/teams/ai/dynamic-"skills"/example-skill/scripts/src/cli.ts`,
    `cd .cortex/teams/ai/dynamic-skills/example-skill/scripts && bun src/cli.ts`,
    ...['--cwd .', '--watch', '--'].map((flag) => `bun ${flag} ${PROTECTED}`),
    `node --check ${PROTECTED}`,
    `sh -eu ${PROTECTED}`,
    `env -i MODE=test bun ${PROTECTED}`,
    `bash -c 'bun ${PROTECTED}'`,
    `a=${PROTECTED}; b=$a; bun "$b"`,
    `a=$PWD/${PROTECTED}; bun "$a"`,
    `a=${PROTECTED.replace('/src/', '/')}; bun "$a/$(printf src)/cli.ts"`,
    `a=${PROTECTED.replace('/src/', '/')}; bun "$a/\`printf src\`/cli.ts"`,
    'bun "${A:-.cortex}/teams/ai/${B:-dynamic-skills}/example-skill/scripts/src/cli.ts"',
    `runner=$RUNTIME; "$runner" ${PROTECTED}`,
    'R=$(printf bun); "$R" "${A:-.cortex}/teams/ai/${B:-dynamic-skills}/example/scripts/src/cli.ts"',
    `R=$(printf ${PROTECTED}); "$R"`,
    '"$UNBOUND"',
    'R=${RUNTIME:-bun}; "$R" scripts/catalog.ts',
    'TARGET=$USER_INPUT; cd "$TARGET"; bun src/cli.ts',
    'ROOT=${ROOT:-scripts}; cd "$ROOT"; bun catalog.ts',
    'cd "${A:-.cortex}/teams/ai/${B:-dynamic-skills}/example/scripts"; bun src/cli.ts',
    `(bun ${PROTECTED})`,
    `{ bun ${PROTECTED}; }`,
    `x=$(bun ${PROTECTED})`,
    `echo $(bun ${PROTECTED})`,
    `echo \`bun ${PROTECTED}\``,
    `audit(){ bun ${PROTECTED}; }; audit`,
    `function audit { bun ${PROTECTED}; }; audit`,
    `eval 'bun ${PROTECTED}'`,
    `eval -- 'bun ${PROTECTED}'`,
    `builtin eval 'bun ${PROTECTED}'`,
    `env MODE=x nohup sudo -n time -p bun ${PROTECTED}`,
    `nohup env MODE=x xargs -0 bun ${PROTECTED}`,
    `env MODE=x command eval -- 'bun ${PROTECTED}'`,
    `builtin alias audit='bun ${PROTECTED}'; audit`,
    `command alias audit='bun ${PROTECTED}'; audit`,
    `time MODE=x bun ${PROTECTED}`,
    `alias audit='bun ${PROTECTED}'; audit`,
    `nohup bun ${PROTECTED}`,
    `sudo bun ${PROTECTED}`,
    `sudo MODE=x bun ${PROTECTED}`,
    `printf '%s\0' ignored | xargs -0 bun ${PROTECTED}`,
    `{ MODE=x bun ${PROTECTED}; }`,
    `cat <<EOF\n$(bun ${PROTECTED})\nEOF`,
    `cat <<EOF-MARK\n$(bun ${PROTECTED})\nEOF-MARK`,
    `cat <<END!\n$(bun ${PROTECTED})\nEND!`,
    `bun scripts/catalog.ts --label $(printf ok); bun --smol ${PROTECTED}`,
    `node scripts/catalog.ts --label ok\nbun --hot ${PROTECTED}`,
    'task skills:tools-$(printf list)',
    'go-task skills:tools-`printf list`',
  ];
  for (const source of fixtures)
    expect(() => inspectProtected(source), source).toThrow();
  for (const source of [
    'alias first=second; alias second=first; first',
    `${'command '.repeat(33)}bun scripts/catalog.ts`,
    `${'env '.repeat(32)}bun scripts/catalog.ts`,
  ])
    expect(() => inspectShell(source), source).toThrow();
});

test('propagates only caller-bound wrapper arguments through positional delegation', () => {
  expect(
    inspectDelegation([
      `bash scripts/wrapper.sh ignore bun ${PROTECTED}`,
      'shift; exec "$@"',
    ]).launches[0]?.specifier,
  ).toBe(PROTECTED);
  expect(
    inspectDelegation([
      `bash scripts/wrapper.sh ignore bun ${PROTECTED}`,
      'shift; exec "${@}"',
    ]).launches[0]?.specifier,
  ).toBe(PROTECTED);
  expect(
    inspectDelegation([
      'bash scripts/wrapper.sh ignore bun scripts/catalog.ts --label value',
      'shift; exec "$@"',
    ]).launches[0]?.specifier,
  ).toBe('scripts/catalog.ts');
  expect(() => inspectShell('exec "$@"')).toThrow(
    'Unbound shell positional delegation',
  );
});

test('accepts dynamic inert data after a static non-protected executable', () => {
  const safe = [
    'bun scripts/catalog.ts --label $(printf "$PWD")',
    'node --check scripts/catalog.ts "${LABEL:-value}"',
    'bash -c \'printf "%s" "${LABEL:-value}"\'',
    'task {{.BUILD_TASK}} -- "${LABEL:-value}"',
  ];
  for (const source of safe) expect(() => inspectShell(source)).not.toThrow();
  for (const source of [
    'ROOT=scripts; ROOT=${ROOT:-other}; bun "$ROOT/catalog.ts"',
    'ROOT=; ROOT=${ROOT:-scripts}; bun "$ROOT/catalog.ts"',
  ])
    expect(() => inspectShell(source)).not.toThrow();
  for (const source of [
    `printf '%s' 'audit(){ bun ${PROTECTED}; }'`,
    `# function audit { bun ${PROTECTED}; }\necho safe`,
    `printf '%s' 'eval bun ${PROTECTED}'`,
    'time bun scripts/catalog.ts',
    "alias audit='bun scripts/catalog.ts'; audit",
    `alias audit='bun ${PROTECTED}'; builtin unalias audit; audit`,
    `builtin alias -p; alias audit='bun ${PROTECTED}'; builtin unalias -a; audit`,
    `${'command '.repeat(32)}bun scripts/catalog.ts`,
    `${'env '.repeat(31)}bun scripts/catalog.ts`,
    'echo $((1 << 2))',
    `true;# audit(){ bun ${PROTECTED}; }\necho safe`,
    `true;# cat <<END! $(bun ${PROTECTED})\necho safe`,
    'value=prefix; echo "${value#pre}" word#literal',
    `cat <<\\EOF\nbun ${PROTECTED}\nEOF`,
    `cat <<'END!'\nbun ${PROTECTED}\nEND!`,
    `cat <<E"OF-MARK"\nbun ${PROTECTED}\nEOF-MARK`,
  ])
    expect(() => inspectShell(source), source).not.toThrow();
  expect(() =>
    inspectShell(`unused(){ bun ${PROTECTED}; }\necho safe`),
  ).not.toThrow();
  expect(() =>
    inspectShell(`cat <<'EOF'\nbun ${PROTECTED}\nEOF\necho safe`),
  ).not.toThrow();
  expect(inspectShell(safe[0] ?? '').launches[0]?.specifier).toBe(
    'scripts/catalog.ts',
  );
});

test('enforces UTF-8 source and token bounds before classification', () => {
  expect(() => inspectShell(`#${'a'.repeat(65_535)}`)).not.toThrow();
  expect(() => inspectShell(`#${'a'.repeat(65_536)}`)).toThrow(
    'UTF-8 byte bound',
  );
  expect(() => inspectShell('word '.repeat(4_097))).toThrow('token count');
});
