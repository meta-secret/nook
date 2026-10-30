// Runs `nook-typed-api/no-empty-success-contract` on TypeScript 7.
//
// Oxlint JS plugins cannot use type information, so this check reads types
// through the TypeScript 7 API for every authored `.ts` file in the typed-API
// source globs. ESLint keeps the same rule for `.svelte` files
// (`no-empty-success-contract-rule.js`). TypeScript 7's synchronous API talks
// to its compiler over stdio pipes that only Node exposes, so run this file
// with Node: `node named-success-contract-check.ts [--ignore-pattern GLOB]
// [PATH...]`. PATH defaults to the web root.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, globSync, readFileSync } from "node:fs";
import { matchesGlob, relative, resolve, sep } from "node:path";
import { SyntaxKind } from "@typescript/native/unstable/ast";
import type { Node, SourceFile } from "@typescript/native/unstable/ast";
import {
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isMethodSignatureDeclaration,
  isSetAccessorDeclaration,
  isTypeReferenceNode,
} from "@typescript/native/unstable/ast/is";
import { API, SymbolFlags, TypeFlags } from "@typescript/native/unstable/sync";
import type {
  Checker,
  NodeHandle,
  Project,
  Symbol as TypeScriptSymbol,
  Type,
} from "@typescript/native/unstable/sync";
import { namedSuccessContractBaseline } from "./named-success-contract-baseline.js";
import { lintIgnorePatterns, typedApiSourceFiles } from "./typed-api-rules.js";

const ruleName = "nook-typed-api/no-empty-success-contract";
const webRoot = import.meta.dirname;
const projectConfig = resolve(webRoot, "tsconfig.eslint.json");

// Node strips TypeScript types without transforming enums.
const MessageId = {
  EmptySuccessCall: "emptySuccessCall",
  EmptySuccessType: "emptySuccessType",
  StaleBaselineEntry: "staleBaselineEntry",
  MissingFromProject: "missingFromProject",
} as const;
type MessageId = (typeof MessageId)[keyof typeof MessageId];

const messages: Readonly<Record<MessageId, string>> = {
  [MessageId.EmptySuccessCall]:
    "Nook web forbids an empty neverthrow success. Return a named concrete success value or capability.",
  [MessageId.EmptySuccessType]:
    "Nook web forbids an empty neverthrow success contract. Use a named concrete success value or capability.",
  [MessageId.StaleBaselineEntry]:
    "Named success source baseline for {{file}} is stale; remove or regenerate this exact-source entry.",
  [MessageId.MissingFromProject]:
    "This file is not part of tsconfig.eslint.json, so its success contracts cannot be type-checked.",
};

type Finding = {
  readonly file: string;
  readonly position: number;
  readonly messageId: MessageId;
};

type CommandLine = {
  readonly paths: readonly string[];
  readonly ignorePatterns: readonly string[];
};

type SymbolMatch = {
  readonly symbol: TypeScriptSymbol;
  readonly expectedName: string;
};

type TypeSearch = {
  readonly type: Type;
  readonly seen: Set<number>;
};

/** Reads `--ignore-pattern GLOB` options and the paths to check. */
function parseCommandLine(argumentsList: readonly string[]): CommandLine {
  const paths: string[] = [];
  const ignorePatterns: string[] = [];
  let expectsIgnorePattern = false;
  for (const argument of argumentsList) {
    if (expectsIgnorePattern) {
      ignorePatterns.push(argument);
      expectsIgnorePattern = false;
    } else if (argument === "--ignore-pattern") {
      expectsIgnorePattern = true;
    } else {
      paths.push(argument);
    }
  }
  if (expectsIgnorePattern) throw new Error("--ignore-pattern needs a glob");
  return { paths: paths.length > 0 ? paths : ["."], ignorePatterns };
}

function webRelativePath(file: string): string {
  return relative(webRoot, file).split(sep).join("/");
}

/** The authored TypeScript files the typed-API globs select under `paths`. */
function targetFiles(commandLine: CommandLine): readonly string[] {
  const ignored = [...lintIgnorePatterns, ...commandLine.ignorePatterns];
  const scopes = commandLine.paths.map((path) => {
    if (!existsSync(path)) throw new Error(`No such path to check: ${path}`);
    return webRelativePath(resolve(path));
  });
  return globSync(typedApiSourceFiles, {
    cwd: webRoot,
    exclude: (path) => path.split(sep).includes("node_modules"),
  })
    .map((file) => file.split(sep).join("/"))
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => !ignored.some((pattern) => matchesGlob(file, pattern)))
    .filter((file) =>
      scopes.some(
        (scope) =>
          scope === "" || file === scope || file.startsWith(`${scope}/`),
      ),
    )
    .sort();
}

/** Git's blob identity for a source text, as the baseline records it. */
function gitBlobSha1(source: string): string {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(source, "utf8")}\0`, "utf8")
    .update(source, "utf8")
    .digest("hex");
}

function declaredInNeverthrow(declaration: NodeHandle): boolean {
  const segments = declaration.path.split("/");
  return segments.some(
    (segment, index) =>
      segment === "node_modules" && segments[index + 1] === "neverthrow",
  );
}

class SuccessContractChecker {
  private readonly checker: Checker;
  private readonly project: Project;
  private readonly emptySuccessByType = new Map<number, boolean>();

  constructor(project: Project) {
    this.project = project;
    this.checker = project.checker;
  }

  /** Mirrors the ESLint rule's neverthrow symbol test, aliases included. */
  private isNeverthrowSymbol(match: SymbolMatch): boolean {
    let resolved = match.symbol;
    const seen = new Set<number>();
    while ((resolved.flags & SymbolFlags.Alias) !== 0) {
      if (seen.has(resolved.id)) return false;
      seen.add(resolved.id);
      const aliased = this.checker.getAliasedSymbol(resolved);
      if (aliased.id === resolved.id) return false;
      resolved = aliased;
    }
    if (resolved.name !== match.expectedName) return false;
    return resolved.declarations.some(declaredInNeverthrow);
  }

  private isDefaultLibraryPromise(symbol: TypeScriptSymbol): boolean {
    if (symbol.name !== "Promise" && symbol.name !== "PromiseLike") {
      return false;
    }
    return symbol.declarations.some(
      (declaration) =>
        this.project.program.getSourceFileMetadataByPath(declaration.path)
          ?.isDefaultLibrary === true,
    );
  }

  private typeArguments(type: Type): readonly Type[] {
    if (type.isTypeReference()) return this.checker.getTypeArguments(type);
    return type.getAliasTypeArguments();
  }

  private hasEmptySuccessValue(type: Type): boolean {
    if ((type.flags & (TypeFlags.Void | TypeFlags.Undefined)) !== 0) {
      return true;
    }
    if (!type.isUnionType()) return false;
    return type.getTypes().some((part) => this.hasEmptySuccessValue(part));
  }

  /** Whether the type is, or resolves through Promise to, `Ok<void | undefined, E>`. */
  containsEmptySuccess(type: Type): boolean {
    if (this.emptySuccessByType.has(type.id)) {
      return this.emptySuccessByType.get(type.id) === true;
    }
    const search: TypeSearch = { type, seen: new Set() };
    const result = this.searchEmptySuccess(search);
    this.emptySuccessByType.set(type.id, result);
    return result;
  }

  private searchEmptySuccess(search: TypeSearch): boolean {
    const { type, seen } = search;
    if (seen.has(type.id)) return false;
    seen.add(type.id);

    if (type.isUnionType() || type.isIntersectionType()) {
      const parts = type.getTypes();
      if (parts.some((part) => this.searchEmptySuccess({ type: part, seen }))) {
        return true;
      }
    }

    const candidates = new Map<number, TypeScriptSymbol>();
    const aliasSymbol = type.getAliasSymbol();
    if (aliasSymbol) candidates.set(aliasSymbol.id, aliasSymbol);
    const typeSymbol = type.getSymbol();
    if (typeSymbol) candidates.set(typeSymbol.id, typeSymbol);
    if (type.isTypeReference()) {
      const targetSymbol = type.getTarget().getSymbol();
      if (targetSymbol) candidates.set(targetSymbol.id, targetSymbol);
    }
    const symbols = [...candidates.values()];

    if (
      symbols.some((symbol) =>
        this.isNeverthrowSymbol({ symbol, expectedName: "Ok" }),
      )
    ) {
      const successType = this.typeArguments(type)[0];
      if (successType && this.hasEmptySuccessValue(successType)) return true;
    }

    if (symbols.some((symbol) => this.isDefaultLibraryPromise(symbol))) {
      const fulfillmentType = this.typeArguments(type)[0];
      if (
        fulfillmentType &&
        this.searchEmptySuccess({ type: fulfillmentType, seen })
      ) {
        return true;
      }
    }
    return false;
  }

  typeReferenceIsEmptySuccess(node: Node): boolean {
    if (!isTypeReferenceNode(node)) return false;
    const type = this.checker.getTypeFromTypeNode(node);
    return type ? this.containsEmptySuccess(type) : false;
  }

  /** The ESLint rule resolves the called signature's declared name. */
  isNeverthrowOkCall(node: Node): boolean {
    if (!isCallExpression(node)) return false;
    const declaration = this.checker
      .getResolvedSignature(node)
      ?.declaration?.resolve(this.project);
    if (
      !declaration ||
      !(
        isFunctionDeclaration(declaration) ||
        isFunctionExpression(declaration) ||
        isMethodDeclaration(declaration) ||
        isMethodSignatureDeclaration(declaration) ||
        isGetAccessorDeclaration(declaration) ||
        isSetAccessorDeclaration(declaration)
      )
    ) {
      return false;
    }
    const name = declaration.name;
    if (!name || !isIdentifier(name) || name.text !== "ok") return false;
    const symbol = this.checker.getSymbolAtLocation(name);
    return symbol
      ? this.isNeverthrowSymbol({ symbol, expectedName: "ok" })
      : false;
  }

  callIsEmptySuccess(node: Node): boolean {
    if (!isCallExpression(node)) return false;
    if (node.arguments.length === 0) return true;
    const resultType = this.checker.getTypeAtLocation(node);
    return resultType ? this.containsEmptySuccess(resultType) : false;
  }
}

/** A type reference inside an inline property type is reported at its owner. */
function isNestedPropertyPayload(node: Node): boolean {
  let current = node.parent;
  while (current) {
    if (current.kind === SyntaxKind.PropertySignature) return true;
    if (
      current.kind === SyntaxKind.TypeAliasDeclaration ||
      current.kind === SyntaxKind.InterfaceDeclaration
    ) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

type FileCheck = {
  readonly checker: SuccessContractChecker;
  readonly sourceFile: SourceFile;
  readonly file: string;
};

/** Visits the TypeReference and CallExpression nodes ESLint's rule visits. */
function fileFindings(check: FileCheck): Finding[] {
  const { checker, sourceFile, file } = check;
  const findings: Finding[] = [];
  const emptyAncestorReferences: boolean[] = [];

  function visit(node: Node): void {
    let emptyReference = false;
    if (node.kind === SyntaxKind.TypeReference) {
      emptyReference = checker.typeReferenceIsEmptySuccess(node);
      if (
        emptyReference &&
        !isNestedPropertyPayload(node) &&
        !emptyAncestorReferences.includes(true)
      ) {
        findings.push({
          file,
          position: node.getStart(sourceFile),
          messageId: MessageId.EmptySuccessType,
        });
      }
    } else if (
      isCallExpression(node) &&
      node.expression.kind !== SyntaxKind.ImportKeyword &&
      checker.isNeverthrowOkCall(node) &&
      checker.callIsEmptySuccess(node)
    ) {
      findings.push({
        file,
        position: node.getStart(sourceFile),
        messageId: MessageId.EmptySuccessCall,
      });
    }
    const isReference = node.kind === SyntaxKind.TypeReference;
    if (isReference) emptyAncestorReferences.push(emptyReference);
    node.forEachChild(visit);
    if (isReference) emptyAncestorReferences.pop();
  }

  sourceFile.forEachChild(visit);
  return findings;
}

/** Applies the exact-source baseline the ESLint rule applies at Program:exit. */
function baselinedFindings(check: FileCheck): Finding[] {
  const violations = fileFindings(check);
  const entries = namedSuccessContractBaseline.filter(
    (entry) => entry.file === check.file,
  );
  const source = readFileSync(resolve(webRoot, check.file), "utf8").replace(
    /^\uFEFF/,
    "",
  );
  const currentBlobSha1 = gitBlobSha1(source);
  if (
    violations.length > 0 &&
    entries.some((entry) => entry.gitBlobSha1 === currentBlobSha1)
  ) {
    return [];
  }
  return [
    ...entries.map((entry) => ({
      file: entry.file,
      position: 0,
      messageId: MessageId.StaleBaselineEntry,
    })),
    ...violations,
  ];
}

type ReportLine = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly messageId: MessageId;
};

function formatReport(report: ReportLine): string {
  const message = messages[report.messageId].replace("{{file}}", report.file);
  return `${report.file}:${report.line}:${report.column}: error ${ruleName}(${report.messageId}): ${message}`;
}

function run(commandLine: CommandLine): number {
  const files = targetFiles(commandLine);
  const api = new API({ cwd: webRoot });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [projectConfig] });
    const project = snapshot.getProject(projectConfig);
    if (!project) {
      throw new Error(`TypeScript 7 could not load ${projectConfig}`);
    }
    const checker = new SuccessContractChecker(project);
    let findingCount = 0;
    for (const file of files) {
      const sourceFile = project.program.getSourceFile(resolve(webRoot, file));
      if (!sourceFile) {
        console.log(
          formatReport({
            file,
            line: 1,
            column: 1,
            messageId: MessageId.MissingFromProject,
          }),
        );
        findingCount += 1;
        continue;
      }
      const findings = baselinedFindings({ checker, sourceFile, file }).sort(
        (left, right) => left.position - right.position,
      );
      for (const finding of findings) {
        const location = sourceFile.getLineAndCharacterOfPosition(
          finding.position,
        );
        console.log(
          formatReport({
            file: finding.file,
            line: location.line + 1,
            column: location.character + 1,
            messageId: finding.messageId,
          }),
        );
        findingCount += 1;
      }
    }
    console.error(
      `${ruleName}: ${findingCount} problem(s) in ${files.length} file(s)`,
    );
    return findingCount === 0 ? 0 : 1;
  } finally {
    api.close();
  }
}

process.exitCode = run(parseCommandLine(process.argv.slice(2)));
