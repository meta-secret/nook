import { describe, expect, test } from 'bun:test';
import { analyzeExecutableSkillSource } from '../../src/executable-skills/source-policy.ts';

type AnalyzeFixtureRequest = {
  readonly source: string;
};

function analyzeFixture(request: AnalyzeFixtureRequest): readonly string[] {
  const analysisRequest = {
    ...request,
    relativePath: '.agents/skills/fixture/src/runner.ts',
  };
  return analyzeExecutableSkillSource(analysisRequest).moduleSpecifiers;
}

describe('executable skill source policy', () => {
  test('accepts audited local modules and type-only external modules', () => {
    const source = [
      "import type { Root } from 'mdast';",
      "import type { InspectOptions } from 'node:util';",
      "export type { Node } from 'unist';",
      "import { audit } from './audit.ts';",
      'const values = [1, 2];',
      'Bun.write(Bun.stdout, JSON.stringify(audit(values[0])));',
      "Bun.write(Bun.stderr, 'audited failure');",
    ].join('\n');
    const request: AnalyzeFixtureRequest = {
      source,
    };
    expect(analyzeFixture(request)).toEqual(['./audit.ts']);
  });

  test('distinguishes emitted local bindings from ambient capability names', () => {
    const source = [
      'const process = { cwd: () => "/local" };',
      'const fetch = (input: string) => input;',
      'const require = (input: string) => input;',
      'const fs = { read: () => "local" };',
      'const Worker = class { constructor(readonly input: string) {} };',
      'const Object = { getPrototypeOf: (value: string) => value };',
      'const Buffer = { allocUnsafe: (size: number) => new Uint8Array(size) };',
      'const Bun = { stdout: 1, spawn: (input: string) => input };',
      'const postMessage = (input: string) => input;',
      'const BroadcastChannel = class { constructor(readonly name: string) {} };',
      'process.cwd();',
      "fetch('local');",
      "require('./local.ts');",
      'fs.read();',
      "new Worker('local');",
      "Object.getPrototypeOf('local');",
      "Bun.spawn('local');",
      'Bun.stdout = 2;',
      "postMessage('local');",
      "new BroadcastChannel('local');",
      'function useLocal(process: string): string { return process; }',
      "useLocal('local');",
      'const localHolder = { Bun, Buffer, process, fetch, Worker, Object, postMessage, BroadcastChannel };',
    ].join('\n');
    const request: AnalyzeFixtureRequest = { source };
    expect(analyzeFixture(request)).toEqual([]);
  });

  test('allows erased declarations only in declaration and type positions', () => {
    const source = [
      'declare const process: { cwd(): string };',
      "import type { Bun as BunShape } from 'bun-types';",
      'interface Bun { readonly stdout: number }',
      'type Object = { readonly local: true };',
      'type ProcessShape = typeof process;',
      'type RuntimeShape = BunShape;',
      'interface Holder { readonly process: ProcessShape; readonly bun: Bun; readonly object: Object }',
    ].join('\n');
    const request: AnalyzeFixtureRequest = { source };
    expect(analyzeFixture(request)).toEqual([]);
  });

  test('rejects erased declarations and type-only bindings used as values', () => {
    const sources = [
      'declare const capability: { run(): void }; capability.run();',
      'declare const process: { cwd(): string }; process.cwd();',
      'declare const Bun: { write(value: string): void }; Bun.write("x");',
      'function process(): { cwd(): string }; process.cwd();',
      'const enum Worker { Local }; new Worker();',
      "import type { Runtime } from './types.ts'; Runtime.run();",
      "import type { Bun } from 'bun-types'; Bun.spawn('unsafe');",
      'interface capability { run(): void }; capability.run();',
      'type capability = { run(): void }; capability.run();',
      'interface Bun { readonly stdout: number }; Bun.stdout;',
      'type Bun = { write(value: string): void }; Bun.write("unsafe");',
      'interface Object { keys(value: string): string[] }; Object.keys("unsafe");',
      'type Object = { getPrototypeOf(value: string): string }; Object.getPrototypeOf("unsafe");',
      'interface postMessage { readonly local: true }; postMessage("unsafe");',
      'type BroadcastChannel = { readonly local: true }; new BroadcastChannel("unsafe");',
    ];
    for (const source of sources) {
      const request: AnalyzeFixtureRequest = { source };
      expect(() => analyzeFixture(request)).toThrow(
        'erased declarations used as runtime values',
      );
    }
  });

  test('rejects type-only and empty Bun namespaces used as runtime values', () => {
    const sources = [
      'namespace Bun {}; Bun.file("unsafe");',
      'namespace Bun { export interface File {} }; Bun.spawn("unsafe");',
    ];
    for (const source of sources) {
      const request: AnalyzeFixtureRequest = { source };
      expect(() => analyzeFixture(request)).toThrow(
        'Bun APIs outside narrow standard I/O',
      );
    }
  });

  test('accepts runtime-valued Bun namespace and local shadow capabilities', () => {
    const source = [
      'namespace Bun {',
      '  export const file = (path: string) => path;',
      '  export const spawn = (command: string) => command;',
      '}',
      'Bun.file("local");',
      'Bun.spawn("local");',
    ].join('\n');
    const request: AnalyzeFixtureRequest = { source };
    expect(analyzeFixture(request)).toEqual([]);
  });

  test('analyzes only the runtime-local side of export specifiers', () => {
    const accepted = [
      'const Bun = { stdout: 1 };',
      'const process = { cwd: () => "local" };',
      'const eval = (value: string) => value;',
      'const local = 1;',
      'interface RuntimeShape { readonly value: string }',
      'export { Bun, process as publicProcess, eval as publicEval, local as Object };',
      'export type { RuntimeShape as BunShape };',
      "export { RuntimeShape as RemoteShape } from './types.ts';",
    ].join('\n');
    const acceptedRequest: AnalyzeFixtureRequest = { source: accepted };
    expect(analyzeFixture(acceptedRequest)).toEqual(['./types.ts']);

    const rejected = [
      'export { Bun };',
      'export { Bun as runtime };',
      'export { process };',
      'export { process as runtime };',
      'export { eval };',
      'export { eval as runtime };',
    ];
    for (const source of rejected) {
      const rejectedRequest: AnalyzeFixtureRequest = { source };
      expect(() => analyzeFixture(rejectedRequest)).toThrow(
        'ambient global capabilities',
      );
    }
  });

  test('rejects runtime external packages in every static form', () => {
    const sources = [
      "import 'package-name';",
      "import value from '@scope/package/subpath';",
      "export { value } from 'npm:package-name';",
      "export * from 'jsr:package-name';",
      "import value = require('package-name');",
      "import value from '#alias';",
      "import value from 'data:text/javascript,export default 1';",
      "import value from '.';",
      "import value from '..';",
      "import value from '.evil';",
      "import value from '...';",
      "import value from '.agents/pkg';",
    ];
    for (const source of sources) {
      const request: AnalyzeFixtureRequest = {
        source,
      };
      expect(() => analyzeFixture(request)).toThrow('external runtime package');
    }
  });

  test('accepts only exact relative file module prefixes', () => {
    const request: AnalyzeFixtureRequest = {
      source: [
        "import descendant from './local.ts';",
        "import ancestor from '../domain.ts';",
        'descendant;',
        'ancestor;',
      ].join('\n'),
    };
    expect(analyzeFixture(request)).toEqual(['./local.ts', '../domain.ts']);
  });

  test('rejects forbidden ambient roots read through shorthand properties', () => {
    for (const capability of [
      'Bun',
      'Buffer',
      'process',
      'eval',
      'Function',
      'Object',
      'console',
      'fetch',
      'Worker',
    ]) {
      const request: AnalyzeFixtureRequest = {
        source: `const holder = { ${capability} };`,
      };
      expect(() => analyzeFixture(request)).toThrow(
        'ambient global capabilities',
      );
    }
  });

  test('rejects ambient Buffer allocation capabilities', () => {
    const request: AnalyzeFixtureRequest = {
      source: 'const bytes = Buffer.allocUnsafe(1024);',
    };
    expect(() => analyzeFixture(request)).toThrow(
      'ambient global capabilities',
    );
  });

  test('rejects ambient cross-context messaging capabilities', () => {
    const ambientSources = [
      'postMessage("unsafe");',
      'new BroadcastChannel("unsafe");',
      'const send = postMessage; send("unsafe");',
      'const Channel = BroadcastChannel; new Channel("unsafe");',
      'const holder = { postMessage };',
      'const holder = { BroadcastChannel };',
    ];
    for (const source of ambientSources) {
      const request: AnalyzeFixtureRequest = { source };
      expect(() => analyzeFixture(request)).toThrow(
        'ambient global capabilities',
      );
    }

    const erasedShadowSources = [
      'declare function postMessage(value: string): void; postMessage("unsafe");',
      'declare class BroadcastChannel { constructor(name: string) }; new BroadcastChannel("unsafe");',
    ];
    for (const source of erasedShadowSources) {
      const request: AnalyzeFixtureRequest = { source };
      expect(() => analyzeFixture(request)).toThrow(
        'erased declarations used as runtime values',
      );
    }
  });

  test('keeps adjacent messaging vocabulary outside the ambient capability boundary', () => {
    const source = [
      'const holder = {',
      '  postMessage: (value: string) => value,',
      '  BroadcastChannel: class { constructor(readonly name: string) {} },',
      '  onmessage: (value: string) => value,',
      '  addEventListener: (name: string) => name,',
      '  close: () => undefined,',
      '  MessageChannel: class {},',
      '  MessagePort: class {},',
      '};',
      'holder.postMessage("local");',
      'new holder.BroadcastChannel("local");',
      'holder.onmessage("local");',
      'holder.addEventListener("message");',
      'holder.close();',
      'new holder.MessageChannel();',
      'new holder.MessagePort();',
      'const messageHandler = onmessage;',
      'addEventListener("message", () => undefined);',
      'close();',
      'new MessageChannel();',
      'new MessagePort();',
    ].join('\n');
    const request: AnalyzeFixtureRequest = { source };
    expect(analyzeFixture(request)).toEqual([]);
  });

  test('rejects source, path, and module-list inputs above their bounds', () => {
    const oversizedSourceRequest: AnalyzeFixtureRequest = {
      source: 'a'.repeat(1024 * 1024 + 1),
    };
    expect(() => analyzeFixture(oversizedSourceRequest)).toThrow(
      'source exceeds its byte bound',
    );

    const oversizedPathRequest = {
      relativePath: `./${'a'.repeat(4096)}`,
      source: 'export {};',
    };
    expect(() => analyzeExecutableSkillSource(oversizedPathRequest)).toThrow(
      'source path exceeds its byte bound',
    );

    const importLines: string[] = [];
    for (let index = 0; index < 257; index += 1) {
      importLines.push(`import './module-${index}.ts';`);
    }
    const moduleListRequest: AnalyzeFixtureRequest = {
      source: importLines.join('\n'),
    };
    expect(() => analyzeFixture(moduleListRequest)).toThrow(
      'module specifiers exceed their bound',
    );
  });

  test('rejects every runtime node module form', () => {
    const sources = [
      "import { inspect } from 'node:util';",
      "export { strict } from 'node:assert';",
      "export * from 'node:path';",
      "import value = require('node:buffer');",
    ];
    for (const source of sources) {
      const request: AnalyzeFixtureRequest = { source };
      expect(() => analyzeFixture(request)).toThrow('forbidden ambient module');
    }
  });

  test('permits only direct nonnegative safe-integer literal element indexes', () => {
    const acceptedRequest: AnalyzeFixtureRequest = {
      source: [
        'const values = [1, 2];',
        'const index = 1;',
        'values[0];',
        'values?.[0];',
        'values.at(index);',
      ].join('\n'),
    };
    expect(analyzeFixture(acceptedRequest)).toEqual([]);

    const rejected = [
      "const key = 'constructor' as never as number; (() => {})[key];",
      'const values = [1]; const index = 0; values[index];',
      'const values = [1]; values[0 as number];',
      'const values = [1]; values[(0)];',
      'const values = [1]; values[+0];',
      'const values = [1]; values[-0];',
      'const values = [1]; values[1 + 1];',
      "const values = [1]; values['0'];",
      'const values = [1]; values[`0`];',
      'const values = [1]; values[0n];',
      'const values = [1]; values[NaN];',
      'const values = [1]; values[Infinity];',
      'const values = [1]; values[0.5];',
      'const values = [1]; values[9007199254740992];',
    ];
    for (const source of rejected) {
      const rejectedRequest: AnalyzeFixtureRequest = { source };
      expect(() => analyzeFixture(rejectedRequest)).toThrow(
        'nonnegative safe-integer numeric literal',
      );
    }
  });

  test('rejects loader, network, process, evaluator, and worker capabilities', () => {
    const sources = [
      "import { spawn } from 'node:child_process';",
      "import http2 from 'node:http2';",
      "import { Worker } from 'node:worker_threads';",
      "import { $ as shell } from 'bun';",
      "const load = require; load('node:fs');",
      "import.meta.require('node:fs');",
      "module.require('node:fs');",
      "const loader = process.getBuiltinModule; loader('child_process');",
      "const run = eval; run('1 + 1');",
      "const C = (() => {}).constructor; C('return 1')();",
      "const { constructor: C } = (() => {}); C('return 1')();",
      "let C; ({ constructor: C } = (() => {})); C('return 1')();",
      "let C; ({ nested: { constructor: C } } = value); C('return 1')();",
      "let C; ({ ['constructor']: C } = value); C('return 1')();",
      "const key = 'constructor'; (() => {})[key]('return 1')();",
      "new Worker('data:text/javascript,postMessage(1)');",
      "const Launch = Worker; new Launch('./worker.ts');",
      "const DynamicLoader = Loader; new DynamicLoader('./module.ts');",
      'const Realm = ShadowRealm; new Realm();',
      "Bun.stdout = '/tmp/out';",
      "Bun.stderr += '/tmp/out';",
      'Bun.stdout ??= value;',
      'Bun.stderr &&= value;',
      'Bun.stdin ||= value;',
      '++Bun.stdin;',
      'Bun.stdout--;',
      'delete Bun.stderr;',
      '({ stdout: Bun.stdout } = value);',
      '({ ...Bun.stdout } = value);',
      'for (Bun.stdout in value) {}',
      'for ({ stderr: Bun.stderr } of values) {}',
      'for ({ ...Bun.stderr } of values) {}',
      'const io = Bun; io.stdout = value;',
      "fetch('https://example.com');",
      'Bun.$`echo unsafe`;',
      "fs.readFileSync('/etc/passwd');",
      "child_process.execSync('echo unsafe');",
      "http.get('http://example.com');",
      "ffi.dlopen('/tmp/unsafe.so', {});",
      'console.takeHeapSnapshot();',
    ];
    for (const source of sources) {
      const request: AnalyzeFixtureRequest = {
        source,
      };
      expect(() => analyzeFixture(request)).toThrow();
    }
  });

  test('always applies capability audit at the production analyzer seam', () => {
    const localRequest: AnalyzeFixtureRequest = {
      source: "import { audit } from './audit.ts';",
    };
    expect(analyzeFixture(localRequest)).toEqual(['./audit.ts']);
    const packageRequest: AnalyzeFixtureRequest = {
      source: "import value from 'package-name';",
    };
    expect(() => analyzeFixture(packageRequest)).toThrow(
      'external runtime package',
    );
  });
});
