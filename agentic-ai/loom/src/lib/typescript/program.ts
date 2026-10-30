import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import type * as ts from 'typescript/unstable/ast';
import { API, type Checker, type Project } from 'typescript/unstable/async';
import {
  createVirtualFileSystem,
  type FileSystem,
} from 'typescript/unstable/fs';

/** How the TypeScript 7 compiler reads one in-memory source text. */
export enum TypeScriptSourceKind {
  TypeScript = 'ts',
  Tsx = 'tsx',
  JavaScript = 'js',
  Jsx = 'jsx',
  Json = 'json',
}

export type TypeScriptSourceText = {
  readonly fileName: string;
  readonly kind: TypeScriptSourceKind;
  readonly text: string;
};

/** A `tsconfig.json` `compilerOptions` value, as TypeScript 7 reads it. */
export type TypeScriptCompilerOptions = {
  readonly [option: string]: boolean | string | readonly string[];
};

/** A program over in-memory sources, isolated from the real file system. */
export type OpenTypeScriptProgramRequest = {
  readonly compilerOptions: TypeScriptCompilerOptions;
  readonly sources: readonly TypeScriptSourceText[];
};

/**
 * A program over checked-out files, resolved through the real file system.
 * Paths in `compilerOptions` and `rootFiles` must be absolute.
 */
export type OpenTypeScriptDiskProgramRequest = {
  readonly compilerOptions: TypeScriptCompilerOptions;
  readonly rootFiles: readonly string[];
};

type TypeScriptProgramParts = {
  readonly project: Project;
  /** Releases the project, and the compiler process when the program owns it. */
  readonly release: () => Promise<void>;
  readonly sourcePaths: readonly string[];
};

type TypeScriptProgramLayout = {
  readonly configPath: string;
  readonly files: Readonly<Record<string, string>>;
  readonly sourcePaths: readonly string[];
};

type LayoutTypeScriptProgramRequest = {
  /** Keep an absolute source path, or nest it under the program root. */
  readonly keepAbsolutePaths: boolean;
  readonly program: OpenTypeScriptProgramRequest;
  readonly root: string;
};

type TypeScriptSessionParts = {
  readonly api: API;
  readonly programs: { count: number };
  readonly removeFile: NonNullable<FileSystem['removeFile']>;
  readonly writeFile: NonNullable<FileSystem['writeFile']>;
};

type OpenTypeScriptProjectRequest = {
  readonly configPath: string;
  /** Called once the program, or its failed opening, is released. */
  readonly discard: () => void;
  readonly fileSystem: FileSystem | false;
  readonly sourcePaths: readonly string[];
};

const VIRTUAL_ROOT = '/loom-typescript';
const PROGRAM_CONFIG = 'tsconfig.loom.json';

const SOURCE_EXTENSIONS: Readonly<
  Record<TypeScriptSourceKind, readonly string[]>
> = {
  [TypeScriptSourceKind.TypeScript]: ['.ts', '.mts', '.cts'],
  [TypeScriptSourceKind.Tsx]: ['.tsx'],
  [TypeScriptSourceKind.JavaScript]: ['.js', '.mjs', '.cjs'],
  [TypeScriptSourceKind.Jsx]: ['.jsx'],
  [TypeScriptSourceKind.Json]: ['.json'],
};

/** Parse-only options: no libraries, no module resolution, no type roots. */
const PARSE_OPTIONS: TypeScriptCompilerOptions = {
  allowJs: true,
  noEmit: true,
  noLib: true,
  noResolve: true,
  types: [],
};

/**
 * Owns one TypeScript 7 compiler session (`typescript/unstable/async`) and the
 * single project it opens. The session runs the native compiler in a child
 * process, so every opened program must be closed.
 */
export class TypeScriptProgram {
  private constructor(private readonly parts: TypeScriptProgramParts) {}

  static async open(
    request: OpenTypeScriptProgramRequest,
  ): Promise<TypeScriptProgram> {
    const layout = TypeScriptProgram.layout({
      keepAbsolutePaths: true,
      program: request,
      root: VIRTUAL_ROOT,
    });
    return TypeScriptProgram.openProject({
      configPath: layout.configPath,
      discard: () => {},
      fileSystem: createVirtualFileSystem(layout.files),
      sourcePaths: layout.sourcePaths,
    });
  }

  static async openDisk(
    request: OpenTypeScriptDiskProgramRequest,
  ): Promise<TypeScriptProgram> {
    // The compiler reads the checked-out tree directly; only the generated
    // project file lives in a private temporary directory.
    const configDirectory = mkdtempSync(join(tmpdir(), 'loom-typescript-'));
    const configPath = join(configDirectory, PROGRAM_CONFIG);
    writeFileSync(
      configPath,
      JSON.stringify({
        compilerOptions: request.compilerOptions,
        files: request.rootFiles,
      }),
    );
    return TypeScriptProgram.openProject({
      configPath,
      discard: () => rmSync(configDirectory, { force: true, recursive: true }),
      fileSystem: false,
      sourcePaths: request.rootFiles,
    });
  }

  /** Parses sources without libraries or module resolution. */
  static async parse(
    sources: readonly TypeScriptSourceText[],
  ): Promise<readonly ts.SourceFile[]> {
    const program = await TypeScriptProgram.open({
      compilerOptions: PARSE_OPTIONS,
      sources,
    });
    try {
      return await program.sourceFiles();
    } finally {
      await program.close();
    }
  }

  /** Parses one source without libraries or module resolution. */
  static async parseOne(source: TypeScriptSourceText): Promise<ts.SourceFile> {
    const [sourceFile] = await TypeScriptProgram.parse([source]);
    if (!sourceFile) throw new Error('TypeScript did not parse the source.');
    return sourceFile;
  }

  /**
   * TypeScript 6 `ensureScriptKind`: the kind a file name implies, reading an
   * unknown extension as TypeScript.
   */
  static sourceKindOf(fileName: string): TypeScriptSourceKind {
    const kinds = [
      TypeScriptSourceKind.TypeScript,
      TypeScriptSourceKind.Tsx,
      TypeScriptSourceKind.JavaScript,
      TypeScriptSourceKind.Jsx,
      TypeScriptSourceKind.Json,
    ] as const;
    const [kind = TypeScriptSourceKind.TypeScript] = kinds.filter((candidate) =>
      SOURCE_EXTENSIONS[candidate].some((extension) =>
        fileName.endsWith(extension),
      ),
    );
    return kind;
  }

  get checker(): Checker {
    return this.parts.project.checker;
  }

  /** The program's view of each requested root, in request order. */
  async sourceFiles(): Promise<readonly ts.SourceFile[]> {
    const sourceFiles: ts.SourceFile[] = [];
    for (const sourcePath of this.parts.sourcePaths) {
      const sourceFile =
        await this.parts.project.program.getSourceFile(sourcePath);
      if (!sourceFile) {
        throw new Error(`TypeScript program omitted source: ${sourcePath}`);
      }
      sourceFiles.push(sourceFile);
    }
    return sourceFiles;
  }

  /** Any file the program loaded, roots and their dependencies alike. */
  async sourceFile(fileName: string): Promise<ts.SourceFile | false> {
    const sourceFile = await this.parts.project.program.getSourceFile(fileName);
    return sourceFile ? sourceFile : false;
  }

  async syntacticDiagnosticCount(sourceFile: ts.SourceFile): Promise<number> {
    const diagnostics =
      await this.parts.project.program.getSyntacticDiagnostics(
        sourceFile.fileName,
      );
    return diagnostics.length;
  }

  async close(): Promise<void> {
    await this.parts.release();
  }

  /** A program over a project that `TypeScriptSession` opened. */
  static fromSessionProject(parts: TypeScriptProgramParts): TypeScriptProgram {
    return new TypeScriptProgram(parts);
  }

  /** The in-memory files of a program over `request.program.sources`. */
  static layout(
    request: LayoutTypeScriptProgramRequest,
  ): TypeScriptProgramLayout {
    const files: Record<string, string> = {};
    const sourcePaths: string[] = [];
    for (const [index, source] of request.program.sources.entries()) {
      const sourcePath = TypeScriptProgram.virtualSourcePath({
        keepAbsolutePaths: request.keepAbsolutePaths,
        root: posix.join(request.root, String(index)),
        source,
      });
      if (Object.hasOwn(files, sourcePath)) {
        throw new Error(`Duplicate TypeScript source path: ${sourcePath}`);
      }
      files[sourcePath] = source.text;
      sourcePaths.push(sourcePath);
    }
    const configPath = posix.join(request.root, PROGRAM_CONFIG);
    files[configPath] = JSON.stringify({
      compilerOptions: request.program.compilerOptions,
      files: sourcePaths,
    });
    return { configPath, files, sourcePaths };
  }

  private static async openProject(
    request: OpenTypeScriptProjectRequest,
  ): Promise<TypeScriptProgram> {
    const api = request.fileSystem
      ? new API({ cwd: '/', fs: request.fileSystem })
      : new API({ cwd: '/' });
    const release = async (): Promise<void> => {
      try {
        await api.close();
      } finally {
        request.discard();
      }
    };
    try {
      const snapshot = await api.updateSnapshot({
        openProjects: [request.configPath],
      });
      const project = snapshot.getProject(request.configPath);
      if (!project) {
        throw new Error(`TypeScript did not open ${request.configPath}.`);
      }
      return new TypeScriptProgram({
        project,
        release,
        sourcePaths: request.sourcePaths,
      });
    } catch (error) {
      await release();
      throw error;
    }
  }

  private static virtualSourcePath(request: {
    readonly keepAbsolutePaths: boolean;
    readonly root: string;
    readonly source: TypeScriptSourceText;
  }): string {
    const { root, source } = request;
    const basePath =
      request.keepAbsolutePaths && posix.isAbsolute(source.fileName)
        ? source.fileName
        : posix.join(root, source.fileName);
    const extensions = SOURCE_EXTENSIONS[source.kind];
    return extensions.some((extension) => basePath.endsWith(extension))
      ? basePath
      : `${basePath}.${source.kind}`;
  }
}

/**
 * Owns one TypeScript 7 compiler process shared by many short-lived programs
 * over in-memory sources. Each program gets its own virtual directory and
 * project, and closing it releases only that project, so the compiler keeps
 * its parsed default libraries between programs. Closing the session ends the
 * process.
 */
export class TypeScriptSession {
  private constructor(private readonly parts: TypeScriptSessionParts) {}

  static start(): TypeScriptSession {
    const fileSystem = createVirtualFileSystem({});
    const { removeFile, writeFile } = fileSystem;
    if (!removeFile || !writeFile) {
      throw new Error('The TypeScript virtual file system is read-only.');
    }
    return new TypeScriptSession({
      api: new API({ cwd: '/', fs: fileSystem }),
      programs: { count: 0 },
      removeFile,
      writeFile,
    });
  }

  async open(
    request: OpenTypeScriptProgramRequest,
  ): Promise<TypeScriptProgram> {
    const { api, programs, removeFile, writeFile } = this.parts;
    const layout = TypeScriptProgram.layout({
      keepAbsolutePaths: false,
      program: request,
      root: posix.join(VIRTUAL_ROOT, 'session', String(programs.count)),
    });
    programs.count += 1;
    const paths = Object.keys(layout.files);
    for (const [path, content] of Object.entries(layout.files)) {
      writeFile(path, content);
    }
    const snapshot = await api.updateSnapshot({
      fileChanges: { created: paths },
      openProjects: [layout.configPath],
    });
    const project = snapshot.getProject(layout.configPath);
    if (!project) {
      throw new Error(`TypeScript did not open ${layout.configPath}.`);
    }
    const release = async (): Promise<void> => {
      await api.updateSnapshot({
        closeProjects: [layout.configPath],
        fileChanges: { deleted: paths },
      });
      await snapshot.dispose();
      for (const path of paths) removeFile(path);
    };
    return TypeScriptProgram.fromSessionProject({
      project,
      release,
      sourcePaths: layout.sourcePaths,
    });
  }

  /** Parses one source without libraries or module resolution. */
  async parseOne(source: TypeScriptSourceText): Promise<ts.SourceFile> {
    const program = await this.open({
      compilerOptions: PARSE_OPTIONS,
      sources: [source],
    });
    try {
      const [sourceFile] = await program.sourceFiles();
      if (!sourceFile) throw new Error('TypeScript did not parse the source.');
      return sourceFile;
    } finally {
      await program.close();
    }
  }

  async close(): Promise<void> {
    await this.parts.api.close();
  }
}
