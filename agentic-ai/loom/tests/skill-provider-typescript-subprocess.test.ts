import { expect, test } from 'bun:test';
import {
  typescriptSubprocessCommands,
  type TypeScriptSubprocessInspection,
} from './skill-provider-typescript-subprocess.ts';
import {
  analyzeShellCommands,
  type ShellCommandInspection,
} from './skill-provider-command-boundary.ts';

function extract(source: string): readonly string[] {
  const inspection: TypeScriptSubprocessInspection = {
    path: 'scripts/maintenance.ts',
    source,
  };
  return typescriptSubprocessCommands(inspection);
}

test('extracts finite TypeScript subprocess calls for shared classification', () => {
  const protectedPath =
    '.cortex/teams/ai/dynamic-skills/example/scripts/src/cli.ts';
  const sources = [
    `Bun.spawn(['bun', '${protectedPath}']);`,
    `import { spawnSync as run } from 'node:child_process'; const root='.cortex/teams/ai/dynamic-skills/example'; run('bun',[root+'/scripts/src/cli.ts']);`,
  ];
  for (const source of sources) {
    const [command] = extract(source);
    expect(command).toContain(protectedPath);
    const inspection: ShellCommandInspection = {
      positionalArguments: false,
      source: command ?? '',
      sourcePath: false,
    };
    expect(analyzeShellCommands(inspection).launches[0]?.specifier).toBe(
      protectedPath,
    );
  }
});

test('fails closed for dynamic executables but permits benign maintenance args', () => {
  const [dynamic] = extract("Bun.spawn(['bun', input + '/cli.ts']);");
  const dynamicInspection: ShellCommandInspection = {
    positionalArguments: false,
    source: dynamic ?? '',
    sourcePath: false,
  };
  expect(() => analyzeShellCommands(dynamicInspection)).toThrow(
    'Dynamic bun executable construction',
  );
  expect(
    extract("Bun.spawn(['bun', 'scripts/catalog.ts', input]);"),
  ).toHaveLength(1);
  for (const source of [
    'Bun.spawn([runtimePath]);',
    "import {spawn} from 'node:child_process'; spawn(runtimePath, []);",
  ])
    expect(() => extract(source)).toThrow('Dynamic TypeScript subprocess');
});

test('resolves subprocess capabilities in their exact lexical scopes', () => {
  const protectedPath =
    '.cortex/teams/ai/dynamic-skills/example/scripts/src/cli.ts';
  const source = `
import * as child from 'node:child_process';
const run = child.spawnSync;
const {spawn: destructured} = child;
function shadow(Bun: {spawn(value: string[]): void}) { Bun.spawn(['bun', 'ignored.ts']); }
run('bun', ['${protectedPath}']);
destructured('bun', ['${protectedPath}']);
Bun.spawn(['bun', '${protectedPath}']);`;
  const commands = extract(source);
  expect(commands).toHaveLength(3);
  expect(commands.every((command) => command.includes(protectedPath))).toBe(
    true,
  );
  expect(
    extract('const Bun={spawn(){}}; Bun.spawn(["bun", "ignored.ts"]);'),
  ).toEqual([]);
  for (const source of [
    "import {spawn} from 'node:child_process'; const process={execPath:'bun'}; spawn(process.execPath, []);",
    "import {spawn} from 'node:child_process'; const Bun={which(){return 'bun'}}; spawn(Bun.which('bun'), []);",
    "import {spawn} from 'node:child_process'; const join=()=> 'bun'; spawn(join('x'), []);",
  ])
    expect(() => extract(source)).toThrow('Dynamic TypeScript subprocess');
  expect(
    extract(
      "import {spawn} from 'node:child_process'; spawn(process.execPath, []);",
    ),
  ).toEqual(["'node'"]);
});

test('supports finite exec, fork, and namespace forms and rejects malformed calls', () => {
  const commands = extract(`
import * as child from 'node:child_process';
child.execSync('bun scripts/check.ts');
child.fork('scripts/worker.ts', ['safe']);
child.execFile('bun', ['scripts/check.ts']);`);
  expect(commands).toEqual([
    'bun scripts/check.ts',
    "'node' 'scripts/worker.ts' 'safe'",
    "'bun' 'scripts/check.ts'",
  ]);
  const [dynamic] = extract(
    "import {spawn} from 'node:child_process'; spawn('bun', args);",
  );
  const inspection: ShellCommandInspection = {
    positionalArguments: false,
    source: dynamic ?? '',
    sourcePath: false,
  };
  expect(() => analyzeShellCommands(inspection)).toThrow(
    'Dynamic bun executable construction',
  );
});

test('proves dynamic wrappers through exact lexical callers instead of file text', () => {
  const isolated = `
import {spawnSync} from 'node:child_process';
type IsolatedCommandRequest={command:string,args:readonly string[]};
function runIsolatedCommand(request:IsolatedCommandRequest){spawnSync(request.command,[...request.args]);}
const noise:IsolatedCommandRequest={command:'not-a-caller',args:[]};
const safe:IsolatedCommandRequest={command:'git',args:[]}; runIsolatedCommand(safe);`;
  expect(extract(isolated)).toEqual([]);
  expect(() =>
    extract(
      isolated.replace(
        'runIsolatedCommand(safe)',
        'runIsolatedCommand({command:runtimePath,args:[]})',
      ),
    ),
  ).toThrow('Dynamic TypeScript subprocess');
  const dispatch = `
import {spawnSync} from 'node:child_process';
type RunCommandArgs={command:string,args:readonly string[],cwd:string};
function runCommand(input:RunCommandArgs){const {command,args}=input; spawnSync(command,[...args]);}
runCommand({command:'git',args:[],cwd:'.'});`;
  expect(extract(dispatch)).toEqual(["'git'"]);
  expect(() =>
    extract(dispatch.replace("command:'git'", 'command:runtimePath')),
  ).toThrow('Dynamic runCommand executable');
});
