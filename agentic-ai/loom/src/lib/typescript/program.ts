import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import type * as ts from 'typescript/unstable/ast';
import {
  API,
  type Checker,
  type Project,
  type Snapshot,
} from 'typescript/unstable/async';
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

/** A program over one source, with the work `use` does on it. */
export type UseTypeScriptSourceRequest<T> = {
  readonly compilerOptions: TypeScriptCompilerOptions;
  readonly source: TypeScriptSourceText;
  readonly use: (program: TypeScriptProgram) => Promise<T>;
};

/** One reusable project over a single source file of one file kind. */
type TypeScriptSourceSlot = {
  readonly configPath: string;
  /**
   * The snapshot of the slot's last use. It stays open until the next use
   * has its own: the compiler reports a snapshot's changed files against the
   * previous live one, and the client keeps every unreported file.
   */
  snapshot: Snapshot | false;
  readonly sourcePath: string;
  /** Settles once the slot's current use is done with its source. */
  tail: Promise<void>;
};

type UseTypeScriptSourceSlotRequest<T> = {
  readonly request: UseTypeScriptSourceRequest<T>;
  readonly slot: TypeScriptSourceSlot;
};

type TypeScriptSessionParts = {
  readonly api: API;
  readonly programs: { count: number };
  readonly removeFile: NonNullable<FileSystem['removeFile']>;
  readonly slots: Map<string, TypeScriptSourceSlot>;
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

/**
 * File-name endings that change how the compiler reads a source, longest
 * first, so a reused source file keeps the kind its requested name implies.
 */
const SOURCE_FILE_SUFFIXES = [
  '.d.mts',
  '.d.cts',
  '.d.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.ts',
  '.mjs',
  '.cjs',
  '.jsx',
  '.js',
  '.json',
] as const;

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
      slots: new Map(),
      writeFile,
    });
  }

  /**
   * Runs `use` on a program over `request.source` alone, as `open` would.
   *
   * Opening a project costs the compiler its default libraries again, and a
   * source's checker facts are read before the next source is needed. So
   * programs with the same options and file kind share one project whose
   * single source file is rewritten for each use, which keeps the libraries
   * bound; uses of one project run one at a time.
   */
  useSource<T>(request: UseTypeScriptSourceRequest<T>): Promise<T> {
    const slot = this.slot(request);
    const result = slot.tail.then(() => this.useSlot({ request, slot }));
    slot.tail = result.then(
      () => {},
      () => {},
    );
    return result;
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
  parseOne(source: TypeScriptSourceText): Promise<ts.SourceFile> {
    return this.useSource({
      compilerOptions: PARSE_OPTIONS,
      source,
      use: async (program) => {
        const [sourceFile] = await program.sourceFiles();
        if (!sourceFile) {
          throw new Error('TypeScript did not parse the source.');
        }
        return sourceFile;
      },
    });
  }

  private slot<T>(
    request: UseTypeScriptSourceRequest<T>,
  ): TypeScriptSourceSlot {
    const { programs, slots, writeFile } = this.parts;
    const sourcePath = TypeScriptProgram.layout({
      keepAbsolutePaths: false,
      program: {
        compilerOptions: request.compilerOptions,
        sources: [request.source],
      },
      root: VIRTUAL_ROOT,
    }).sourcePaths.join('');
    const [suffix = ''] = SOURCE_FILE_SUFFIXES.filter((candidate) =>
      sourcePath.endsWith(candidate),
    );
    const key = `${JSON.stringify(request.compilerOptions)}\0${suffix}`;
    const existing = slots.get(key);
    if (existing) return existing;
    const root = posix.join(VIRTUAL_ROOT, 'slot', String(programs.count));
    programs.count += 1;
    const slot: TypeScriptSourceSlot = {
      configPath: posix.join(root, PROGRAM_CONFIG),
      snapshot: false,
      sourcePath: posix.join(root, `source${suffix}`),
      tail: Promise.resolve(),
    };
    writeFile(
      slot.configPath,
      JSON.stringify({
        compilerOptions: request.compilerOptions,
        files: [slot.sourcePath],
      }),
    );
    slots.set(key, slot);
    return slot;
  }

  private async useSlot<T>(
    request: UseTypeScriptSourceSlotRequest<T>,
  ): Promise<T> {
    const { api, writeFile } = this.parts;
    const { slot } = request;
    writeFile(slot.sourcePath, request.request.source.text);
    const previous = slot.snapshot;
    const snapshot = previous
      ? await api.updateSnapshot({
          fileChanges: { changed: [slot.sourcePath] },
        })
      : await api.updateSnapshot({
          fileChanges: { created: [slot.configPath, slot.sourcePath] },
          openProjects: [slot.configPath],
        });
    slot.snapshot = snapshot;
    if (previous) await previous.dispose();
    const project = snapshot.getProject(slot.configPath);
    if (!project) {
      throw new Error(`TypeScript did not open ${slot.configPath}.`);
    }
    const sourceFile = await project.program.getSourceFile(slot.sourcePath);
    if (!sourceFile || sourceFile.text !== request.request.source.text) {
      throw new Error(`TypeScript did not load the new ${slot.sourcePath}.`);
    }
    const program = TypeScriptProgram.fromSessionProject({
      project,
      // The slot keeps its project for the next source.
      release: async () => {},
      sourcePaths: [slot.sourcePath],
    });
    return request.request.use(program);
  }

  async close(): Promise<void> {
    await this.parts.api.close();
  }
}
