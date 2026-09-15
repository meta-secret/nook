import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import * as ts from 'typescript';

export enum LoomSourcePolicyViolationKind {
  UnownedFunction = 'unowned-function',
}

export type LoomSourcePolicyViolation = Readonly<{
  kind: LoomSourcePolicyViolationKind;
  path: string;
  line: number;
  message: string;
}>;

export type LoomSourcePolicyReport = Readonly<{
  violations: readonly LoomSourcePolicyViolation[];
}>;

export type AuditLoomSourcePolicyRequest = Readonly<{
  root: string;
  ownershipPaths: readonly string[];
}>;

/** Owns the reviewed-wave Loom ownership regression. */
export class LoomSourcePolicy {
  private constructor(request: AuditLoomSourcePolicyRequest) {
    this.root = request.root;
    this.ownershipPaths = request.ownershipPaths;
  }

  private readonly root: string;
  private readonly ownershipPaths: readonly string[];

  static audit(request: AuditLoomSourcePolicyRequest): LoomSourcePolicyReport {
    return new LoomSourcePolicy(request).execute();
  }

  private execute(): LoomSourcePolicyReport {
    const violations: LoomSourcePolicyViolation[] = [];
    for (const path of this.sourceFiles()) {
      const source = readFileSync(path, 'utf8');
      const sourceFile = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        this.scriptKind(path),
      );
      this.inspectNode({
        sourceFile,
        node: sourceFile,
        ancestors: [],
        ownershipEnabled: this.ownershipEnabled(path),
        violations,
      });
    }
    return Object.freeze({ violations: Object.freeze(violations) });
  }

  private sourceFiles(): readonly string[] {
    const files: string[] = [];
    this.collectSourceFiles({
      directory: join(this.root, 'src'),
      files,
    });
    this.collectSourceFiles({
      directory: join(this.root, 'tests'),
      files,
    });
    return files.sort();
  }

  private collectSourceFiles(request: CollectSourceFilesRequest): void {
    for (const entry of readdirSync(request.directory, {
      withFileTypes: true,
    })) {
      const path = join(request.directory, entry.name);
      if (entry.isDirectory()) {
        this.collectSourceFiles({ ...request, directory: path });
        continue;
      }
      if (this.isAuthoredSource(path)) request.files.push(path);
    }
  }

  private isAuthoredSource(path: string): boolean {
    return ['.ts', '.js', '.mjs', '.cjs'].includes(extname(path));
  }

  private ownershipEnabled(path: string): boolean {
    return this.ownershipPaths.includes(path);
  }

  private scriptKind(path: string): ts.ScriptKind {
    switch (extname(path)) {
      case '.js':
        return ts.ScriptKind.JS;
      case '.mjs':
        return ts.ScriptKind.JS;
      case '.cjs':
        return ts.ScriptKind.JS;
      default:
        return ts.ScriptKind.TS;
    }
  }

  private inspectNode(request: InspectNodeRequest): void {
    const { sourceFile, node, ancestors, violations } = request;
    if (request.ownershipEnabled && this.isUnownedFunction({ node, ancestors }))
      violations.push(this.unownedFunctionViolation({ sourceFile, node }));
    ts.forEachChild(node, (child) =>
      this.inspectNode({
        sourceFile,
        node: child,
        ancestors: [node, ...ancestors],
        ownershipEnabled: request.ownershipEnabled,
        violations,
      }),
    );
  }

  private isUnownedFunction(request: IsUnownedFunctionRequest): boolean {
    if (this.hasClassOwner(request.ancestors)) return false;
    if (ts.isFunctionDeclaration(request.node)) return true;
    if (
      !ts.isArrowFunction(request.node) &&
      !ts.isFunctionExpression(request.node)
    )
      return false;
    return ts.isVariableDeclaration(request.node.parent);
  }

  private hasClassOwner(ancestors: readonly ts.Node[]): boolean {
    return ancestors.some(
      (ancestor) =>
        ts.isClassDeclaration(ancestor) || ts.isClassExpression(ancestor),
    );
  }

  private unownedFunctionViolation(
    request: UnownedFunctionViolationRequest,
  ): LoomSourcePolicyViolation {
    return {
      kind: LoomSourcePolicyViolationKind.UnownedFunction,
      path: relative(this.root, request.sourceFile.fileName),
      line:
        request.sourceFile.getLineAndCharacterOfPosition(
          request.node.getStart(request.sourceFile),
        ).line + 1,
      message:
        'Every authored Loom function must belong to a meaningful class owner or an immediate boundary callback.',
    };
  }
}

type InspectNodeRequest = Readonly<{
  sourceFile: ts.SourceFile;
  node: ts.Node;
  ancestors: readonly ts.Node[];
  ownershipEnabled: boolean;
  violations: LoomSourcePolicyViolation[];
}>;

type CollectSourceFilesRequest = {
  readonly directory: string;
  readonly files: string[];
};

type IsUnownedFunctionRequest = Readonly<{
  readonly node: ts.Node;
  readonly ancestors: readonly ts.Node[];
}>;

type UnownedFunctionViolationRequest = Readonly<{
  readonly sourceFile: ts.SourceFile;
  readonly node: ts.Node;
}>;

class LoomSourcePolicyCommand {
  private constructor() {}

  static execute(args: readonly string[]): void {
    const candidate = args[0];
    const root = resolve(
      typeof candidate === 'string' ? candidate : process.cwd(),
    );
    const baseline = LoomSourcePolicyCommand.baselineArgument(args);
    if (baseline === false) {
      console.error(
        'Loom source policy requires an explicit --ownership-from commit.',
      );
      process.exitCode = 2;
      return;
    }
    const repositoryRoot = resolve(root, '..', '..');
    const preflightExitCode =
      LoomSourcePolicyCommand.runPreflightStateGate(repositoryRoot);
    const report = LoomSourcePolicy.audit({
      root,
      ownershipPaths: LoomSourcePolicyCommand.changedSourcePaths({
        repositoryRoot,
        loomRoot: root,
        baseline,
      }),
    });
    for (const violation of report.violations)
      console.error(
        `${violation.kind}: ${violation.path}:${violation.line} ${violation.message}`,
      );
    if (preflightExitCode !== 0 || report.violations.length > 0)
      process.exitCode = 1;
  }

  private static runPreflightStateGate(repositoryRoot: string): number {
    const manifestPath = join(repositoryRoot, 'preflight', 'Cargo.toml');
    const result = Bun.spawnSync({
      cmd: [
        'cargo',
        'test',
        '--locked',
        '--manifest-path',
        manifestPath,
        '--test',
        'core_ownership',
        'typescript_',
        '--',
        '--nocapture',
      ],
      cwd: repositoryRoot,
      stderr: 'inherit',
      stdout: 'inherit',
    });
    return result.exitCode;
  }

  private static baselineArgument(args: readonly string[]): string | false {
    const optionIndex = args.indexOf('--ownership-from');
    if (optionIndex < 0) return false;
    const candidate = args[optionIndex + 1];
    if (typeof candidate !== 'string' || candidate.length === 0) return false;
    const result = Bun.spawnSync([
      'git',
      'rev-parse',
      '--verify',
      `${candidate}^{commit}`,
    ]);
    if (result.exitCode !== 0) return false;
    const resolved = result.stdout.toString().trim();
    return /^[0-9a-f]{40}$/u.test(resolved) ? resolved : false;
  }

  private static changedSourcePaths(
    request: ChangedSourcePathsRequest,
  ): readonly string[] {
    const pathSets = [
      ['diff', '--name-only', `${request.baseline}..HEAD`],
      ['diff', '--name-only'],
      ['diff', '--cached', '--name-only'],
    ] as const;
    const paths = new Set<string>();
    for (const gitArguments of pathSets) {
      const result = Bun.spawnSync({
        cmd: ['git', '-C', request.repositoryRoot, ...gitArguments],
        stdout: 'pipe',
        stderr: 'ignore',
      });
      for (const path of result.stdout
        .toString()
        .split('\n')
        .filter((path) => path.startsWith('agentic-ai/loom/'))) {
        paths.add(join(request.repositoryRoot, path));
      }
    }
    return [...paths].filter((path) => path.startsWith(request.loomRoot));
  }
}

type ChangedSourcePathsRequest = Readonly<{
  readonly repositoryRoot: string;
  readonly loomRoot: string;
  readonly baseline: string;
}>;

if (import.meta.main) LoomSourcePolicyCommand.execute(process.argv.slice(2));
