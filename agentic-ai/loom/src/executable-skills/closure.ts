import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import type { RegisteredExecutableSkill } from './domain.ts';
import { decodeExecutableSkillManifest } from './manifest-codec.ts';

export type MaterializedSkillClosure = {
  readonly closureSha256: string;
  readonly contextDirectory: string;
  readonly runnerImagePath: string;
  readonly sourceTree: string;
  readonly dispose: () => void;
};

export type MaterializeSkillClosureRequest = {
  readonly definition: RegisteredExecutableSkill;
  readonly repositoryRoot: string;
};

type MaterializeSkillClosureInternalRequest = MaterializeSkillClosureRequest & {
  readonly auditCapabilities: boolean;
};

type ReadTreeFileRequest = {
  readonly relativePath: string;
  readonly repositoryRoot: string;
  readonly sourceTree: string;
};

type PackageTransport = {
  readonly dependencies?: Readonly<Record<string, string>>;
};

const PACKAGE_PATH = '.agents/skills/package.json';
const LOCK_PATH = '.agents/skills/bun.lock';
const TREE_HASH = /^[0-9a-f]{40}$/u;
const DIRECTORY_OPTIONS = { recursive: true } as const;
const REMOVE_OPTIONS = { recursive: true, force: true } as const;
const FORBIDDEN_NODE_MODULES = new Set([
  'child_process',
  'cluster',
  'dgram',
  'dns',
  'fs',
  'http',
  'https',
  'net',
  'tls',
  'worker_threads',
]);
const FORBIDDEN_BUN_MEMBERS = new Set([
  'env',
  'file',
  'serve',
  'spawn',
  'spawnSync',
]);
const FORBIDDEN_PROCESS_MEMBERS = new Set([
  'chdir',
  'cwd',
  'env',
  'execArgv',
  'getBuiltinModule',
  'kill',
]);

export function materializeSkillClosure(
  request: MaterializeSkillClosureRequest,
): MaterializedSkillClosure {
  const internalRequest: MaterializeSkillClosureInternalRequest = {
    ...request,
    auditCapabilities: true,
  };
  return materializeSkillClosureInternal(internalRequest);
}

export function materializeSkillAcceptanceProbeClosure(
  request: MaterializeSkillClosureRequest,
): MaterializedSkillClosure {
  const internalRequest: MaterializeSkillClosureInternalRequest = {
    ...request,
    auditCapabilities: false,
  };
  return materializeSkillClosureInternal(internalRequest);
}

function materializeSkillClosureInternal(
  request: MaterializeSkillClosureInternalRequest,
): MaterializedSkillClosure {
  const sourceTree = writeIndexTree(request.repositoryRoot);
  const pending = [request.definition.runnerPath];
  const sources = new Map<string, string>();
  const externalPackages = new Set<string>();
  while (pending.length > 0) {
    const relativePath = pending.pop();
    if (typeof relativePath !== 'string' || sources.has(relativePath)) continue;
    const sourcePathRequest: AssertSkillSourcePathRequest = {
      relativePath,
      repositoryRoot: request.repositoryRoot,
      skillId: request.definition.skillId,
    };
    assertSkillSourcePath(sourcePathRequest);
    const treeFileRequest: ReadTreeFileRequest = {
      relativePath,
      repositoryRoot: request.repositoryRoot,
      sourceTree,
    };
    const source = readTreeFile(treeFileRequest);
    assertWorktreeMatches(treeFileRequest);
    sources.set(relativePath, source);
    const moduleSpecifiersRequest: ModuleSpecifiersRequest = {
      auditCapabilities: request.auditCapabilities,
      relativePath,
      source,
    };
    const imports = moduleSpecifiers(moduleSpecifiersRequest);
    for (const specifier of imports) {
      if (!specifier.startsWith('.')) {
        if (!specifier.startsWith('node:')) {
          externalPackages.add(packageName(specifier));
        }
        continue;
      }
      const importRequest: ResolveLocalImportRequest = {
        importer: relativePath,
        specifier,
      };
      pending.push(resolveLocalImport(importRequest));
    }
  }
  const packageRequest: ReadTreeFileRequest = {
    relativePath: PACKAGE_PATH,
    repositoryRoot: request.repositoryRoot,
    sourceTree,
  };
  const packageText = readClosureMetadata(packageRequest);
  const lockRequest: ReadTreeFileRequest = {
    relativePath: LOCK_PATH,
    repositoryRoot: request.repositoryRoot,
    sourceTree,
  };
  const lockText = readClosureMetadata(lockRequest);
  const manifestRequest: ReadTreeFileRequest = {
    relativePath: request.definition.manifestPath,
    repositoryRoot: request.repositoryRoot,
    sourceTree,
  };
  const manifestText = readClosureMetadata(manifestRequest);
  const frozenManifest = decodeExecutableSkillManifest(manifestText);
  if (
    JSON.stringify(frozenManifest) !==
    JSON.stringify(request.definition.manifest)
  ) {
    throw new Error(
      'Executable skill frozen manifest differs from its static registration.',
    );
  }
  const declaredPackagesRequest: AssertDeclaredPackagesRequest = {
    externalPackages,
    packageText,
  };
  assertDeclaredPackages(declaredPackagesRequest);
  const closureFiles = new Map(sources);
  closureFiles.set(PACKAGE_PATH, packageText);
  closureFiles.set(LOCK_PATH, lockText);
  closureFiles.set(request.definition.manifestPath, manifestText);
  const closureSha256 = closureDigest(closureFiles);
  const contextDirectory = mkdtempSync(
    path.join(tmpdir(), 'nook-skill-closure-'),
  );
  for (const [relativePath, content] of closureFiles) {
    const contextPath = contextRelativePath(relativePath);
    const absolutePath = path.join(contextDirectory, contextPath);
    mkdirSync(path.dirname(absolutePath), DIRECTORY_OPTIONS);
    writeFileSync(absolutePath, content, 'utf8');
  }
  const runnerImagePath = `/skills/${contextRelativePath(
    request.definition.runnerPath,
  )}`;
  return {
    closureSha256,
    contextDirectory,
    runnerImagePath,
    sourceTree,
    dispose: () => rmSync(contextDirectory, REMOVE_OPTIONS),
  };
}

type ModuleSpecifiersRequest = {
  readonly auditCapabilities: boolean;
  readonly relativePath: string;
  readonly source: string;
};

function moduleSpecifiers(request: ModuleSpecifiersRequest): readonly string[] {
  const sourceFile = ts.createSourceFile(
    request.relativePath,
    request.source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (request.auditCapabilities) assertNoForbiddenCapability(node);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      throw new Error(
        'Executable skill closure forbids dynamic module loading.',
      );
    }
    if (
      ts.isImportDeclaration(node) &&
      !isTypeOnlyImport(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  for (const specifier of specifiers) {
    if (request.auditCapabilities && isForbiddenNodeModule(specifier)) {
      throw new Error(
        `Executable skill closure forbids ambient module: ${specifier}`,
      );
    }
  }
  return specifiers;
}

function assertNoForbiddenCapability(node: ts.Node): void {
  if (
    (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === 'fetch' || node.expression.text === 'WebSocket')
  ) {
    throw new Error('Executable skill closure forbids ambient network APIs.');
  }
  if (!ts.isPropertyAccessExpression(node)) return;
  if (
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'Bun' &&
    FORBIDDEN_BUN_MEMBERS.has(node.name.text)
  ) {
    throw new Error('Executable skill closure forbids ambient Bun APIs.');
  }
  if (
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    FORBIDDEN_PROCESS_MEMBERS.has(node.name.text)
  ) {
    throw new Error('Executable skill closure forbids ambient process APIs.');
  }
  if (
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'globalThis' &&
    (node.name.text === 'fetch' ||
      node.name.text === 'WebSocket' ||
      node.name.text === 'process')
  ) {
    throw new Error('Executable skill closure forbids ambient global APIs.');
  }
  if (
    node.name.text === 'write' &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'Bun' &&
    !isBunOutputWrite(node.parent)
  ) {
    throw new Error('Executable skill closure forbids filesystem writes.');
  }
}

function isBunOutputWrite(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const destination = node.arguments[0];
  return Boolean(
    destination &&
    ts.isPropertyAccessExpression(destination) &&
    ts.isIdentifier(destination.expression) &&
    destination.expression.text === 'Bun' &&
    (destination.name.text === 'stdout' || destination.name.text === 'stderr'),
  );
}

function isForbiddenNodeModule(specifier: string): boolean {
  if (!specifier.startsWith('node:')) return false;
  const moduleName = specifier.slice('node:'.length).split('/')[0];
  return (
    typeof moduleName === 'string' && FORBIDDEN_NODE_MODULES.has(moduleName)
  );
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings) return false;
  return (
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function writeIndexTree(repositoryRoot: string): string {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const tree = execFileSync('git', ['write-tree'], options).trim();
  if (!TREE_HASH.test(tree)) {
    throw new Error('Executable skill source tree could not be frozen.');
  }
  return tree;
}

function readClosureMetadata(request: ReadTreeFileRequest): string {
  const content = readTreeFile(request);
  assertWorktreeMatches(request);
  return content;
}

function readTreeFile(request: ReadTreeFileRequest): string {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: request.repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  try {
    return execFileSync(
      'git',
      ['show', `${request.sourceTree}:${request.relativePath}`],
      options,
    );
  } catch {
    throw new Error(
      `Executable skill closure file is absent from the frozen index: ${request.relativePath}`,
    );
  }
}

function assertWorktreeMatches(request: ReadTreeFileRequest): void {
  const indexed = readTreeFile(request);
  const absolutePath = path.join(request.repositoryRoot, request.relativePath);
  const stat = lstatSync(absolutePath);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    readFileSync(absolutePath, 'utf8') !== indexed
  ) {
    throw new Error(
      `Executable skill closure has worktree/index drift: ${request.relativePath}`,
    );
  }
}

type AssertSkillSourcePathRequest = {
  readonly relativePath: string;
  readonly repositoryRoot: string;
  readonly skillId: string;
};

function assertSkillSourcePath(request: AssertSkillSourcePathRequest): void {
  const expectedRoot = `.agents/skills/${request.skillId}/`;
  if (
    !request.relativePath.startsWith(expectedRoot) ||
    !request.relativePath.endsWith('.ts') ||
    request.relativePath
      .split('/')
      .some((part) => part === '.' || part === '..')
  ) {
    throw new Error('Executable skill local import escapes its package.');
  }
}

type ResolveLocalImportRequest = {
  readonly importer: string;
  readonly specifier: string;
};

function resolveLocalImport(request: ResolveLocalImportRequest): string {
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(request.importer), request.specifier),
  );
  return resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
}

function packageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    return specifier.split('/').slice(0, 2).join('/');
  }
  return specifier.split('/')[0] ?? specifier;
}

type AssertDeclaredPackagesRequest = {
  readonly externalPackages: ReadonlySet<string>;
  readonly packageText: string;
};

function assertDeclaredPackages(request: AssertDeclaredPackagesRequest): void {
  const transport = JSON.parse(request.packageText) as PackageTransport;
  const declared = transport.dependencies ?? {};
  for (const packageName of request.externalPackages) {
    if (!Object.hasOwn(declared, packageName)) {
      throw new Error(
        `Executable skill imports an undeclared runtime package: ${packageName}`,
      );
    }
  }
}

function contextRelativePath(relativePath: string): string {
  const prefix = '.agents/skills/';
  if (!relativePath.startsWith(prefix)) {
    throw new Error('Executable skill closure path is outside skills root.');
  }
  return relativePath.slice(prefix.length);
}

type ClosureDigestFiles = ReadonlyMap<string, string>;

function closureDigest(files: ClosureDigestFiles): string {
  const hash = createHash('sha256');
  for (const relativePath of [...files.keys()].sort()) {
    const content = files.get(relativePath);
    if (typeof content !== 'string') continue;
    hash.update(relativePath);
    hash.update('\0');
    hash.update(createHash('sha256').update(content).digest('hex'));
    hash.update('\n');
  }
  return hash.digest('hex');
}
