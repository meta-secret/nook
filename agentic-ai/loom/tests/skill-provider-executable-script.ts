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
const boundaryTranspilerOptions: BoundaryTranspilerOptions = { loader: 'tsx' };
const BOUNDARY_TRANSPILER = new Bun.Transpiler(boundaryTranspilerOptions);

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
