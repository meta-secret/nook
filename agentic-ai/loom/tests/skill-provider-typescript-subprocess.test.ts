import { expect, test } from 'bun:test';

import { resolve } from 'node:path';

import {
  type TypeScriptSubprocessInspection,
  SkillProviderTypescriptSubprocessScenario,
} from './skill-provider-typescript-subprocess.ts';

import {
  type ShellCommandInspection,
  SkillProviderCommandBoundaryScenario,
} from './skill-provider-command-boundary.ts';

import {
  type AuditedRuntimeSourceRequest,
  SkillProviderSourcedSeamsScenario,
} from './skill-provider-sourced-seams.ts';
import { SettledRejection } from './settled-rejection.ts';

export class SkillProviderTypescriptSubprocessFixture {
  private constructor(private readonly request: string) {}

  static async extract(source: string): Promise<readonly string[]> {
    return new SkillProviderTypescriptSubprocessFixture(source).execute();
  }

  private async execute(): Promise<readonly string[]> {
    const source = this.request;
    const inspection: TypeScriptSubprocessInspection = {
      path: 'scripts/maintenance.ts',
      source,
    };
    return await SkillProviderTypescriptSubprocessScenario.typescriptSubprocessCommands(
      inspection,
    );
  }
}

test('extracts finite TypeScript subprocess calls for shared classification', async () => {
  const protectedPath =
    '.cortex/teams/ai/dynamic-skills/example/scripts/src/cli.ts';
  const sources = [
    `Bun.spawn(['bun', '${protectedPath}']);`,
    `import { spawnSync as run } from 'node:child_process'; const root='.cortex/teams/ai/dynamic-skills/example'; run('bun',[root+'/scripts/src/cli.ts']);`,
  ];
  for (const source of sources) {
    const [command] =
      await SkillProviderTypescriptSubprocessFixture.extract(source);
    expect(command).toContain(protectedPath);
    const [defaulted1 = ''] = [command];
    const inspection: ShellCommandInspection = {
      positionalArguments: false,
      source: defaulted1,
      sourcePath: false,
    };
    expect(
      SkillProviderCommandBoundaryScenario.analyzeShellCommands(inspection)
        .launches[0]?.specifier,
    ).toBe(protectedPath);
  }
});

test('registers the repository policy toolchain as an exact audited source', async () => {
  const path = 'agentic-ai/loom/src/commands/repository-policy-toolchain.ts';
  const source = await Bun.file(
    resolve(import.meta.dir, '../../..', path),
  ).text();
  const inspection: AuditedRuntimeSourceRequest = { path, source };

  expect(
    SkillProviderSourcedSeamsScenario.isAuditedRuntimeSource(inspection),
  ).toBe(true);
  expect(() =>
    SkillProviderSourcedSeamsScenario.isAuditedRuntimeSource({
      path,
      source: source.replace(
        'spawnSync(request.executable, request.args',
        'spawnSync(request.replacedExecutable, request.args',
      ),
    }),
  ).toThrow('Audited runtime source has drifted');
});

test('pins the writable cache connector as an exact audited source', async () => {
  const path = '.github/actions/nook-cache-connect/main.js';
  const source = await Bun.file(
    resolve(import.meta.dir, '../../..', path),
  ).text();
  const inspection: AuditedRuntimeSourceRequest = { path, source };

  expect(
    SkillProviderSourcedSeamsScenario.isAuditedRuntimeSource(inspection),
  ).toBe(true);
  expect(() =>
    SkillProviderSourcedSeamsScenario.isAuditedRuntimeSource({
      path,
      source: source.replace(
        'SCCACHE_S3_RW_MODE=READ_WRITE',
        'SCCACHE_S3_RW_MODE=READ_ONLY',
      ),
    }),
  ).toThrow('Audited runtime source has drifted');
});

test('pins the hosted type-check task fanout as an exact audited source', async () => {
  const path = '.github/scripts/type-check-report.sh';
  const source = await Bun.file(
    resolve(import.meta.dir, '../../..', path),
  ).text();
  const inspection: AuditedRuntimeSourceRequest = { path, source };

  expect(
    SkillProviderSourcedSeamsScenario.isAuditedRuntimeSource(inspection),
  ).toBe(true);
  expect(() =>
    SkillProviderSourcedSeamsScenario.isAuditedRuntimeSource({
      ...inspection,
      source: source.replace(
        'task "$task_name"',
        'task "$task_name" --verbose',
      ),
    }),
  ).toThrow(`Audited runtime source has drifted: ${path}`);
});

test('fails closed for dynamic executables but permits benign maintenance args', async () => {
  const [dynamic] = await SkillProviderTypescriptSubprocessFixture.extract(
    "Bun.spawn(['bun', input + '/cli.ts']);",
  );
  const [defaulted2 = ''] = [dynamic];
  const dynamicInspection: ShellCommandInspection = {
    positionalArguments: false,
    source: defaulted2,
    sourcePath: false,
  };
  expect(() =>
    SkillProviderCommandBoundaryScenario.analyzeShellCommands(
      dynamicInspection,
    ),
  ).toThrow('Dynamic bun executable construction');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(
      "Bun.spawn(['bun', 'scripts/catalog.ts', input]);",
    ),
  ).toHaveLength(1);
  for (const source of [
    'Bun.spawn([runtimePath]);',
    "import {spawn} from 'node:child_process'; spawn(runtimePath, []);",
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(source),
      ),
    ).toMatch('Dynamic TypeScript subprocess');
});

test('resolves subprocess capabilities in their exact lexical scopes', async () => {
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
  const commands =
    await SkillProviderTypescriptSubprocessFixture.extract(source);
  expect(commands).toHaveLength(3);
  expect(commands.every((command) => command.includes(protectedPath))).toBe(
    true,
  );
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(
      'const Bun={spawn(){}}; Bun.spawn(["bun", "ignored.ts"]);',
    ),
  ).toEqual([]);
  for (const source of [
    "import {spawn} from 'node:child_process'; const process={execPath:'bun'}; spawn(process.execPath, []);",
    "import {spawn} from 'node:child_process'; const Bun={which(){return 'bun'}}; spawn(Bun.which('bun'), []);",
    "import {spawn} from 'node:child_process'; const join=()=> 'bun'; spawn(join('x'), []);",
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(source),
      ),
    ).toMatch('Dynamic TypeScript subprocess');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(
      "import {spawn} from 'node:child_process'; spawn(process.execPath, []);",
    ),
  ).toEqual(["'node'"]);
});

test('supports finite exec, fork, and namespace forms and rejects malformed calls', async () => {
  const commands = await SkillProviderTypescriptSubprocessFixture.extract(`
import * as child from 'node:child_process';
child.execSync('bun scripts/check.ts');
child.fork('scripts/worker.ts', ['safe']);
child.execFile('bun', ['scripts/check.ts']);`);
  expect(commands).toEqual([
    'bun scripts/check.ts',
    "'node' 'scripts/worker.ts' 'safe'",
    "'bun' 'scripts/check.ts'",
  ]);
  const [dynamic] = await SkillProviderTypescriptSubprocessFixture.extract(
    "import {spawn} from 'node:child_process'; spawn('bun', args);",
  );
  const [defaulted3 = ''] = [dynamic];
  const inspection: ShellCommandInspection = {
    positionalArguments: false,
    source: defaulted3,
    sourcePath: false,
  };
  expect(() =>
    SkillProviderCommandBoundaryScenario.analyzeShellCommands(inspection),
  ).toThrow('Dynamic bun executable construction');
});

test('recognizes both child_process module specifiers', async () => {
  const protectedPath =
    '.cortex/teams/ai/dynamic-skills/example/scripts/src/cli.ts';
  for (const specifier of ['child_process', 'node:child_process']) {
    const source = `import * as child from '${specifier}'; import {spawnSync} from '${specifier}'; child.execFileSync('bun', ['${protectedPath}']); spawnSync('bun', ['${protectedPath}']);`;
    expect(
      await SkillProviderTypescriptSubprocessFixture.extract(source),
    ).toEqual([`'bun' '${protectedPath}'`, `'bun' '${protectedPath}'`]);
  }
});

test('classifies default imports of Node execution namespaces', async () => {
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import child from 'node:child_process';
import threads from 'worker_threads';
child.spawnSync('bun', ['scripts/facade.ts']);
new threads.Worker('./scripts/worker.mjs');`),
  ).toEqual(["'bun' 'scripts/facade.ts'", "'node' './scripts/worker.mjs'"]);
});

test('classifies dynamic imports of Node execution namespaces', async () => {
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
const child=await import('node:child_process');
const threads=await import('worker_threads');
child.spawnSync('bun', ['scripts/facade.ts']);
new threads.Worker('./scripts/worker.mjs');
(await import('child_process')).execFileSync('bun', ['scripts/check.ts']);`),
  ).toEqual([
    "'bun' 'scripts/facade.ts'",
    "'node' './scripts/worker.mjs'",
    "'bun' 'scripts/check.ts'",
  ]);
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
const specifier=input;
const child=await import(specifier);
child.spawnSync('bun', ['scripts/ignored.ts']);`),
  ).toEqual([]);
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
const importer=()=>({spawnSync(){}});
importer().spawnSync('bun', ['scripts/ignored.ts']);
const fileSystem=await import('node:fs');
fileSystem.readFileSync('ignored.ts');`),
  ).toEqual([]);
});

test('recognizes static CommonJS child-process bindings', async () => {
  for (const specifier of ['child_process', 'node:child_process']) {
    const commands = await SkillProviderTypescriptSubprocessFixture.extract(`
const {spawnSync} = require('${specifier}');
import child = require('${specifier}');
spawnSync('bun', ['scripts/facade.ts']);
child.execFileSync('bun', ['scripts/facade.ts']);`);
    expect(commands).toEqual([
      "'bun' 'scripts/facade.ts'",
      "'bun' 'scripts/facade.ts'",
    ]);
  }
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(
      "const require=()=>({spawnSync(){}}); const {spawnSync}=require('node:child_process'); spawnSync('bun',['ignored.ts']);",
    ),
  ).toEqual([]);
});

test('recognizes direct static CommonJS child-process property calls', async () => {
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(
      "require('node:child_process').spawnSync('bun', ['scripts/facade.ts']);",
    ),
  ).toEqual(["'bun' 'scripts/facade.ts'"]);
});

test('does not grant child-process capability to unsafe require owners', async () => {
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(
      "const specifier=input; require(specifier).spawnSync('bun', ['ignored.ts']);",
    ),
  ).toEqual([]);
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(
      "const require=()=>({spawnSync(){}}); require('node:child_process').spawnSync('bun', ['ignored.ts']);",
    ),
  ).toEqual([]);
});

test('recognizes static element-access child-process methods', async () => {
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import * as child from 'node:child_process';
child['spawnSync']('bun', ['scripts/facade.ts']);
require('child_process')['execFileSync']('bun', ['scripts/check.ts']);`),
  ).toEqual(["'bun' 'scripts/facade.ts'", "'bun' 'scripts/check.ts'"]);
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(`
import * as child from 'node:child_process';
const method=input;
child[method]('bun', ['ignored.ts']);`),
    ),
  ).toMatch('Dynamic child-process method selection is forbidden.');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(
      "const child={spawnSync(){}}; child['spawnSync']('bun', ['ignored.ts']);",
    ),
  ).toEqual([]);
});

test('fails closed on Function call, apply, and bind subprocess adapters', async () => {
  for (const source of [
    "import {spawnSync} from 'node:child_process'; spawnSync.call(undefined, 'bun', ['scripts/facade.ts']);",
    "import {execFileSync} from 'node:child_process'; execFileSync.apply(receiver, arguments_);",
    "import {fork} from 'node:child_process'; const launch=fork.bind(receiver, 'scripts/facade.ts'); launch();",
    "Bun.spawn['call'](receiver, ['bun', 'scripts/facade.ts']);",
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(source),
      ),
    ).toMatch('Indirect subprocess function invocation is forbidden.');
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync[method](receiver, 'bun', ['scripts/facade.ts']);`),
    ),
  ).toMatch('Dynamic subprocess function member selection is forbidden.');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
function local(spawnSync:{call(...values:readonly string[]):void}){spawnSync.call('ignored.ts');}
const holder={call(){}}; holder.call();`),
  ).toEqual([]);
});

test('fails closed on ambient Reflect subprocess invocation', async () => {
  for (const source of [
    "import {spawnSync} from 'node:child_process'; Reflect.apply(spawnSync, undefined, ['bun', ['scripts/facade.ts']]);",
    "Reflect['apply'](Bun.spawn, receiver, [['bun', 'scripts/facade.ts']]);",
    "import {spawnSync} from 'node:child_process'; globalThis.Reflect.apply(spawnSync, receiver, ['bun', []]);",
    "Reflect.construct(Worker, ['./scripts/facade.mjs']);",
    "import {fork} from 'node:child_process'; const invoke=Reflect.apply; invoke(fork, receiver, ['scripts/facade.ts']);",
    "import {execSync} from 'node:child_process'; const {apply}=Reflect; apply(execSync, receiver, ['bun scripts/facade.ts']);",
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(source),
      ),
    ).toMatch('Indirect Reflect subprocess invocation is forbidden.');
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
Reflect[method](spawnSync, receiver, arguments_);`),
    ),
  ).toMatch('Dynamic Reflect subprocess member selection is forbidden.');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
function local(Reflect:{apply(...values:readonly string[]):void}){Reflect.apply('ignored.ts');}
const Reflect={apply(){},construct(){}};
Reflect.apply('ignored.ts'); Reflect['construct']('ignored.ts');`),
  ).toEqual([]);
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
const globalThis={Reflect:{apply(){}}};
globalThis.Reflect.apply('ignored.ts');`),
  ).toEqual([]);
});

test('fails closed when ordinary calls receive execution capabilities', async () => {
  for (const source of [
    "import {spawnSync} from 'node:child_process'; invoke(spawnSync);",
    "import * as child from 'node:child_process'; invoke(child);",
    'invoke(Bun.spawn);',
    'invoke(Worker);',
    "import {fork} from 'node:child_process'; const launch=fork; invoke(launch);",
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(source),
      ),
    ).toMatch('Subprocess capability passed to unsupported call');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
const spawnSync=()=>{};
const Bun={spawn(){}};
class Worker {}
invoke(spawnSync); invoke(Bun.spawn); invoke(Worker);`),
  ).toEqual([]);
});

test('fails closed on execution capabilities nested in aggregate arguments', async () => {
  for (const source of [
    "import {spawnSync} from 'node:child_process'; invoke({tool:{run:spawnSync}});",
    'invoke([[Bun.spawn]]);',
    'const tools={worker:Worker}; invoke({tools});',
    "import * as child from 'node:child_process'; const holder={child}; invoke({...holder});",
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(source),
      ),
    ).toMatch('Subprocess capability passed to unsupported call');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
const spawnSync=()=>{};
const Bun={spawn(){}};
class Worker {}
const holder={nested:[spawnSync,Bun.spawn,Worker]};
invoke(holder);`),
  ).toEqual([]);
});

test('fails closed on execution capabilities nested in constructor arguments', async () => {
  for (const source of [
    "import {spawnSync} from 'node:child_process'; new Holder({tool:{run:spawnSync}});",
    'new Holder([[Bun.spawn]]);',
    'const tools={worker:Worker}; new Holder({tools});',
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(source),
      ),
    ).toMatch('Subprocess capability passed to unsupported call');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
const spawnSync=()=>{};
const Bun={spawn(){}};
class Worker {}
new Holder({nested:[spawnSync,Bun.spawn,Worker]});`),
  ).toEqual([]);
});

test('fails closed on deferred accessors hiding execution capabilities', async () => {
  for (const source of [
    "import {spawnSync} from 'node:child_process'; invoke({get run(){return spawnSync;}});",
    'new Holder({nested:{get run(){return Bun.spawn;}}});',
    'const tools={set run(value:unknown){sink=Worker;}}; invoke({tools});',
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(source),
      ),
    ).toMatch('Subprocess capability passed to unsupported call');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
invoke({get run(){const spawnSync=()=>{};return spawnSync;}});
new Holder({set run(value:unknown){const Worker=value; sink=Worker;}});`),
  ).toEqual([]);
});

test('propagates subprocess capability through exact Node promisify', async () => {
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
execFileAsync('bun', ['scripts/facade.ts']);`),
  ).toEqual(["'bun' 'scripts/facade.ts'"]);
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(`
import {execFile} from 'node:child_process';
const promisify=(value:unknown)=>value;
promisify(execFile);`),
    ),
  ).toMatch('Subprocess capability passed to unsupported call');
});

test('recovers subprocess capabilities from exact static object holders', async () => {
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
const direct={launch:spawnSync};
const nested={commands:direct};
const {launch:destructured}=direct;
direct.launch('bun', ['scripts/facade.ts']);
nested.commands.launch('bun', ['scripts/check.ts']);
destructured('bun', ['scripts/destructured.ts']);
const shorthand={spawnSync};
shorthand.spawnSync('bun', ['scripts/shorthand.ts']);`),
  ).toEqual([
    "'bun' 'scripts/facade.ts'",
    "'bun' 'scripts/check.ts'",
    "'bun' 'scripts/destructured.ts'",
    "'bun' 'scripts/shorthand.ts'",
  ]);
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
const tools={launch:spawnSync};
tools[input]('bun', ['scripts/ignored.ts']);`),
    ),
  ).toMatch('Dynamic subprocess capability holder selection is forbidden.');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(
      "const tools={launch(){}}; tools.launch('bun', ['scripts/ignored.ts']);",
    ),
  ).toEqual([]);
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(`
import * as child from 'node:child_process';
const tools={...child};
tools.spawnSync('bun', ['scripts/ignored.ts']);`),
    ),
  ).toMatch('Spread TypeScript subprocess capability holders are forbidden.');
});

test('preserves static subprocess cwd and rejects ambiguous cwd options', async () => {
  const commands = await SkillProviderTypescriptSubprocessFixture.extract(`
import {execFileSync,execSync,fork,spawnSync} from 'node:child_process';
spawnSync('bun', ['scripts/spawn.ts'], {cwd:'nested'});
execFileSync('bun', ['scripts/exec-file.ts'], {cwd:'nested'});
execSync('bun scripts/exec.ts', {cwd:'nested'});
fork('scripts/fork.ts', [], {cwd:'nested'});
Bun.spawn(['bun', 'scripts/bun-array.ts'], {cwd:'nested'});
Bun.spawn({cmd:['bun', 'scripts/bun-object.ts'], cwd:'nested'});`);
  expect(commands).toEqual([
    "cd 'nested' && 'bun' 'scripts/spawn.ts'",
    "cd 'nested' && 'bun' 'scripts/exec-file.ts'",
    "cd 'nested' && bun scripts/exec.ts",
    "cd 'nested' && 'node' 'scripts/fork.ts'",
    "cd 'nested' && 'bun' 'scripts/bun-array.ts'",
    "cd 'nested' && 'bun' 'scripts/bun-object.ts'",
  ]);
  for (const source of commands) {
    const inspection: ShellCommandInspection = {
      positionalArguments: false,
      source,
      sourcePath: false,
    };
    expect(
      SkillProviderCommandBoundaryScenario.analyzeShellCommands(inspection)
        .launches[0]?.workingDirectory,
    ).toBe('nested');
  }
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync('bun', ['scripts/facade.ts'], {cwd:runtimeRoot});`),
    ),
  ).toMatch('Dynamic TypeScript subprocess cwd is forbidden in');
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync('bun', ['scripts/facade.ts'], runtimeOptions);`),
    ),
  ).toMatch('Dynamic TypeScript subprocess options are forbidden.');
  for (const runtime of ['bun', 'node', 'deno', 'tsx'])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync('${runtime}', ['scripts/facade.ts'], {cwd:runtimeRoot});`),
      ),
    ).toMatch('Dynamic TypeScript subprocess cwd is forbidden in');
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(`
import {execSync} from 'node:child_process';
execSync('bun scripts/facade.ts', {cwd:runtimeRoot});`),
    ),
  ).toMatch('Dynamic TypeScript subprocess cwd is forbidden in');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
type ExternalRequest={command:string,cwd:string};
function runExternal(request:ExternalRequest){spawnSync(request.command,[],{cwd:request.cwd});}
runExternal({command:'git',cwd:runtimeRoot});
runExternal({command:'tar',cwd:runtimeRoot});`),
  ).toEqual([]);
});

test('permits static-key subprocess environments and rejects dynamic maps', async () => {
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync('bun', ['scripts/facade.ts'], {cwd:'nested',env:{}});`),
  ).toEqual(["cd 'nested' && 'bun' 'scripts/facade.ts'"]);
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
function run(request:{indexFile?:string}) {
  spawnSync('git', ['status'], {env:{
    PATH:process.env.PATH,
    GIT_CONFIG_NOSYSTEM:'1',
    GIT_CONFIG_GLOBAL:'/dev/null',
    GIT_INDEX_FILE:request.indexFile,
  }});
}
run({indexFile:'index'});`),
  ).toEqual([]);
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync('git', ['status'], {env:{PATH:'/bin:/usr/bin:/usr/sbin'}});`),
  ).toEqual([]);
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
function run(request:{repositoryRoot:string}) {
  const repositoryRoot=request.repositoryRoot;
  spawnSync('git', ['status'], {
    cwd:repositoryRoot,
    env:{
      PATH:'/bin:/usr/bin:/usr/sbin',
      GIT_CONFIG_COUNT:'1',
      GIT_CONFIG_KEY_0:'safe.directory',
      GIT_CONFIG_VALUE_0:repositoryRoot,
    },
  });
}
run({repositoryRoot:'/repo'});`),
  ).toEqual([]);
  for (const source of [
    "import {fork} from 'node:child_process'; fork('scripts/facade.ts', [], {env:process.env});",
    "Bun.spawn(['bun', 'scripts/facade.ts'], {env:{...process.env}});",
    "import {spawnSync} from 'node:child_process'; const environment={PATH:process.env.PATH}; spawnSync('git', ['status'], {env:environment});",
    "import {spawnSync} from 'node:child_process'; spawnSync('git', ['status'], {env:{[environmentName]:environmentValue}});",
    "import {spawnSync} from 'node:child_process'; spawnSync('git', ['status'], {env:{PATH:process.env.PATH,PATH:'/usr/bin'}});",
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(source),
      ),
    ).toMatch('Dynamic TypeScript subprocess environment is forbidden');
  for (const environmentName of ['BASH_ENV', 'NODE_OPTIONS', 'CUSTOM_VALUE'])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync('git', ['status'], {env:{${environmentName}:requestValue}});`),
      ),
    ).toMatch(
      `Unsafe TypeScript subprocess environment key ${environmentName}`,
    );
  for (const environment of [
    "{PATH:'./bin:/usr/bin'}",
    "{PATH:'/tmp:/bin:/usr/bin:/usr/sbin'}",
    "{PATH:'/bin:/usr/bin:/usr/sbin:'}",
    '{PATH:request.path}',
    "{Path:'relative-bin'}",
    "{Path:'/bin:/usr/bin:/usr/sbin'}",
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync('git', ['status'], {env:${environment}});`),
      ),
    ).toMatch('Unsafe TypeScript subprocess PATH value');
  for (const environment of [
    "{GIT_CONFIG_GLOBAL:'./evil.gitconfig'}",
    "{GIT_CONFIG_NOSYSTEM:'0'}",
    "{GIT_NO_REPLACE_OBJECTS:'0'}",
    "{GIT_TERMINAL_PROMPT:'1'}",
    "{LC_ALL:'en_US.UTF-8'}",
    '{COMSPEC:request.shell}',
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync('git', ['status'], {env:${environment}});`),
      ),
    ).toMatch('Unsafe TypeScript subprocess environment value');
  for (const environment of [
    "{GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'safe.directory',GIT_CONFIG_VALUE_0:'/repo'}",
    "{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'alias.status',GIT_CONFIG_VALUE_0:'/repo'}",
    "{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'safe.directory',GIT_CONFIG_VALUE_0:'/other'}",
    "{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'safe.directory'}",
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync('git', ['status'], {cwd:'/repo',env:${environment}});`),
      ),
    ).toMatch('Unsafe TypeScript Git safe.directory environment');
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
function nextPath(){return '/repo';}
spawnSync('git', ['status'], {cwd:nextPath(),env:{
  PATH:'/bin:/usr/bin:/usr/sbin',
  GIT_CONFIG_COUNT:'1',
  GIT_CONFIG_KEY_0:'safe.directory',
  GIT_CONFIG_VALUE_0:nextPath(),
}});`),
    ),
  ).toMatch('Unsafe TypeScript Git safe.directory environment');
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync('git', ['status'], {cwd:'/repo/../repo',env:{
  PATH:'/bin:/usr/bin:/usr/sbin',
  GIT_CONFIG_COUNT:'1',
  GIT_CONFIG_KEY_0:'safe.directory',
  GIT_CONFIG_VALUE_0:'/repo/../repo',
}});`),
    ),
  ).toMatch('Unsafe TypeScript Git safe.directory environment');
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync('git', ['status'], {cwd:'/repo',env:{GIT_CONFIG_KEY_1:'safe.directory'}});`),
    ),
  ).toMatch('Unsafe TypeScript subprocess environment key GIT_CONFIG_KEY_1');
});

test('rejects shell-enabled subprocess options', async () => {
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import {execFileSync,spawnSync} from 'node:child_process';
spawnSync('bun', ['scripts/spawn.ts'], {shell:false});
execFileSync('bun', ['scripts/exec-file.ts'], {shell:false});`),
  ).toEqual(["'bun' 'scripts/spawn.ts'", "'bun' 'scripts/exec-file.ts'"]);
  for (const source of [
    "import {spawnSync} from 'node:child_process'; spawnSync('bun', ['scripts/facade.ts'], {shell:true});",
    "import {execFileSync} from 'node:child_process'; execFileSync('bun', ['scripts/facade.ts'], {shell:'/bin/bash'});",
    "import {execSync} from 'node:child_process'; execSync('bun scripts/facade.ts', {shell:runtimeShell});",
    "import {spawnSync} from 'node:child_process'; spawnSync('git', ['status'], {shell:true});",
    "Bun.spawn(['bun', 'scripts/facade.ts'], {shell:true});",
    "import {spawnSync} from 'node:child_process'; spawnSync('bun', [], {shell:false,shell:true});",
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(source),
      ),
    ).toMatch('Shell-enabled TypeScript subprocess options are forbidden in');
});

test('rejects TypeScript Worker execution options authority', async () => {
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
new Worker('./scripts/empty.mjs', {});
new Worker('./scripts/args.mjs', {execArgv:[],eval:false});`),
  ).toEqual(["'node' './scripts/empty.mjs'", "'node' './scripts/args.mjs'"]);
  for (const source of [
    "new Worker('./scripts/facade.mjs', runtimeOptions);",
    "new Worker('./scripts/facade.mjs', {execArgv:['--require','./hook.cjs']});",
    "new Worker('./scripts/facade.mjs', {execArgv:runtimeArgs});",
    "new Worker('./scripts/facade.mjs', {execArgv:[],execArgv:['--inspect']});",
    "new Worker('postMessage(1)', {eval:true});",
    "new Worker('./scripts/facade.mjs', {eval:false,eval:false});",
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(source),
      ),
    ).not.toBe(false);
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
class Worker { constructor(path:string,options:unknown){} }
new Worker('ignored.ts', {execArgv:['--require','./ignored.cjs'],eval:true});`),
  ).toEqual([]);
});

test('rejects command-capable git and tar arguments', async () => {
  for (const source of [
    "import {spawnSync} from 'node:child_process'; spawnSync('git',['-c','alias.audit=!sh -c whoami','status']);",
    "import {execFileSync} from 'node:child_process'; execFileSync('git',['config','alias.audit','!sh -c whoami']);",
    "Bun.spawn(['git','--upload-pack=./scripts/helper','fetch','origin']);",
    "Bun.spawn(['tar','--checkpoint-action=exec=sh hook.sh','--extract']);",
    "import {spawnSync} from 'node:child_process'; spawnSync('git',['-c',runtimeConfig,'status']);",
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(source),
      ),
    ).toMatch(/Command-capable (?:git|tar)/);
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync('git',['-c','core.hooksPath=/dev/null','archive','HEAD']);
spawnSync('tar',['--extract','--file=repository.tar']);`),
  ).toEqual([]);
});

test('rejects command-launching git subcommands and options', async () => {
  for (const args of [
    "['difftool','--extcmd=sh hook.sh']",
    "['mergetool','--tool=custom']",
    "['bisect','run','sh','hook.sh']",
    "['submodule','foreach','sh hook.sh']",
    "['rebase','--exec=sh hook.sh','main']",
    "['grep','--open-files-in-pager=sh hook.sh','needle']",
    "['config','core.sshCommand','sh hook.sh']",
  ])
    expect(
      await SettledRejection.message(
        SkillProviderTypescriptSubprocessFixture.extract(
          `import {spawnSync} from 'node:child_process'; spawnSync('git',${args});`,
        ),
      ),
    ).toMatch('Command-capable git');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import {spawnSync} from 'node:child_process';
spawnSync('git',['help','difftool']);
spawnSync('git',['config','--global','user.name','Nook']);
spawnSync('git',['-c','core.hooksPath=/dev/null','archive','HEAD']);`),
  ).toEqual([]);
});

test('pins the sole dynamic package cwd exemption to its exact function AST', async () => {
  const path = 'agentic-ai/loom/src/executable-skills/package-gate.ts';
  const sourcePath = resolve(import.meta.dir, '../../..', path);
  const source = await Bun.file(sourcePath).text();
  const inspection: TypeScriptSubprocessInspection = { path, source };
  expect(
    await SkillProviderTypescriptSubprocessScenario.typescriptSubprocessCommands(
      inspection,
    ),
  ).toEqual([
    "'bun' 'install' '--frozen-lockfile'",
    "'bun' 'run' 'format'",
    "'bun' 'run' 'verify'",
  ]);
  const driftedInspection: TypeScriptSubprocessInspection = {
    path,
    source: source.replace("'verify']", "'verify-drift']"),
  };
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessScenario.typescriptSubprocessCommands(
        driftedInspection,
      ),
    ),
  ).toMatch('Dynamic TypeScript subprocess cwd is forbidden in');
});

test('audits static worker entrypoints and rejects dynamic worker authority', async () => {
  const commands = await SkillProviderTypescriptSubprocessFixture.extract(`
import {Worker as ThreadWorker} from 'node:worker_threads';
import * as threads from 'node:worker_threads';
const {Worker:RequiredWorker}=require('worker_threads');
const Launch=ThreadWorker;
new Launch('./scripts/imported-worker.mjs');
new threads.Worker('./scripts/namespaced-worker.mjs');
new RequiredWorker('./scripts/required-worker.mjs');
new Worker('./scripts/ambient-worker.mjs');`);
  expect(commands).toEqual([
    "'node' './scripts/imported-worker.mjs'",
    "'node' './scripts/namespaced-worker.mjs'",
    "'node' './scripts/required-worker.mjs'",
    "'node' './scripts/ambient-worker.mjs'",
  ]);
  expect(
    commands.map((source) => {
      const inspection: ShellCommandInspection = {
        positionalArguments: false,
        source,
        sourcePath: false,
      };
      return SkillProviderCommandBoundaryScenario.analyzeShellCommands(
        inspection,
      ).launches[0]?.specifier;
    }),
  ).toEqual([
    './scripts/imported-worker.mjs',
    './scripts/namespaced-worker.mjs',
    './scripts/required-worker.mjs',
    './scripts/ambient-worker.mjs',
  ]);
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(
        'new Worker(runtimePath);',
      ),
    ),
  ).toMatch('Dynamic TypeScript worker entrypoint is forbidden.');
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(
        "new Worker('data:text/javascript,postMessage(1)');",
      ),
    ),
  ).toMatch('Non-file TypeScript worker entrypoint is forbidden.');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(
      "class Worker { constructor(value:string){} }; new Worker('ignored.ts');",
    ),
  ).toEqual([]);
});

test('extracts static Bun shell templates and rejects dynamic interpolation', async () => {
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
const target='scripts/facade.ts';
Bun.$\`bun \${target}\`;
Bun['$']\`bun scripts/check.ts\`;
const shell=Bun.$;
shell\`bun scripts/alias.ts\`;`),
  ).toEqual([
    "bun 'scripts/facade.ts'",
    'bun scripts/check.ts',
    'bun scripts/alias.ts',
  ]);
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract('Bun.$`bun ${input}`;'),
    ),
  ).toMatch('Dynamic Bun.$ subprocess shell source is forbidden.');
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(
      'const Bun={$(){}}; Bun.$`bun scripts/ignored.ts`;',
    ),
  ).toEqual([]);
});

test('propagates imported Bun shell tags through static aliases', async () => {
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
import {$ as shell} from 'bun';
import * as runtime from 'bun';
import BunRuntime from 'bun';
const alias=shell;
const namespaced=runtime.$;
const defaulted=BunRuntime['$'];
alias\`bun scripts/alias.ts\`;
namespaced\`bun scripts/namespace.ts\`;
defaulted\`bun scripts/default.ts\`;`),
  ).toEqual([
    'bun scripts/alias.ts',
    'bun scripts/namespace.ts',
    'bun scripts/default.ts',
  ]);
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(`
const shell=(parts:TemplateStringsArray)=>parts;
const runtime={$:shell};
shell\`ignored\`; runtime.$\`ignored\`;`),
  ).toEqual([]);
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(`
import * as runtime from 'bun';
runtime[method]\`bun scripts/ignored.ts\`;`),
    ),
  ).toMatch('Dynamic Bun namespace member selection is forbidden.');
});

test('proves dynamic wrappers through exact lexical callers instead of file text', async () => {
  const isolated = `
import {spawnSync} from 'node:child_process';
type IsolatedCommandRequest={command:string,args:readonly string[]};
function runIsolatedCommand(request:IsolatedCommandRequest){spawnSync(request.command,[...request.args]);}
const noise:IsolatedCommandRequest={command:'not-a-caller',args:[]};
const safe:IsolatedCommandRequest={command:'git',args:[]}; runIsolatedCommand(safe);`;
  expect(
    await SkillProviderTypescriptSubprocessFixture.extract(isolated),
  ).toEqual([]);
  expect(
    await SettledRejection.message(
      SkillProviderTypescriptSubprocessFixture.extract(
        isolated.replace(
          'runIsolatedCommand(safe)',
          'runIsolatedCommand({command:runtimePath,args:[]})',
        ),
      ),
    ),
  ).toMatch('Dynamic TypeScript subprocess');
});
