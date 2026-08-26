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

export type ExecutableScriptInspection = {
  readonly path: string;
  readonly roots: ReadonlySet<string>;
  readonly shellPolicy: ShellExecutablePolicy;
  readonly source: string;
  readonly sources: ReadonlyMap<string, string>;
};

export enum ShellExecutablePolicy {
  Reject = 'reject',
  TrackedConfiguration = 'tracked-configuration',
}

const TYPESCRIPT_JAVASCRIPT_SOURCE = /\.(?:[cm]?[jt]sx?)$/u;
const TYPESCRIPT_SOURCE = /\.(?:cts|mts|ts|tsx)$/u;
const SHELL_SOURCE = /\.sh$/u;
type BoundaryTranspilerOptions = { readonly loader: 'tsx' };
const boundaryTranspilerOptions: BoundaryTranspilerOptions = { loader: 'tsx' };
const BOUNDARY_TRANSPILER = new Bun.Transpiler(boundaryTranspilerOptions);

export function executableScriptViolatesBoundary(
  inspection: ExecutableScriptInspection,
): boolean {
  if (SHELL_SOURCE.test(inspection.path)) {
    return (
      inspection.shellPolicy === ShellExecutablePolicy.Reject ||
      referencesSkillProvider(inspection.source)
    );
  }
  const extension = posix.extname(inspection.path);
  if (extension.length > 0 && !TYPESCRIPT_JAVASCRIPT_SOURCE.test(extension)) {
    return true;
  }
  const normalizedSource = inspection.path.endsWith('.cjs')
    ? inspection.source.replace(/\bmodule\.exports\b/gu, 'commonJsExports')
    : inspection.source.replace(
        /\bglobalThis\.fetch\?\.bind\(globalThis\)/gu,
        'globalThis.fetch',
      );
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
  const runtimeSource = TYPESCRIPT_SOURCE.test(inspection.path)
    ? BOUNDARY_TRANSPILER.transformSync(boundedSource)
    : boundedSource;
  const sourceInspection = {
    allowUnprovenComputedDataAccess: true as const,
    filePath:
      extension.length === 0 || TYPESCRIPT_SOURCE.test(inspection.path)
        ? `${inspection.path}.js`
        : inspection.path,
    source: runtimeSource,
  };
  return (
    referencesSkillProvider(runtimeSource) ||
    violatesSkillProviderBoundary(sourceInspection)
  );
}
