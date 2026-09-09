import { SkillProviderBoundaryScenario } from './skill-provider-boundary.fixture.ts';
import type { SkillProviderImportInspection } from './skill-provider-boundary.fixture.ts';
export { SkillProviderBoundaryScenario } from './skill-provider-boundary.fixture.ts';
import { join } from 'node:path';

import { expect, test } from 'bun:test';

type LoomSourceScanOptions = {
  readonly cwd: string;
  readonly onlyFiles: true;
};

const LOOM_ROOT = join(import.meta.dir, '..');

export const LOOM_EXECUTABLE_SOURCE = /\.(?:[cm]?[jt]sx?)$/u;

test('recognizes static and dynamic skill-provider runtime imports', () => {
  const runtimeImports = [
    "import provider from '../../../.agents/skills/provider/src/runner.ts';",
    "import '../../../.agents/skills/provider/src/runner.ts';",
    "export { provider } from '../../../.agents/skills/provider/src/runner.ts';",
    "export * from '../../../.agents/skills/provider/src/runner.ts';",
    "import provider = require('../../../.agents/skills/provider/src/runner.ts');",
    "await import('../../../.agents/skills/provider/src/runner.ts');",
    'await import(`../../../.agents/skills/provider/src/runner.ts`);',
    "require('../../../.agents/skills/provider/src/runner.ts');",
    "import {} from '../../../.agents/skills/provider/src/runner.ts';",
    "export {} from '../../../.agents/skills/provider/src/runner.ts';",
    "import '../../../.agents/./skills/provider/src/runner.ts';",
    "import '../../../.agents/elsewhere/../skills/provider/src/runner.ts';",
    "import '../../../.agents/skills';",
    "import '../.agents/skills';",
    "import 'file:///workspace/nook/%2Eagents/skills/provider/src/audit.ts';",
    "import 'data:text/javascript,export default 1';",
    "await import('data:text/javascript;base64,ZXhwb3J0IGRlZmF1bHQgMQ==');",
  ];

  for (const runtimeImport of runtimeImports) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'runtime-import.ts',
      source: runtimeImport,
    };
    expect(
      SkillProviderBoundaryScenario.violatesSkillProviderBoundary(inspection),
    ).toBe(true);
  }
  for (const inertSource of [
    "const path = '.agents/skills/provider';",
    "import type { Provider } from '../../../.agents/skills/provider/src/domain.ts';",
    "export type { Provider } from '../../../.agents/skills/provider/src/domain.ts';",
    "import type { Module } from 'node:module';",
    "export type { Module } from 'node:module';",
    'type AmbientRequire = typeof require;',
    'declare const require: (specifier: string) => string;',
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'inert-source.ts',
      source: inertSource,
    };
    expect(
      SkillProviderBoundaryScenario.violatesSkillProviderBoundary(inspection),
    ).toBe(false);
  }
});

test('rejects every runtime reference to Node evaluator modules', () => {
  for (const source of [
    "import { runInThisContext } from 'node:vm';",
    "import vm from 'vm';",
    "export { runInThisContext } from 'vm';",
    "import vm = require('node:vm');",
    "await import('node:vm');",
    "require('vm').runInThisContext(source);",
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'node-vm-evaluator.ts',
      source,
    };
    expect(
      SkillProviderBoundaryScenario.violatesSkillProviderBoundary(inspection),
    ).toBe(true);
  }
  for (const source of [
    "import type { Context } from 'node:vm';",
    "export type { Context } from 'vm';",
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'node-vm-type.ts',
      source,
    };
    expect(
      SkillProviderBoundaryScenario.violatesSkillProviderBoundary(inspection),
    ).toBe(false);
  }
});

test('rejects every unbounded ambient module loader route', () => {
  const unboundedLoaders = [
    'await import();',
    'await import(modulePath);',
    'await import("../" + modulePath);',
    'await import(`../${modulePath}`);',
    'require();',
    'require(modulePath);',
    'require.call(undefined, modulePath);',
    'require.apply(undefined, [modulePath]);',
    'const load = require;',
    'const holder = { require };',
    'globalThis.require(modulePath);',
    'const load = globalThis.require;',
    "const load = global['require'];",
    "const processRoot = global['process'];",
    "const moduleRoot = globalThis['module'];",
    "const load = module['require'];",
    'const key = "require"; const load = globalThis[key];',
    '(module as NodeModule).require(modulePath);',
    'import.meta.require(modulePath);',
    "const load = import.meta['require'];",
    'const key = "require"; const load = import.meta[key];',
    "process.getBuiltinModule('module').createRequire(import.meta.url)(modulePath);",
    "const load = process['getBuiltinModule'];",
    "const legacyModule = process['mainModule'];",
    '(process as NodeJS.Process).getBuiltinModule(moduleName);',
    'const key = "getBuiltinModule"; const load = process[key];',
    "globalThis.process.getBuiltinModule('module');",
    'globalThis.globalThis.global.require(modulePath);',
    "global['globalThis'].global['require'](modulePath);",
    '(import.meta as ImportMeta).require(modulePath);',
    "import { createRequire } from 'node:module';",
    "import process from 'node:process';",
    "import module = require('module');",
    "await import('node:module');",
    "require('node:module');",
    'const processRoot = process;',
    'const globalRoot = globalThis;',
    'const moduleRoot = module;',
    'const importMetaRoot = import.meta;',
    'const processRoot = process as NodeJS.Process;',
    'const processRoot = condition ? process : fallback;',
    'const processRoot = globalThis.process;',
    'const moduleRoot = global.module;',
    "global.globalThis.global.Object['constructor'];",
    'process.mainModule.require(modulePath);',
    'class Unsafe { require = require; require() { return require; } }',
    'const unsafe = { get require() { return require; }, set require(value: boolean) { consume(require); } };',
  ];
  for (const source of unboundedLoaders) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'unbounded-loader.ts',
      source,
    };
    expect(
      SkillProviderBoundaryScenario.violatesSkillProviderBoundary(inspection),
    ).toBe(true);
  }
  for (const source of [
    "await import('./safe-local.ts');",
    "require('./safe-local.cjs');",
    "const local = { require: (path: string) => path }; local.require('./safe-local.cjs');",
    "const local = { require: './safe-local.cjs' }; const path = local.require;",
    'const inert = "require(\'../../../.agents/skills/provider\')";',
    'const process = { getBuiltinModule: () => false }; process.getBuiltinModule();',
    'const globalThis = { require: (path: string) => path }; globalThis.require(modulePath);',
    'const module = { require: (path: string) => path }; module.require(modulePath);',
    'const require = (path: string) => path; require(modulePath);',
    "const environment = process['env'];",
    'const templateEnvironment = process[`env`];',
    "const fetchValue = globalThis['fetch'];",
    "const moduleId = module['id'];",
    "const sourceUrl = import.meta['url'];",
    "class Safe { require = 'label'; require() { return false; } get require() { return false; } set require(value: boolean) { consume(value); } }",
    'const safe = { require() { return false; }, get require() { return false; }, set require(value: boolean) { consume(value); } };',
    'interface Safe { require: Loader; require(path: string): string; }',
    'type Safe = { require: Loader; require(path: string): string };',
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'bounded-loader.ts',
      source,
    };
    expect(
      SkillProviderBoundaryScenario.violatesSkillProviderBoundary(inspection),
    ).toBe(false);
  }
});

test('distinguishes emitted loader shadows from erased ambient declarations', () => {
  for (const source of [
    'declare const process: Process; process.getBuiltinModule(moduleName);',
    'declare const globalThis: Global; globalThis.require(modulePath);',
    'declare const module: Module; module.require(modulePath);',
    'declare const require: Loader; require(modulePath);',
    'interface process {}; process.getBuiltinModule(moduleName);',
    'type module = Loader; module.require(modulePath);',
    'const holder = { process };',
    'const holder = { module };',
    'type Unsafe = { [require]: Loader };',
    'class Unsafe { require = require; }',
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'erased-loader.ts',
      source,
    };
    expect(
      SkillProviderBoundaryScenario.violatesSkillProviderBoundary(inspection),
    ).toBe(true);
  }
  const localInspection: SkillProviderImportInspection = {
    filePath: 'local-shorthand.ts',
    source:
      'const process = { getBuiltinModule: () => false }; const holder = { process };',
  };
  expect(
    SkillProviderBoundaryScenario.violatesSkillProviderBoundary(
      localInspection,
    ),
  ).toBe(false);
});

test('treats ambient-root member names as declarations, not runtime uses', () => {
  for (const root of ['process', 'module', 'global', 'globalThis']) {
    for (const source of [
      `class Safe { ${root} = 'label' }`,
      `class Safe { ${root}() { return false } }`,
      `class Safe { get ${root}() { return false } }`,
      `class Safe { set ${root}(value: boolean) { consume(value) } }`,
      `const safe = { ${root}: 'label', get ${root}() { return false } };`,
      `interface Safe { ${root}: Loader; ${root}(): string }`,
      `type Safe = { ${root}: Loader; ${root}(): string }`,
    ]) {
      const inspection: SkillProviderImportInspection = {
        filePath: 'ambient-member-name.ts',
        source,
      };
      expect(
        SkillProviderBoundaryScenario.violatesSkillProviderBoundary(inspection),
      ).toBe(false);
    }
    for (const source of [
      `class Unsafe { [${root}] = false }`,
      `const unsafe = { [${root}]: false };`,
      `class Unsafe { value = ${root}; run() { return ${root}; } }`,
    ]) {
      const inspection: SkillProviderImportInspection = {
        filePath: 'ambient-member-runtime.ts',
        source,
      };
      expect(
        SkillProviderBoundaryScenario.violatesSkillProviderBoundary(inspection),
      ).toBe(true);
    }
  }
});

test('resolves globalThis bindings in their exact lexical scopes', () => {
  for (const source of [
    'for (let globalThis of values) { globalThis.require(path); }',
    'try {} catch (globalThis) { globalThis.require(path); }',
    '{ const globalThis = local; globalThis.require(path); }',
    'function inspect(globalThis: LocalGlobal) { globalThis.require(path); }',
    'for (var globalThis of values) {} globalThis.require(path);',
    'const globalThis = local; globalThis.require(path);',
    '{ using globalThis = local; globalThis.require(path); }',
    'namespace Local { const globalThis = local; globalThis.require(path); }',
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'local-global-this.ts',
      source,
    };
    expect(
      SkillProviderBoundaryScenario.violatesSkillProviderBoundary(inspection),
    ).toBe(false);
  }
  for (const source of [
    'for (let globalThis of values) {} globalThis.require(path);',
    'try {} catch (globalThis) {} globalThis.require(path);',
    '{ const globalThis = local; } globalThis.require(path);',
    'function inspect(globalThis: LocalGlobal) {} globalThis.require(path);',
    '{ using globalThis = local; } globalThis.require(path);',
    'namespace Local { const globalThis = local; } globalThis.require(path);',
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'ambient-global-this.ts',
      source,
    };
    expect(
      SkillProviderBoundaryScenario.violatesSkillProviderBoundary(inspection),
    ).toBe(true);
  }
});

test('production Loom limits provider imports to the semantic adapter', async () => {
  const sourceGlob = new Bun.Glob('src/**/*');
  const scanOptions: LoomSourceScanOptions = {
    cwd: LOOM_ROOT,
    onlyFiles: true,
  };
  const violations: string[] = [];

  for await (const relativePath of sourceGlob.scan(scanOptions)) {
    if (!LOOM_EXECUTABLE_SOURCE.test(relativePath)) continue;
    const source = await Bun.file(join(LOOM_ROOT, relativePath)).text();
    const inspection: SkillProviderImportInspection = {
      filePath: `agentic-ai/loom/${relativePath}`,
      source,
    };
    if (
      SkillProviderBoundaryScenario.violatesSkillProviderBoundary(inspection)
    ) {
      violations.push(relativePath);
    }
  }

  expect(violations).toEqual(['src/lib/cortex-article-structure.ts']);
});
