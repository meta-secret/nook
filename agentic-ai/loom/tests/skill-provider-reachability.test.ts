import { join, posix } from 'node:path';
import { expect, test } from 'bun:test';
import { violatesSkillProviderBoundary } from './skill-provider-boundary.test.ts';

type RuntimeDependencyGraphInspection = {
  readonly roots: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
};

type RuntimeDependencyResolution = {
  readonly importer: string;
  readonly sources: ReadonlyMap<string, string>;
  readonly specifier: string;
};

type TrackedSourcesSpawnOptions = {
  readonly cmd: string[];
  readonly cwd: string;
  readonly stderr: 'pipe';
  readonly stdout: 'pipe';
};

type RuntimeTranspilerOptions = {
  readonly loader: 'tsx';
};

const REPOSITORY_ROOT = join(import.meta.dir, '../../..');
const LOOM_PRODUCTION_PREFIX = 'agentic-ai/loom/src/';
const EXECUTABLE_SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/u;
const RUNTIME_SOURCE_SUFFIXES = [
  '',
  ...'ts tsx mts cts js jsx mjs cjs'.split(' ').map((value) => `.${value}`),
] as const;
const transpilerOptions: RuntimeTranspilerOptions = { loader: 'tsx' };
const RUNTIME_IMPORT_SCANNER = new Bun.Transpiler(transpilerOptions);

function trackedRepositoryPaths(): readonly string[] {
  const spawnOptions: TrackedSourcesSpawnOptions = {
    cmd: ['git', 'ls-files', '-z'],
    cwd: REPOSITORY_ROOT,
    stderr: 'pipe',
    stdout: 'pipe',
  };
  const result = Bun.spawnSync(spawnOptions);
  if (result.exitCode !== 0) {
    throw new Error(`Unable to enumerate tracked sources: ${result.stderr}`);
  }
  return result.stdout.toString().split('\0').filter(Boolean);
}

function runtimeDependencyViolations(
  inspection: RuntimeDependencyGraphInspection,
): readonly string[] {
  const pending = [...inspection.roots];
  const visited = new Set<string>();
  const violations: string[] = [];
  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || visited.has(path)) continue;
    visited.add(path);
    const source = inspection.sources.get(path);
    if (typeof source !== 'string') {
      violations.push(path);
      continue;
    }
    const sourceBody = source.replace(/^#![^\n]*(?:\n|$)/u, '');
    const boundaryInspection = {
      filePath: path,
      source: sourceBody,
    };
    if (violatesSkillProviderBoundary(boundaryInspection)) {
      violations.push(path);
      continue;
    }
    for (const imported of RUNTIME_IMPORT_SCANNER.scanImports(sourceBody)) {
      const resolution: RuntimeDependencyResolution = {
        importer: path,
        sources: inspection.sources,
        specifier: imported.path,
      };
      if (referencesSkillProvider(resolution)) violations.push(path);
      else {
        const dependency = resolveRuntimeDependency(resolution);
        if (dependency && EXECUTABLE_SOURCE_EXTENSION.test(dependency)) {
          pending.push(dependency);
        } else if (!dependency && imported.path.startsWith('.')) {
          violations.push(path);
        }
      }
    }
  }
  return [...new Set(violations)].sort();
}

function resolveRuntimeDependency(
  resolution: RuntimeDependencyResolution,
): string | false {
  if (!resolution.specifier.startsWith('.')) return false;
  const base = normalizedDependencyPath(resolution);
  for (const suffix of RUNTIME_SOURCE_SUFFIXES) {
    const direct = `${base}${suffix}`;
    if (resolution.sources.has(direct)) return direct;
    const indexed = `${base}/index${suffix}`;
    if (resolution.sources.has(indexed)) return indexed;
  }
  return false;
}

function referencesSkillProvider(
  resolution: RuntimeDependencyResolution,
): boolean {
  const path = normalizedDependencyPath(resolution);
  return path === '.agents/skills' || path.startsWith('.agents/skills/');
}

function normalizedDependencyPath(
  resolution: RuntimeDependencyResolution,
): string {
  return posix.normalize(
    posix.join(posix.dirname(resolution.importer), resolution.specifier),
  );
}

test('follows runtime facades without scanning unrelated provider references', () => {
  const sources = new Map<string, string>([
    ['agentic-ai/loom/src/cli.ts', "import '../../provider-facade';"],
    ['agentic-ai/provider-facade.ts', "export * from './nested';"],
    [
      'agentic-ai/nested/index.ts',
      "export { audit } from '../../.agents/skills/provider/src/audit.ts';",
    ],
    [
      'agentic-ai/unrelated.ts',
      "import '../.agents/skills/provider/src/audit.ts';",
    ],
    ['agentic-ai/loom/src/unsafe.ts', "import './missing.ts';"],
  ]);
  const inspection: RuntimeDependencyGraphInspection = {
    roots: ['agentic-ai/loom/src/cli.ts', 'agentic-ai/loom/src/unsafe.ts'],
    sources,
  };
  expect(runtimeDependencyViolations(inspection)).toEqual([
    'agentic-ai/loom/src/unsafe.ts',
    'agentic-ai/nested/index.ts',
  ]);
});

test('production Loom runtime closure cannot reach dormant providers', async () => {
  const trackedPaths = trackedRepositoryPaths();
  const roots = trackedPaths
    .filter(
      (path) =>
        path.startsWith(LOOM_PRODUCTION_PREFIX) &&
        EXECUTABLE_SOURCE_EXTENSION.test(path),
    )
    .sort();
  const sources = new Map<string, string>();
  for (const path of trackedPaths) {
    const source = EXECUTABLE_SOURCE_EXTENSION.test(path)
      ? await Bun.file(join(REPOSITORY_ROOT, path)).text()
      : '';
    sources.set(path, source);
  }
  const inspection: RuntimeDependencyGraphInspection = { roots, sources };
  expect(runtimeDependencyViolations(inspection)).toEqual([]);
});

test('rejects ambient dynamic-code evaluators and constructor recovery', () => {
  const sources = [
    'const run = eval; run(source);',
    'new Function(source)();',
    'new AsyncFunction(source)();',
    'new GeneratorFunction(source)();',
    '(() => {}).constructor(source)();',
    "const key = 'constructor'; (() => {})[key](source)();",
    'const { constructor: F } = (() => {}); F(source)();',
    'globalThis[computeKey()](source);',
    'Reflect[computeKey()](() => {}, source)(source)();',
    "import { fn } from './fn.ts'; const key = computeKey(); const first = fn[key]; const second = first; second(source)();",
    "import * as mod from './fn.ts'; const key = computeKey(); let first; let second; first = mod[key]; second = first; second(source)();",
    "import { fn } from './fn.ts'; const key = computeKey(); (0, fn[key])(source)();",
    "import * as mod from './fn.ts'; const key = computeKey(); (choose ? mod[key] : fallback)(source)();",
    "import { fn } from './fn.ts'; const key = computeKey(); ((fn[key] as never)!)(source)();",
    "const { getOwnPropertyDescriptor: get } = Object; get(() => {}, 'constructor')!.value(source)();",
    "const { get } = Reflect; get(() => {}, 'constructor')(source)();",
    "globalThis.Reflect.get(() => {}, 'constructor')(source)();",
    "const O = globalThis['Object']; O.getOwnPropertyDescriptor(() => {}, 'constructor')!.value(source)();",
    "const R = global[`Reflect`]; R.get(() => {}, 'constructor')(source)();",
    "const key = 'Object'; const O = globalThis[key]; O.getOwnPropertyDescriptor(() => {}, 'constructor')!.value(source)();",
  ];
  for (const source of sources) {
    const inspection = {
      filePath: 'dynamic-evaluator.mts',
      source,
    };
    expect(violatesSkillProviderBoundary(inspection)).toBe(true);
  }
  const localInspection = {
    filePath: 'local-evaluator.ts',
    source:
      'const eval = (value: string) => value; class Function {}; eval("local"); new Function();',
  };
  expect(violatesSkillProviderBoundary(localInspection)).toBe(false);

  const shadowedAliasInspection = {
    filePath: 'shadowed-alias.ts',
    source:
      "import { fn } from './fn.ts'; const key = computeKey(); const run = fn[key]; { const run = safe; run(source); }",
  };
  expect(violatesSkillProviderBoundary(shadowedAliasInspection)).toBe(false);
});
