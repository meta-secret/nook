import { join, posix } from 'node:path';
import { expect, test } from 'bun:test';
import {
  referencesSkillProvider as specifierReferencesSkillProvider,
  violatesSkillProviderBoundary,
} from './skill-provider-boundary.test.ts';
import {
  executableScriptViolatesBoundary,
  ShellExecutablePolicy,
  shellExecutableLaunchesUnprovenScript,
} from './skill-provider-executable-script.ts';
import { repositorySubprocessEntrypoints } from './skill-provider-subprocess.ts';
import { PRODUCTION_SOURCE_EXTENSIONS } from './skill-provider-type-context.ts';

type RuntimeDependencyGraphInspection = {
  readonly executablePaths: ReadonlySet<string>;
  readonly roots: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
  readonly symlinkPaths: ReadonlySet<string>;
};

type RuntimeDependencyResolution = {
  readonly importer: string;
  readonly sources: ReadonlyMap<string, string>;
  readonly specifier: string;
};

type RuntimeDependencyEdge = {
  readonly dependency: string;
  readonly importer: string;
};

type RuntimeDependencyListRequest = {
  readonly importer: string;
  readonly sources: ReadonlyMap<string, string>;
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

type TrackedRepositoryInventory = {
  readonly executablePaths: ReadonlySet<string>;
  readonly paths: readonly string[];
  readonly symlinkPaths: ReadonlySet<string>;
};

type RepositoryPackageDocument = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly name?: string;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
};

const REPOSITORY_ROOT = join(import.meta.dir, '../../..');
const LOOM_PRODUCTION_PREFIX = 'agentic-ai/loom/src/';
const CORTEX_AUDIT = `${LOOM_PRODUCTION_PREFIX}commands/cortex-audit.ts`;
const LOOM_ARTICLE_ADAPTER = `${LOOM_PRODUCTION_PREFIX}lib/cortex-article-structure.ts`;
const ARTICLE_PROVIDER_PREFIX = 'agentic-ai/skills/cortex-article-structure/';
const ARTICLE_APPLICATION = `${ARTICLE_PROVIDER_PREFIX}src/application.ts`;
const ARTICLE_DOMAIN = `${ARTICLE_PROVIDER_PREFIX}src/domain.ts`;
const EXECUTABLE_SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/u;
const SUBPROCESS_SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|sh)$/u;
const RUNTIME_SOURCE_SUFFIXES = [
  '',
  ...'ts tsx mts cts js jsx mjs cjs'.split(' ').map((value) => `.${value}`),
] as const;
const transpilerOptions: RuntimeTranspilerOptions = { loader: 'tsx' };
const RUNTIME_IMPORT_SCANNER = new Bun.Transpiler(transpilerOptions);

function trackedRepositoryInventory(): TrackedRepositoryInventory {
  const spawnOptions: TrackedSourcesSpawnOptions = {
    cmd: ['git', 'ls-files', '--stage', '-z'],
    cwd: REPOSITORY_ROOT,
    stderr: 'pipe',
    stdout: 'pipe',
  };
  const result = Bun.spawnSync(spawnOptions);
  if (result.exitCode !== 0) {
    throw new Error(`Unable to enumerate tracked sources: ${result.stderr}`);
  }
  return parseTrackedRepositoryInventory(result.stdout.toString());
}

function parseTrackedRepositoryInventory(
  source: string,
): TrackedRepositoryInventory {
  const paths: string[] = [];
  const executablePaths = new Set<string>();
  const symlinkPaths = new Set<string>();
  for (const entry of source.split('\0').filter(Boolean)) {
    const separator = entry.indexOf('\t');
    if (separator < 0) throw new Error('Tracked source record has no path');
    const metadata = entry.slice(0, separator);
    const path = entry.slice(separator + 1);
    paths.push(path);
    if (metadata.startsWith('120000 ')) symlinkPaths.add(path);
    if (metadata.startsWith('100755 ')) executablePaths.add(path);
  }
  return { executablePaths, paths, symlinkPaths };
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
    if (inspection.symlinkPaths.has(path)) {
      violations.push(path);
      continue;
    }
    const extensionless = posix.extname(path).length === 0;
    if (!SUBPROCESS_SOURCE_EXTENSION.test(path) && !extensionless) {
      violations.push(path);
      continue;
    }
    const source = inspection.sources.get(path);
    if (typeof source !== 'string') {
      violations.push(path);
      continue;
    }
    const sourceBody = source.replace(/^#![^\n]*(?:\n|$)/u, '');
    const boundaryInspection = {
      path,
      roots: new Set(inspection.roots),
      shellPolicy: ShellExecutablePolicy.TrackedConfiguration,
      source: sourceBody,
      sources: inspection.sources,
    };
    if (
      (path !== LOOM_ARTICLE_ADAPTER &&
        executableScriptViolatesBoundary(boundaryInspection)) ||
      (path.endsWith('.sh') &&
        shellExecutableLaunchesUnprovenScript(sourceBody))
    ) {
      violations.push(path);
      continue;
    }
    const importedModules =
      EXECUTABLE_SOURCE_EXTENSION.test(path) || extensionless
        ? RUNTIME_IMPORT_SCANNER.scanImports(sourceBody)
        : [];
    for (const imported of importedModules) {
      const resolution: RuntimeDependencyResolution = {
        importer: path,
        sources: inspection.sources,
        specifier: imported.path,
      };
      const dependency = resolveRuntimeDependency(resolution);
      const providerReference =
        specifierReferencesSkillProvider(imported.path) ||
        referencesSkillProvider(resolution);
      const edge: RuntimeDependencyEdge | false =
        dependency === false ? false : { dependency, importer: path };
      if (
        (providerReference && dependency === false) ||
        (edge !== false &&
          isSkillApplicationDependency(edge.dependency) &&
          !isAuthorizedSkillApplicationEdge(edge))
      ) {
        violations.push(path);
      } else if (
        dependency !== false &&
        (EXECUTABLE_SOURCE_EXTENSION.test(dependency) ||
          posix.extname(dependency) === '')
      ) {
        pending.push(dependency);
      } else if (
        dependency === false &&
        (imported.path.startsWith('.') ||
          isRepositoryBackedSpecifier(resolution))
      ) {
        violations.push(path);
      }
    }
    const entrypointInspection = {
      executablePaths: inspection.executablePaths,
      importer: path,
      source: sourceBody,
      sources: inspection.sources,
    };
    const entrypoints = repositorySubprocessEntrypoints(entrypointInspection);
    for (const dependency of entrypoints.paths) {
      const edge: RuntimeDependencyEdge = { dependency, importer: path };
      if (
        isSkillApplicationDependency(dependency) &&
        !isAuthorizedSkillApplicationEdge(edge)
      ) {
        violations.push(path);
      } else {
        pending.push(dependency);
      }
    }
    if (entrypoints.unresolved) violations.push(path);
  }
  return [...new Set(violations)].sort();
}

function isSkillApplicationDependency(path: string): boolean {
  return (
    path === LOOM_ARTICLE_ADAPTER || path.startsWith(ARTICLE_PROVIDER_PREFIX)
  );
}

function isAuthorizedSkillApplicationEdge(
  edge: RuntimeDependencyEdge,
): boolean {
  if (edge.dependency === LOOM_ARTICLE_ADAPTER) {
    return edge.importer === CORTEX_AUDIT;
  }
  if (edge.importer === LOOM_ARTICLE_ADAPTER) {
    return (
      edge.dependency === ARTICLE_APPLICATION ||
      edge.dependency === ARTICLE_DOMAIN
    );
  }
  return (
    edge.importer.startsWith(ARTICLE_PROVIDER_PREFIX) &&
    edge.dependency.startsWith(ARTICLE_PROVIDER_PREFIX)
  );
}

function skillApplicationDependencies(
  request: RuntimeDependencyListRequest,
): readonly string[] {
  const source = request.sources.get(request.importer) ?? '';
  const dependencies = new Set<string>();
  for (const imported of RUNTIME_IMPORT_SCANNER.scanImports(source)) {
    const resolution: RuntimeDependencyResolution = {
      importer: request.importer,
      sources: request.sources,
      specifier: imported.path,
    };
    const dependency = resolveRuntimeDependency(resolution);
    if (dependency !== false && isSkillApplicationDependency(dependency)) {
      dependencies.add(dependency);
    }
  }
  return [...dependencies].sort();
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

function isRepositoryBackedSpecifier(
  resolution: RuntimeDependencyResolution,
): boolean {
  const specifier = resolution.specifier;
  if (specifier.startsWith('#') || specifier.startsWith('file:')) return true;
  if (specifier.startsWith('.') || specifier.startsWith('node:')) return false;
  const segments = specifier.split('/');
  const packageName = specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : (segments[0] ?? '');
  for (const [path, source] of resolution.sources) {
    if (!path.endsWith('package.json') || source.length === 0) continue;
    let document: RepositoryPackageDocument;
    try {
      document = JSON.parse(source) as RepositoryPackageDocument;
    } catch {
      continue;
    }
    if (document.name === packageName) return true;
    for (const dependencies of [
      document.dependencies,
      document.devDependencies,
      document.optionalDependencies,
    ]) {
      const dependency = dependencies?.[packageName] ?? false;
      if (
        dependency !== false &&
        (dependency.startsWith('file:') || dependency.startsWith('workspace:'))
      ) {
        return true;
      }
    }
  }
  return false;
}

function referencesSkillProvider(
  resolution: RuntimeDependencyResolution,
): boolean {
  const path = normalizedDependencyPath(resolution);
  return (
    path === '.agents/skills' ||
    path.startsWith('.agents/skills/') ||
    path === 'agentic-ai/skills' ||
    path.startsWith('agentic-ai/skills/')
  );
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
    [
      'agentic-ai/loom/src/cli.ts',
      "import '../../provider-facade'; import './extensionless';",
    ],
    ['agentic-ai/loom/src/extensionless', 'export const safe = true;'],
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
    executablePaths: new Set<string>(),
    roots: ['agentic-ai/loom/src/cli.ts', 'agentic-ai/loom/src/unsafe.ts'],
    sources,
    symlinkPaths: new Set<string>(),
  };
  expect(runtimeDependencyViolations(inspection)).toEqual([
    'agentic-ai/loom/src/unsafe.ts',
    'agentic-ai/nested/index.ts',
  ]);
});

test('fails closed for repository-backed module aliases', () => {
  expect(PRODUCTION_SOURCE_EXTENSIONS).toEqual([
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
  ]);
  const sources = new Map<string, string>([
    ['agentic-ai/loom/src/cli.js', ''],
    [
      'agentic-ai/loom/package.json',
      '{"dependencies":{"local-provider":"file:../local-provider"}}',
    ],
  ]);
  for (const specifier of ['local-provider', '#provider']) {
    sources.set('agentic-ai/loom/src/cli.js', `import '${specifier}';`);
    const inspection: RuntimeDependencyGraphInspection = {
      executablePaths: new Set<string>(),
      roots: ['agentic-ai/loom/src/cli.js'],
      sources,
      symlinkPaths: new Set<string>(),
    };
    expect(runtimeDependencyViolations(inspection), specifier).toEqual([
      'agentic-ai/loom/src/cli.js',
    ]);
  }
});

test('production Loom reaches providers only through its semantic adapter', async () => {
  const inventory = trackedRepositoryInventory();
  const trackedPaths = inventory.paths;
  const roots = trackedPaths
    .filter(
      (path) =>
        path.startsWith(LOOM_PRODUCTION_PREFIX) &&
        EXECUTABLE_SOURCE_EXTENSION.test(path),
    )
    .sort();
  const sources = new Map<string, string>();
  for (const path of trackedPaths) {
    const source =
      !inventory.symlinkPaths.has(path) &&
      (SUBPROCESS_SOURCE_EXTENSION.test(path) ||
        posix.extname(path) === '' ||
        path.endsWith('package.json'))
        ? await Bun.file(join(REPOSITORY_ROOT, path)).text()
        : '';
    sources.set(path, source);
  }
  const inspection: RuntimeDependencyGraphInspection = {
    executablePaths: inventory.executablePaths,
    roots,
    sources,
    symlinkPaths: inventory.symlinkPaths,
  };
  const auditDependenciesRequest: RuntimeDependencyListRequest = {
    importer: CORTEX_AUDIT,
    sources,
  };
  expect(skillApplicationDependencies(auditDependenciesRequest)).toEqual([
    LOOM_ARTICLE_ADAPTER,
  ]);
  const adapterDependenciesRequest: RuntimeDependencyListRequest = {
    importer: LOOM_ARTICLE_ADAPTER,
    sources,
  };
  expect(skillApplicationDependencies(adapterDependenciesRequest)).toEqual([
    ARTICLE_APPLICATION,
    ARTICLE_DOMAIN,
  ]);
  expect(runtimeDependencyViolations(inspection)).toEqual([]);
});

test('rejects every alternate application consumer edge', () => {
  const canonical = new Map<string, string>([
    [CORTEX_AUDIT, "import '../lib/cortex-article-structure.ts';"],
    [
      LOOM_ARTICLE_ADAPTER,
      "import '../../../skills/cortex-article-structure/src/application.ts'; import '../../../skills/cortex-article-structure/src/domain.ts';",
    ],
    [ARTICLE_APPLICATION, "import './audit.ts';"],
    [`${ARTICLE_PROVIDER_PREFIX}src/audit.ts`, 'export const audit = true;'],
    [ARTICLE_DOMAIN, 'export const domain = true;'],
  ]);
  for (const [root, source] of [
    [
      'agentic-ai/loom/src/alternate.ts',
      "import './lib/cortex-article-structure.ts';",
    ],
    ['scripts/alternate.ts', `import '../${ARTICLE_APPLICATION}';`],
    [
      '.github/actions/audit/index.js',
      `import '../../../${LOOM_ARTICLE_ADAPTER}';`,
    ],
    ['scripts/alternate.sh', `#!/bin/sh\nbun ../${LOOM_ARTICLE_ADAPTER}`],
  ] as const) {
    const sources = new Map(canonical);
    sources.set(root, source);
    const inspection: RuntimeDependencyGraphInspection = {
      executablePaths: new Set<string>(),
      roots: [root],
      sources,
      symlinkPaths: new Set<string>(),
    };
    expect(runtimeDependencyViolations(inspection), root).toContain(root);
  }
});

test('rejects every reachable tracked symlink facade', () => {
  const inventory = parseTrackedRepositoryInventory(
    [
      '100644 aaaa 0\tagentic-ai/loom/src/cli.ts',
      '120000 bbbb 0\tagentic-ai/loom/src/provider-facade.ts',
      '120000 dddd 0\tagentic-ai/loom/src/provider-facade',
      '120000 cccc 0\tdocs/provider-facade.md',
    ].join('\0'),
  );
  expect(inventory.paths).toContain('agentic-ai/loom/src/provider-facade.ts');
  const sources = new Map<string, string>([
    [
      'agentic-ai/loom/src/cli.ts',
      "import './provider-facade.ts'; import './provider-facade';",
    ],
    ['agentic-ai/loom/src/provider-facade', 'export const safe = true;'],
    ['agentic-ai/loom/src/provider-facade.ts', 'export const safe = true;'],
  ]);
  const inspection: RuntimeDependencyGraphInspection = {
    executablePaths: inventory.executablePaths,
    roots: ['agentic-ai/loom/src/cli.ts'],
    sources,
    symlinkPaths: inventory.symlinkPaths,
  };
  expect(runtimeDependencyViolations(inspection)).toEqual([
    'agentic-ai/loom/src/provider-facade',
    'agentic-ai/loom/src/provider-facade.ts',
  ]);
});

test('follows repository subprocess entrypoints and fails closed', () => {
  for (const launch of [
    "Bun.spawn(['bun', './facade.ts']);",
    "Bun.spawnSync({ cmd: ['node', './facade.ts'] });",
    "const request = { command: 'bun', args: ['./facade.ts'] }; runCommand(request);",
    "import { spawn as launch } from 'node:child_process'; launch('bun', ['./facade.ts']);",
    "import * as child from 'node:child_process'; const alias = child; alias.spawnSync('node', ['./facade.ts']);",
    "const child = require('child_process'); const { execFile: launch } = child; launch('bun', ['./facade.ts']);",
    "import child = require('node:child_process'); const launch = child.execFileSync; launch('node', ['./facade.ts']);",
    "import { fork as launch } from 'node:child_process'; launch('./facade.ts');",
  ]) {
    const sources = new Map<string, string>([
      ['agentic-ai/loom/src/cli.ts', launch],
      [
        'agentic-ai/loom/src/facade.ts',
        "import '../../../.agents/skills/provider/src/audit.ts';",
      ],
    ]);
    const inspection: RuntimeDependencyGraphInspection = {
      executablePaths: new Set<string>(),
      roots: ['agentic-ai/loom/src/cli.ts'],
      sources,
      symlinkPaths: new Set<string>(),
    };
    expect(runtimeDependencyViolations(inspection), launch).toContain(
      'agentic-ai/loom/src/facade.ts',
    );
  }
  const packageScriptSources = new Map<string, string>([
    [
      'agentic-ai/loom/src/cli.ts',
      `const request = {
  command: 'bun',
  args: ['run', '--cwd', 'agentic-ai/loom', 'loom', '--', '--default', 'prePush'],
};
      runCommand(request);`,
    ],
    [
      'agentic-ai/loom/package.json',
      '{"scripts":{"loom":"bun run src/cli.ts"}}',
    ],
  ]);
  const packageScriptInspection: RuntimeDependencyGraphInspection = {
    executablePaths: new Set<string>(),
    roots: ['agentic-ai/loom/src/cli.ts'],
    sources: packageScriptSources,
    symlinkPaths: new Set<string>(),
  };
  expect(runtimeDependencyViolations(packageScriptInspection)).toEqual([]);

  for (const launch of [
    `function launch(scriptPath: string) {
  runCommand({ command: 'bun', args: [scriptPath] });
}
launch('./facade.ts');`,
    `import { exec } from 'node:child_process';
exec('node ./safe.ts && node ./facade.ts');`,
    `import { exec } from 'node:child_process';
exec('node --eval import(./facade.ts)');`,
    `Bun.spawn(['bun', '--cwd', 'tools', './facade.ts']);`,
    `runCommand({ command: 'bun', args: ['run', 'provider-task'] });`,
    `const scriptPath = './safe.ts';
function launch(scriptPath: string) {
  Bun.spawn(['bun', scriptPath]);
}
launch('./facade.ts');`,
    `function launch(runtime: string) {
  Bun.spawn([runtime, './facade.ts']);
}
launch('bun');`,
    `let script = './safe.ts';
script = './facade.ts';
Bun.spawn(['bun', script]);`,
    `const script = 0 ? './safe.ts' : './facade.ts';
Bun.spawn(['bun', script]);`,
    `const args = ['bun', './safe.ts'];
args[1] = './facade.ts';
Bun.spawn(args);`,
    `const request = { command: 'bun', args: ['./safe.ts'] };
request.args.push('./facade.ts');
runCommand(request);`,
    `const args = ['bun', './safe.ts'];
const alias = args;
alias[1] = './facade.ts';
Bun.spawn(args);`,
    `const request = { command: 'bun', args: ['./safe.ts'] };
const alias = request.args;
alias.push('./facade.ts');
runCommand(request);`,
  ]) {
    const failClosedSources = new Map<string, string>([
      ['agentic-ai/loom/src/cli.ts', launch],
      ['agentic-ai/loom/src/safe.ts', 'export const safe = true;'],
      ['agentic-ai/loom/src/facade.ts', 'export const safe = true;'],
      ['tools/facade.ts', "import '../.agents/skills/provider/src/audit.ts';"],
    ]);
    const failClosedInspection: RuntimeDependencyGraphInspection = {
      executablePaths: new Set<string>(),
      roots: ['agentic-ai/loom/src/cli.ts'],
      sources: failClosedSources,
      symlinkPaths: new Set<string>(),
    };
    expect(
      runtimeDependencyViolations(failClosedInspection),
      launch,
    ).not.toEqual([]);
  }

  const extensionlessRuntimeSources = new Map<string, string>([
    ['agentic-ai/loom/src/cli.ts', `Bun.spawn(['bun', 'runner']);`],
    ['runner', "import './.agents/skills/provider/src/audit.ts';"],
  ]);
  const extensionlessRuntimeInspection: RuntimeDependencyGraphInspection = {
    executablePaths: new Set<string>(['runner']),
    roots: ['agentic-ai/loom/src/cli.ts'],
    sources: extensionlessRuntimeSources,
    symlinkPaths: new Set<string>(),
  };
  expect(runtimeDependencyViolations(extensionlessRuntimeInspection)).toEqual([
    'runner',
  ]);

  const sources = new Map<string, string>([
    ['agentic-ai/loom/src/cli.ts', "Bun.spawn(['bun', './missing.ts']);"],
  ]);
  const inspection: RuntimeDependencyGraphInspection = {
    executablePaths: new Set<string>(),
    roots: ['agentic-ai/loom/src/cli.ts'],
    sources,
    symlinkPaths: new Set<string>(),
  };
  expect(runtimeDependencyViolations(inspection)).toEqual([
    'agentic-ai/loom/src/cli.ts',
  ]);
});

test('checks external and extensionless subprocess scripts as executable sources', () => {
  for (const facadeSource of [
    'eval(source);',
    'await import(modulePath);',
    "import '../.agents/skills/provider/src/audit.ts';",
  ]) {
    const sources = new Map<string, string>([
      [
        'agentic-ai/loom/src/cli.ts',
        "import { spawn } from 'node:child_process'; spawn('bun', ['../../../tools/facade.ts']);",
      ],
      ['tools/facade.ts', facadeSource],
    ]);
    const inspection: RuntimeDependencyGraphInspection = {
      executablePaths: new Set<string>(),
      roots: ['agentic-ai/loom/src/cli.ts'],
      sources,
      symlinkPaths: new Set<string>(),
    };
    expect(runtimeDependencyViolations(inspection), facadeSource).toContain(
      'tools/facade.ts',
    );
  }

  const extensionlessSources = new Map<string, string>([
    [
      'agentic-ai/loom/src/cli.ts',
      "import { execFile } from 'node:child_process'; execFile('../../../tools/runner');",
    ],
    ['tools/runner', 'eval(source);'],
  ]);
  const extensionlessInspection: RuntimeDependencyGraphInspection = {
    executablePaths: new Set<string>(['tools/runner']),
    roots: ['agentic-ai/loom/src/cli.ts'],
    sources: extensionlessSources,
    symlinkPaths: new Set<string>(),
  };
  expect(runtimeDependencyViolations(extensionlessInspection)).toEqual([
    'tools/runner',
  ]);

  const nonExecutableInspection: RuntimeDependencyGraphInspection = {
    executablePaths: new Set<string>(),
    roots: ['agentic-ai/loom/src/cli.ts'],
    sources: extensionlessSources,
    symlinkPaths: new Set<string>(),
  };
  expect(runtimeDependencyViolations(nonExecutableInspection)).toEqual([
    'agentic-ai/loom/src/cli.ts',
  ]);

  const shellSources = new Map<string, string>([
    [
      'agentic-ai/loom/src/cli.ts',
      "import { execFile } from 'node:child_process'; execFile('../../../tools/facade.sh');",
    ],
    ['tools/facade.sh', '#!/bin/sh\nexit 0'],
  ]);
  const shellInspection: RuntimeDependencyGraphInspection = {
    executablePaths: new Set<string>(),
    roots: ['agentic-ai/loom/src/cli.ts'],
    sources: shellSources,
    symlinkPaths: new Set<string>(),
  };
  expect(runtimeDependencyViolations(shellInspection)).toEqual([]);

  shellSources.set(
    'tools/facade.sh',
    '#!/bin/sh\nbun .agents/skills/provider/src/audit.ts',
  );
  expect(runtimeDependencyViolations(shellInspection)).toEqual([
    'tools/facade.sh',
  ]);

  shellSources.set('tools/facade.sh', '#!/bin/sh\nbun ../nested.ts');
  shellSources.set(
    'nested.ts',
    "import './.agents/skills/provider/src/audit.ts';",
  );
  expect(runtimeDependencyViolations(shellInspection)).toEqual([
    'tools/facade.sh',
  ]);

  shellSources.set('tools/facade.sh', '#!/bin/sh\nbun ../runner');
  shellSources.set(
    'runner',
    "import './.agents/skills/provider/src/audit.ts';",
  );
  expect(runtimeDependencyViolations(shellInspection)).toEqual([
    'tools/facade.sh',
  ]);

  for (const launch of ['MODE=x bun ../runner', 'exec bun ../runner']) {
    shellSources.set('tools/facade.sh', `#!/bin/sh\n${launch}`);
    expect(runtimeDependencyViolations(shellInspection), launch).toEqual([
      'tools/facade.sh',
    ]);
  }
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
    'const fn = () => {}; const key = computeKey(); ((fn as never)[key])(source);',
    'const fn = () => {}; const key = computeKey(); ((fn as Record<string, string>)[key])(source);',
    'declare function computeKey(): string; declare const source: string; const fn = () => {}; const masked = fn as never as Record<string, string>; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    'const fn = () => {}; const [masked] = [fn as never as Record<string, string>]; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    'const fn = () => {}; const { masked } = { masked: fn as never as Record<string, string> }; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    'const fn = () => {}; const holder = { masked: fn as never as Record<string, string> }; const { masked } = holder; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    'const fn = () => {}; const [{ masked }] = [{ masked: fn as never as Record<string, string> }]; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    'const fn = () => {}; const [masked = fn as never as Record<string, string>] = []; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    'const fn = () => {}; const { masked = fn as never as Record<string, string> } = {}; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    "import { fn } from './fn.ts'; const key = computeKey(); const holder = { evaluator: fn[key] }; holder.evaluator(source)();",
    "import * as mod from './fn.ts'; const key = computeKey(); const holder = [mod[key]]; holder.at(0)(source)();",
    "import { fn } from './fn.ts'; const key = computeKey(); const [evaluator] = [fn[key]]; evaluator(source)();",
    "import * as mod from './fn.ts'; const key = computeKey(); function evaluator() { return mod[key]; } evaluator()(source)();",
    "import { fn } from './fn.ts'; const registry: Record<string, (source: string) => Function> = { evaluator: fn }; const key = computeKey(); registry[key](source)();",
    "const { getOwnPropertyDescriptor: get } = Object; get(() => {}, 'constructor')!.value(source)();",
    "const { get } = Reflect; get(() => {}, 'constructor')(source)();",
    "globalThis.Reflect.get(() => {}, 'constructor')(source)();",
    "const O = globalThis['Object']; O.getOwnPropertyDescriptor(() => {}, 'constructor')!.value(source)();",
    "const R = global[`Reflect`]; R.get(() => {}, 'constructor')(source)();",
    "globalThis.global['globalThis'].Reflect.get(() => {}, 'constructor')(source)();",
    "const key = 'Object'; const O = globalThis[key]; O.getOwnPropertyDescriptor(() => {}, 'constructor')!.value(source)();",
  ];
  for (const source of sources) {
    const inspection = {
      filePath: 'dynamic-evaluator.mts',
      source,
    };
    expect(violatesSkillProviderBoundary(inspection)).toBe(true);
  }
  for (const source of [
    'export {}; const eval = (value: string) => value;',
    'export {}; class Function {};',
    'export {}; class Function {}; new Function();',
    "const values = ['safe']; const key = computeKey(); values[key];",
    "const values = ['safe']; const key = computeKey(); (values as never)[key];",
    "const values = ['safe']; const key = computeKey(); (values as Record<string, string>)[key];",
    "const record = { label: 'safe' }; const key = computeKey(); (record as Record<string, string>)[key];",
    "const values = ['safe']; const masked = values as never as Record<string, string>; const key = computeKey(); masked[key];",
    "const record = { label: 'safe' }; const masked = record as Record<string, string>; const key = computeKey(); masked[key];",
    "const values = ['safe']; const [masked] = [values as never as Record<string, string>]; const key = computeKey(); masked[key];",
    "const record = { label: 'safe' }; const { masked } = { masked: record as Record<string, string> }; const key = computeKey(); masked[key];",
    "const record = { label: 'safe' }; const holder = { masked: record as Record<string, string> }; const { masked } = holder; const key = computeKey(); masked[key];",
    "const record = { label: 'safe' }; const [{ masked }] = [{ masked: record as Record<string, string> }]; const key = computeKey(); masked[key];",
    "const values = ['safe']; const [masked = values as never as Record<string, string>] = []; const key = computeKey(); masked[key];",
    "const record = { label: 'safe' }; const { masked = record as Record<string, string> } = {}; const key = computeKey(); masked[key];",
  ]) {
    const localInspection = { filePath: 'local-evaluator.ts', source };
    expect(violatesSkillProviderBoundary(localInspection), source).toBe(false);
  }
});
