import { posix } from 'node:path';
import {
  referencesSkillProvider,
  violatesSkillProviderBoundary,
} from './skill-provider-boundary.test.ts';
import {
  specializeBoundedLocalDataLoaders,
  specializeBoundedPackageLoaders,
  specializeProvenGeneratedArtifactLoader,
} from './skill-provider-bounded-package-loader.ts';
import { specializeClosedFiniteNodeLoaders } from './skill-provider-finite-node-loader.ts';

export type ExecutableScriptInspection = {
  readonly path: string;
  readonly roots: ReadonlySet<string>;
  readonly shellPolicy: ShellExecutablePolicy;
  readonly source: string;
  readonly sources: ReadonlyMap<string, string>;
};

export type ExecutableProviderReferenceInspection = {
  readonly path: string;
  readonly source: string;
};

export type ConfigurationScriptGraph = {
  readonly executablePaths: ReadonlySet<string>;
  readonly roots: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
  readonly symlinkPaths: ReadonlySet<string>;
};

export type ConfigurationReferenceInspection = {
  readonly importer: string;
  readonly source: string;
};

export enum ShellExecutablePolicy {
  Reject = 'reject',
  TrackedConfiguration = 'tracked-configuration',
}

const TYPESCRIPT_JAVASCRIPT_SOURCE = /\.(?:[cm]?[jt]sx?)$/u;
const TYPESCRIPT_SOURCE = /\.(?:cts|mts|ts|tsx)$/u;
const SHELL_SOURCE = /\.sh$/u;
const SHELL_PROVIDER_EXECUTION =
  /(?:\b(?:bun|node|bash|sh|source)\s+|(?:^|[\n;&|])\s*\.\s+)["']?(?:\.\/|\.\.\/|\/)?[^\s"']*(?:\.agents\/skills|\.cortex\/(?:gizmo|shared|teams\/[^/]+)\/dynamic-skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/scripts)\//gmu;
const SHELL_REPOSITORY_SCRIPT_EXECUTION =
  /(?:^|[\n;&|])\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*)(?:(?:exec|command)\s+)?(?:bun|node|bash|sh|source|\.)\s+(?!-)[^\n;&|]+/gmu;
type BoundaryTranspilerOptions = { readonly loader: 'tsx' };
type ShellExpansionMatch = string[];
type ShellValues = ReadonlyMap<string, string | false>;
type ShellSubstitutionRequest = readonly [string, ShellValues];
const MAX_SHELL_EXPANSION_SIZE = 65_536;
const MAX_SHELL_EXPANSION_STEPS = 16;
const SHELL_VARIABLE = /\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/gmu;
const STATIC_SHELL_ASSIGNMENT = /\b([A-Za-z_]\w*)=([^\s;&|]+)/gmu;
const SHELL_UTF8_BUFFER = new Uint8Array(MAX_SHELL_EXPANSION_SIZE + 1);
const SHELL_UTF8_ENCODER = new TextEncoder();
const boundaryTranspilerOptions: BoundaryTranspilerOptions = { loader: 'tsx' };
const BOUNDARY_TRANSPILER = new Bun.Transpiler(boundaryTranspilerOptions);

export function expandStaticShellVariables(source: string): string {
  if (boundedUtf8ByteLength(source) > MAX_SHELL_EXPANSION_SIZE)
    throw new Error('Oversized static shell source.');
  const values = new Map<string, string | false>();
  for (const match of source.matchAll(STATIC_SHELL_ASSIGNMENT)) {
    const value = match[2] ?? '';
    if (value.startsWith('$(') || /^\$\{[A-Za-z_]\w*[:#%?+=-]/u.test(value))
      continue;
    values.set(match[1] ?? '', value.includes('$(') ? false : value);
  }
  for (let step = 0; step < MAX_SHELL_EXPANSION_STEPS; step += 1) {
    const expanded = boundedShellSubstitution([source, values]);
    if (expanded === source) break;
    source = expanded;
  }
  const launch = source.match(
    /\b(?:bun|node|bash|sh)[ \t]+(?:(?:run[ \t]+)?[^\s;&|]*(?:\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*)|\()|`)[^\s;&|]*|(?:[^\s;&|]+[ \t]+)+[^\s;&|]*(?:\$(?:\{[A-Za-z_]\w*\}|[A-Za-z_]\w*|\()|`)[^\s;&|]*)/u,
  );
  if (
    launch &&
    (values.has(launch[1] || launch[2] || '') ||
      /(?:\/dynamic-skills\/|\.agents\/skills\/)/u.test(launch[0]))
  )
    throw new Error('Task launch variable is unresolved.');
  return source;
}

function boundedShellSubstitution([
  input,
  values,
]: ShellSubstitutionRequest): string {
  let bytes = 0;
  let end = 0;
  for (const match of input.matchAll(SHELL_VARIABLE)) {
    const index = match.index;
    const value = values.get(match[1] || match[2] || '');
    const replacement = typeof value === 'string' ? value : match[0];
    bytes += boundedUtf8ByteLength(input.slice(end, index));
    bytes += boundedUtf8ByteLength(replacement);
    if (bytes > MAX_SHELL_EXPANSION_SIZE)
      throw new Error('Oversized static shell expansion.');
    end = index + match[0].length;
  }
  bytes += boundedUtf8ByteLength(input.slice(end));
  if (bytes > MAX_SHELL_EXPANSION_SIZE)
    throw new Error('Oversized static shell expansion.');
  return input.replace(
    SHELL_VARIABLE,
    (...match: ShellExpansionMatch) =>
      values.get(match[1] || match[2] || '') || match[0] || '',
  );
}

function boundedUtf8ByteLength(value: string): number {
  const result = SHELL_UTF8_ENCODER.encodeInto(value, SHELL_UTF8_BUFFER);
  return result.read === value.length
    ? result.written
    : MAX_SHELL_EXPANSION_SIZE + 1;
}

export function executableScriptViolatesBoundary(
  inspection: ExecutableScriptInspection,
): boolean {
  if (SHELL_SOURCE.test(inspection.path)) {
    const referenceInspection: ExecutableProviderReferenceInspection = {
      path: inspection.path,
      source: inspection.source,
    };
    return (
      inspection.shellPolicy === ShellExecutablePolicy.Reject ||
      executableSourceReferencesProvider(referenceInspection)
    );
  }
  const extension = posix.extname(inspection.path);
  if (extension.length > 0 && !TYPESCRIPT_JAVASCRIPT_SOURCE.test(extension)) {
    return true;
  }
  const commonJsSource = inspection.path.endsWith('.cjs')
    ? inspection.source
        .replace(/\bmodule\.exports\b/gu, 'commonJsExports')
        .replace(/\brequire\.main\s*===\s*module\b/gu, 'isMainModule')
    : inspection.source;
  const normalizedSource = commonJsSource
    .replace(/\bglobalThis\.fetch\?\.bind\(globalThis\)/gu, 'globalThis.fetch')
    .replace(/(["'])document\1\s+in\s+globalThis/gu, 'documentIsAvailable')
    .replace(/\[Symbol\.asyncDispose\]/gu, '.safeAsyncDispose');
  const specialization = {
    path: inspection.path,
    roots: inspection.roots,
    source: normalizedSource,
    sources: inspection.sources,
  };
  const packageBoundedSource = specializeBoundedPackageLoaders(specialization);
  const localDataSpecialization = {
    path: inspection.path,
    roots: inspection.roots,
    source: packageBoundedSource,
    sources: inspection.sources,
  };
  const localDataBoundedSource = specializeBoundedLocalDataLoaders(
    localDataSpecialization,
  );
  const artifactSpecialization = {
    path: inspection.path,
    roots: inspection.roots,
    source: localDataBoundedSource,
    sources: inspection.sources,
  };
  const boundedSource = specializeProvenGeneratedArtifactLoader(
    artifactSpecialization,
  );
  const finiteNodeLoaderInspection = {
    path: extension.length === 0 ? `${inspection.path}.js` : inspection.path,
    source: boundedSource,
  };
  const finiteNodeLoaderSource = specializeClosedFiniteNodeLoaders(
    finiteNodeLoaderInspection,
  );
  const runtimeSource = TYPESCRIPT_SOURCE.test(inspection.path)
    ? BOUNDARY_TRANSPILER.transformSync(finiteNodeLoaderSource)
    : finiteNodeLoaderSource;
  const sourceInspection = {
    allowUnprovenComputedDataAccess: true as const,
    filePath:
      extension.length === 0 || TYPESCRIPT_SOURCE.test(inspection.path)
        ? `${inspection.path}.js`
        : inspection.path,
    source: runtimeSource,
  };
  return violatesSkillProviderBoundary(sourceInspection);
}

export function executableSourceReferencesProvider(
  inspection: ExecutableProviderReferenceInspection,
): boolean {
  if (TYPESCRIPT_JAVASCRIPT_SOURCE.test(inspection.path)) {
    const importSource = inspection.source.replace(/^#![^\n]*\n/u, '');
    return BOUNDARY_TRANSPILER.scanImports(importSource).some((imported) =>
      referencesSkillProvider(imported.path),
    );
  }
  SHELL_PROVIDER_EXECUTION.lastIndex = 0;
  return SHELL_PROVIDER_EXECUTION.test(inspection.source);
}

export function shellExecutableLaunchesUnprovenScript(source: string): boolean {
  SHELL_REPOSITORY_SCRIPT_EXECUTION.lastIndex = 0;
  return SHELL_REPOSITORY_SCRIPT_EXECUTION.test(source);
}
