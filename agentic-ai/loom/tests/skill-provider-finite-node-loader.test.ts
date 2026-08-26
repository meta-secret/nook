import { expect, test } from 'bun:test';
import { violatesSkillProviderBoundary } from './skill-provider-boundary.test.ts';
import {
  type FiniteNodeLoaderInspection,
  specializeClosedFiniteNodeLoaders,
} from './skill-provider-finite-node-loader.ts';

type AdapterFixture = {
  readonly calls: string;
  readonly extraTryStatement: string;
  readonly fallbackTemplate: string;
};

const closedFixture: AdapterFixture = {
  calls: `
const pathModule = await importNodeModule<NodePath>('node:path');
const fileSystemModule = await importNodeModule<NodeFileSystem>('node:fs');`,
  extraTryStatement: '',
  fallbackTemplate: 'import(${JSON.stringify(specifier)})',
};

function adapterSource(fixture: AdapterFixture): string {
  return `
async function importNodeModule<TModule>(specifier: string): Promise<TModule> {
  try {
    const loader = new Function('specifier', 'return import(specifier);') as (
      specifier: string,
    ) => Promise<TModule>;
    ${fixture.extraTryStatement}
    return await loader(specifier);
  } catch {
    return (await (0, eval)(\`${fixture.fallbackTemplate}\`)) as Promise<TModule>;
  }
}
${fixture.calls}
`;
}

function specialize(source: string): string {
  const inspection: FiniteNodeLoaderInspection = {
    path: 'finite-node-loader.ts',
    source,
  };
  return specializeClosedFiniteNodeLoaders(inspection);
}

function violatesBoundary(source: string): boolean {
  const inspection = {
    allowUnprovenComputedDataAccess: true as const,
    filePath: 'finite-node-loader.ts',
    source,
  };
  return violatesSkillProviderBoundary(inspection);
}

test('specializes the exact closed Node module adapter into literal imports', () => {
  const source = adapterSource(closedFixture);
  const specialized = specialize(source);
  expect(specialized).not.toBe(source);
  expect(specialized).not.toContain('new Function');
  expect(specialized).not.toContain('(0, eval)');
  expect(specialized).toContain("await import('node:path')");
  expect(specialized).toContain("await import('node:fs')");
  expect(violatesBoundary(specialized)).toBe(false);
});

test('refuses computed, escaped, or non-Node adapter calls', () => {
  const unsafeCalls = [
    `const specifier = 'node:path'; await importNodeModule(specifier);`,
    `await importNodeModule('../../../.agents/skills/provider/src/run.ts');`,
    `await importNodeModule('./local.ts');`,
    `await importNodeModule('node:crypto');`,
    `await importNodeModule('node:path', 'node:fs');`,
    `const alias = importNodeModule; await alias('node:path');`,
    `return importNodeModule;`,
    `consume(importNodeModule);`,
    `const holder = { loader: importNodeModule };`,
    `const { bind } = importNodeModule; consume(bind);`,
    `holder.importNodeModule('node:path');`,
  ];
  for (const calls of unsafeCalls) {
    const fixture: AdapterFixture = { ...closedFixture, calls };
    const source = adapterSource(fixture);
    expect(specialize(source), calls).toBe(source);
    expect(violatesBoundary(source), calls).toBe(true);
  }
});

test('refuses mutated evaluator adapter bodies', () => {
  const mutations: readonly AdapterFixture[] = [
    {
      ...closedFixture,
      extraTryStatement: `eval('sideEffect()');`,
    },
    {
      ...closedFixture,
      fallbackTemplate: 'import(${specifier})',
    },
    {
      ...closedFixture,
      fallbackTemplate: 'import(${JSON.stringify(otherSpecifier)})',
    },
  ];
  for (const fixture of mutations) {
    const source = adapterSource(fixture);
    expect(specialize(source)).toBe(source);
    expect(violatesBoundary(source)).toBe(true);
  }
});

test('refuses shadowed evaluator capability bindings', () => {
  const adapter = adapterSource(closedFixture);
  const ambientViolation = `globalThis.Function('return sourceText')();`;
  const shadowed: string[] = [];
  for (const binding of ['Function', 'eval', 'JSON']) {
    shadowed.push(
      `function wrapper(${binding}) { ${adapter} }\n${ambientViolation}`,
      `function wrapper() { const ${binding} = localRuntime.${binding}; ${adapter} }\n${ambientViolation}`,
      `import { capability as ${binding} } from './runtime';\n${adapter}\n${ambientViolation}`,
    );
  }
  for (const binding of ['eval', 'JSON']) {
    shadowed.push(
      `${adapter.replace('} catch {', `} catch (${binding}) {`)}\n${ambientViolation}`,
    );
  }
  for (const source of shadowed) {
    expect(specialize(source)).toBe(source);
    expect(violatesBoundary(source)).toBe(true);
  }
});

test('projects only closed process capability views used by the adapter', () => {
  const source = `
function runtimeFacts(): readonly string[] {
  const nodeProcess = (
    globalThis as {
      process?: {
        cwd?: () => string;
        env?: Record<string, string>;
        versions?: { node?: string };
      };
    }
  ).process;
  return [
    nodeProcess?.versions?.node ?? '',
    nodeProcess?.env?.NOOK_COMPANION_WASM_PATH?.trim() ?? '',
    nodeProcess?.cwd?.() ?? '',
  ];
}
`;
  const specialized = specialize(source);
  expect(specialized).not.toBe(source);
  expect(specialized).not.toContain('globalThis');
  expect(specialized).not.toContain('nodeProcess');
  expect(violatesBoundary(specialized)).toBe(false);
});

test('orders nested process-view replacements without erasing evaluators', () => {
  const source = `
function inspectRuntime(): void {
  function readWorkingDirectory(): void {
    consume(nodeProcess?.cwd?.());
  }
  const nodeProcess = (
    globalThis as { process?: { cwd?: () => string } }
  ).process;
  eval(sourceText);
  readWorkingDirectory();
}
`;
  const specialized = specialize(source);
  expect(specialized).toContain('eval(sourceText)');
  expect(violatesBoundary(specialized)).toBe(true);
});

test('refuses process views that retain loader-capable authority', () => {
  const unsafeUses = [
    'return nodeProcess;',
    'return nodeProcess.mainModule;',
    `return nodeProcess.getBuiltinModule('module');`,
    `return nodeProcess.env[environmentName];`,
    `consume(nodeProcess.cwd);`,
  ];
  for (const use of unsafeUses) {
    const source = `
function unsafeProcessView(): runtime.Process {
  const nodeProcess = (globalThis as { process?: runtime.Process }).process;
  ${use}
}
`;
    expect(specialize(source), use).toBe(source);
    expect(violatesBoundary(source), use).toBe(true);
  }
});

test('projects only finite named Node process capabilities', () => {
  const source = `import { chdir as changeDirectory } from 'node:process';
changeDirectory('/workspace');`;
  const specialized = specialize(source);
  expect(specialized).not.toBe(source);
  expect(specialized).not.toContain("from 'node:process'");
  expect(specialized).toContain(
    'const changeDirectory = safeProcessChangeDirectory;',
  );
  expect(violatesBoundary(specialized)).toBe(false);
});

test('refuses loader-capable Node process imports', () => {
  for (const source of [
    `import process from 'node:process'; consume(process);`,
    `import * as processModule from 'node:process'; consume(processModule);`,
    `import { getBuiltinModule } from 'node:process'; getBuiltinModule('module');`,
    `import { chdir, getBuiltinModule } from 'node:process'; consume(chdir, getBuiltinModule);`,
  ]) {
    expect(specialize(source)).toBe(source);
    expect(violatesBoundary(source)).toBe(true);
  }
});
