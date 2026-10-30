import type * as ts from 'typescript/unstable/ast';

import {
  type OpenTypeScriptProgramRequest,
  type TypeScriptProgram,
  TypeScriptSession,
  type TypeScriptSourceText,
  type UseTypeScriptSourceRequest,
} from '../src/lib/typescript/program.ts';

/**
 * Owns the compiler work of the boundary scenarios.
 *
 * The scenarios inspect the same scripts many times (each configuration graph
 * pass re-walks the repository), and every TypeScript 7 question is a round
 * trip to a compiler process. One compiler process serves the whole test run,
 * each distinct source text is parsed once, and parsed trees, being
 * immutable, are shared. The process ends with the test run.
 */
export class TypeScriptTestSources {
  private constructor() {}

  static parse(source: TypeScriptSourceText): Promise<ts.SourceFile> {
    const key = `${source.kind}\0${source.fileName}\0${source.text}`;
    const cached = PARSED_SOURCES.get(key);
    if (cached) return cached;
    const parsed = SESSION.parseOne(source);
    PARSED_SOURCES.set(key, parsed);
    return parsed;
  }

  /** Work on an isolated program over one in-memory source. */
  static useSource<T>(request: UseTypeScriptSourceRequest<T>): Promise<T> {
    return SESSION.useSource(request);
  }

  /** An isolated program over in-memory sources in the shared compiler. */
  static open(
    request: OpenTypeScriptProgramRequest,
  ): Promise<TypeScriptProgram> {
    return SESSION.open(request);
  }
}

const SESSION = TypeScriptSession.start();

const PARSED_SOURCES = new Map<string, Promise<ts.SourceFile>>();
