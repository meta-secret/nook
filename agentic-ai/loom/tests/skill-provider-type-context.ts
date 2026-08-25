import { dirname, join } from 'node:path';
import ts from 'typescript';

export type SkillProviderSourceInspection = {
  readonly filePath: string;
  readonly source: string;
};

export type SkillProviderTypeContext = {
  readonly checker: ts.TypeChecker;
  readonly sourceFile: ts.SourceFile;
};

const LOOM_ROOT = join(import.meta.dir, '..');
const REPOSITORY_ROOT = join(LOOM_ROOT, '../..');
const PRODUCTION_LOOM_PREFIX = 'agentic-ai/loom/src/';
const BOUNDARY_COMPILER_OPTIONS: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  typeRoots: [join(LOOM_ROOT, 'node_modules/@types')],
  types: ['bun'],
};
const TYPESCRIPT_LIB_ROOT = dirname(
  ts.getDefaultLibFilePath(BOUNDARY_COMPILER_OPTIONS),
);
const TYPESCRIPT_LIB_SOURCES = new Map<string, ts.SourceFile>();
const PRODUCTION_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
const PRODUCTION_SOURCE_EXCLUDES: string[] = [];
const PRODUCTION_SOURCE_INCLUDES = ['**/*'];
let productionBoundaryProgram: ts.Program | false = false;

export function createSkillProviderTypeContext(
  inspection: SkillProviderSourceInspection,
): SkillProviderTypeContext {
  if (isCurrentProductionSource(inspection)) {
    return productionSourceContext(inspection);
  }
  const sourceFile = ts.createSourceFile(
    inspection.filePath,
    inspection.source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const compilerHost = ts.createCompilerHost(BOUNDARY_COMPILER_OPTIONS);
  const hostFileExists = compilerHost.fileExists.bind(compilerHost);
  const hostGetSourceFile = compilerHost.getSourceFile.bind(compilerHost);
  const hostReadFile = compilerHost.readFile.bind(compilerHost);
  const isCompilerLib = (fileName: string): boolean =>
    dirname(fileName).startsWith(TYPESCRIPT_LIB_ROOT);
  compilerHost.fileExists = (fileName) =>
    fileName === inspection.filePath ||
    (isCompilerLib(fileName) && hostFileExists(fileName));
  compilerHost.getSourceFile = (fileName) => {
    if (fileName === inspection.filePath) return sourceFile;
    if (!isCompilerLib(fileName)) {
      throw new Error(`Unexpected boundary type dependency: ${fileName}`);
    }
    const cached = TYPESCRIPT_LIB_SOURCES.get(fileName);
    if (cached) return cached;
    const loaded = hostGetSourceFile(fileName, ts.ScriptTarget.ES2022);
    if (loaded) TYPESCRIPT_LIB_SOURCES.set(fileName, loaded);
    return loaded;
  };
  compilerHost.readFile = (fileName) =>
    fileName === inspection.filePath
      ? inspection.source
      : isCompilerLib(fileName)
        ? hostReadFile(fileName)
        : '';
  const rootNames = [inspection.filePath];
  const program = ts.createProgram(
    rootNames,
    BOUNDARY_COMPILER_OPTIONS,
    compilerHost,
  );
  return { checker: program.getTypeChecker(), sourceFile };
}

function isCurrentProductionSource(
  inspection: SkillProviderSourceInspection,
): boolean {
  if (!inspection.filePath.startsWith(PRODUCTION_LOOM_PREFIX)) return false;
  const diskSource = ts.sys.readFile(
    join(REPOSITORY_ROOT, inspection.filePath),
  );
  if (typeof diskSource !== 'string') return false;
  return normalizedSource(diskSource) === normalizedSource(inspection.source);
}

function normalizedSource(source: string): string {
  return source.replace(/^#![^\n]*(?:\n|$)/u, '');
}

function productionSourceContext(
  inspection: SkillProviderSourceInspection,
): SkillProviderTypeContext {
  if (productionBoundaryProgram === false) {
    const rootNames = ts.sys.readDirectory(
      join(LOOM_ROOT, 'src'),
      PRODUCTION_SOURCE_EXTENSIONS,
      PRODUCTION_SOURCE_EXCLUDES,
      PRODUCTION_SOURCE_INCLUDES,
    );
    productionBoundaryProgram = ts.createProgram(
      rootNames,
      BOUNDARY_COMPILER_OPTIONS,
    );
  }
  const absolutePath = join(REPOSITORY_ROOT, inspection.filePath);
  const sourceFile = productionBoundaryProgram.getSourceFile(absolutePath);
  const programSource = sourceFile ? normalizedSource(sourceFile.text) : false;
  if (!sourceFile || programSource !== normalizedSource(inspection.source)) {
    throw new Error(
      `Production boundary source is stale: ${inspection.filePath}`,
    );
  }
  return {
    checker: productionBoundaryProgram.getTypeChecker(),
    sourceFile,
  };
}
