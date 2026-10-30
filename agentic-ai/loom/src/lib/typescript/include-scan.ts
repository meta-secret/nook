import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export type ScanTypeScriptIncludesRequest = {
  /** File extensions to keep, such as `.ts`. */
  readonly extensions: readonly string[];
  /** `tsconfig.json` `include` patterns, relative to `root`. */
  readonly includes: readonly string[];
  readonly root: string;
};

type VisitDirectoryRequest = {
  readonly directory: string;
  readonly files: string[];
  readonly visited: Set<string>;
};

/** Directories a TypeScript wildcard never enters. */
const IMPLICITLY_EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'bower_components',
  'jspm_packages',
]);

/**
 * Owns TypeScript 6 `ts.sys.readDirectory` include matching, which the
 * TypeScript 7 API no longer exposes: a wildcard segment never matches a
 * dot-prefixed name, a package directory, or a `.min.js` file, and symlinked
 * directories are followed once by real path.
 */
export class TypeScriptIncludeScan {
  private constructor() {}

  /** Absolute paths of the matching files, sorted. */
  static scan(request: ScanTypeScriptIncludesRequest): readonly string[] {
    const files: string[] = [];
    TypeScriptIncludeScan.visitDirectory({
      directory: request.root,
      files,
      visited: new Set<string>(),
    });
    const matchers = request.includes.map((include) => new Bun.Glob(include));
    return files
      .filter(
        (file) =>
          request.extensions.some((extension) => file.endsWith(extension)) &&
          !file.endsWith('.min.js'),
      )
      .filter((file) => {
        const relativePath = relative(request.root, file).replaceAll('\\', '/');
        return matchers.some((matcher) => matcher.match(relativePath));
      })
      .sort();
  }

  private static visitDirectory(request: VisitDirectoryRequest): void {
    const realDirectory = realpathSync(request.directory);
    if (request.visited.has(realDirectory)) return;
    request.visited.add(realDirectory);
    for (const entry of readdirSync(request.directory, {
      withFileTypes: true,
    })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(request.directory, entry.name);
      const isDirectory = entry.isSymbolicLink()
        ? statSync(path).isDirectory()
        : entry.isDirectory();
      if (isDirectory) {
        if (IMPLICITLY_EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        TypeScriptIncludeScan.visitDirectory({ ...request, directory: path });
        continue;
      }
      request.files.push(path);
    }
  }
}
