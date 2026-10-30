import * as ts from 'typescript/unstable/ast';
import {
  SignatureKind,
  SymbolFlags,
  type Checker,
  type Symbol as CheckerSymbol,
  type Type,
  type TypeFlags,
} from 'typescript/unstable/async';

/** The symbol meaning a name lookup resolves, as `SymbolFlags` selects it. */
export enum TypeScriptNameMeaning {
  Value = 'value',
  Type = 'type',
}

/** A compiler symbol with its declarations resolved to AST nodes. */
export type TypeScriptSymbolFact = {
  /**
   * The declarations in the collected source file, in declaration order.
   * Declarations in other files, such as the default libraries, are counted
   * but not materialized: fetching a library AST per program dominated the
   * cost, and no policy reads a foreign declaration beyond its file.
   */
  readonly declarations: readonly ts.Node[];
  /** Every declaration, in the collected source file or any other. */
  readonly declarationCount: number;
  readonly name: string;
};

/** A compiler type with the structure Loom's policies inspect. */
export type TypeScriptTypeFact = {
  readonly callSignatureCount: number;
  /** Members of a union or intersection type; empty for any other type. */
  readonly constituents: readonly TypeScriptTypeFact[];
  readonly constructSignatureCount: number;
  readonly flags: TypeFlags;
};

export type CollectTypeScriptCheckerFactsRequest = {
  readonly checker: Checker;
  /** Resolve every identifier's own name as a value and as a type. */
  readonly names: boolean;
  readonly sourceFile: ts.SourceFile;
  /** Resolve the type of every expression. */
  readonly types: boolean;
};

export type ResolveTypeScriptNameRequest = {
  readonly identifier: ts.Identifier;
  readonly meaning: TypeScriptNameMeaning;
};

type MutableTypeFact = {
  callSignatureCount: number;
  readonly constituents: TypeScriptTypeFact[];
  constructSignatureCount: number;
  readonly flags: TypeFlags;
};

type CheckerFactTables = {
  readonly names: ReadonlyMap<
    TypeScriptNameMeaning,
    ReadonlyMap<ts.Identifier, TypeScriptSymbolFact>
  >;
  readonly symbols: ReadonlyMap<ts.Identifier, TypeScriptSymbolFact>;
  readonly types: ReadonlyMap<ts.Node, TypeScriptTypeFact>;
  /** Expressions whose type the TypeScript 7 API failed to serialize. */
  readonly undescribedTypes: ReadonlySet<ts.Node>;
};

type CollectExpressionTypesRequest = {
  readonly expressions: readonly ts.Expression[];
  readonly types: Map<ts.Node, TypeScriptTypeFact>;
  readonly undescribedTypes: Set<ts.Node>;
};

/**
 * Owns the compiler answers one source file's synchronous policy needs.
 *
 * The TypeScript 7 checker runs out of process behind an asynchronous API.
 * `collect` asks it every question the policy can ask about the file up front:
 * the symbol at each identifier, each identifier's own name resolved as a
 * value and as a type, and the type of each expression. The policy then reads
 * those answers synchronously. A question that was not collected fails closed.
 */
export class TypeScriptCheckerFacts {
  private constructor(private readonly tables: CheckerFactTables) {}

  static async collect(
    request: CollectTypeScriptCheckerFactsRequest,
  ): Promise<TypeScriptCheckerFacts> {
    const tables = await new TypeScriptCheckerFactCollector(request).collect();
    return new TypeScriptCheckerFacts(tables);
  }

  /**
   * Facts for a source outside the program, as TypeScript 6 left a JavaScript
   * or extensionless root without `allowJs`: no identifier has a symbol.
   */
  static outsideProgram(): TypeScriptCheckerFacts {
    return new TypeScriptCheckerFacts({
      names: new Map(),
      symbols: new Map(),
      types: new Map(),
      undescribedTypes: new Set(),
    });
  }

  /** TypeScript 6 `TypeChecker.getSymbolAtLocation` for an identifier. */
  getSymbolAtLocation(identifier: ts.Identifier): TypeScriptSymbolFact | false {
    const symbol = this.tables.symbols.get(identifier);
    return symbol ? symbol : false;
  }

  /**
   * TypeScript 6 `TypeChecker.resolveName(identifier.text, identifier,
   * meaning, false)`.
   */
  resolveName(
    request: ResolveTypeScriptNameRequest,
  ): TypeScriptSymbolFact | false {
    const names = this.tables.names.get(request.meaning);
    if (!names) {
      throw new Error('TypeScript name resolution was not collected.');
    }
    const symbol = names.get(request.identifier);
    return symbol ? symbol : false;
  }

  /** TypeScript 6 `TypeChecker.getTypeAtLocation` for an expression. */
  getTypeAtLocation(expression: ts.Expression): TypeScriptTypeFact {
    if (this.tables.undescribedTypes.has(expression)) {
      throw new Error('TypeScript 7 could not describe this expression type.');
    }
    const type = this.tables.types.get(expression);
    if (!type) {
      throw new Error('TypeScript expression type was not collected.');
    }
    return type;
  }
}

/** Identifiers or expressions per concurrent compiler request batch. */
const CONCURRENT_REQUESTS = 256;

type TypeFactEntry = {
  readonly described: Promise<void>;
  readonly fact: MutableTypeFact;
};

class TypeScriptCheckerFactCollector {
  private readonly symbolFacts = new Map<
    number,
    Promise<TypeScriptSymbolFact>
  >();
  private readonly typeFacts = new Map<number, TypeFactEntry>();

  constructor(private readonly request: CollectTypeScriptCheckerFactsRequest) {}

  async collect(): Promise<CheckerFactTables> {
    const identifiers: ts.Identifier[] = [];
    const expressions: ts.Expression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) identifiers.push(node);
      if (ts.isExpression(node)) expressions.push(node);
      node.forEachChild(visit);
    };
    visit(this.request.sourceFile);
    const checker = this.request.checker;
    const symbols = new Map<ts.Identifier, TypeScriptSymbolFact>();
    const locationSymbols = await checker.getSymbolAtLocation(identifiers);
    const locationFacts = await Promise.all(
      locationSymbols.map((symbol) =>
        symbol ? this.symbolFact(symbol) : false,
      ),
    );
    for (const [index, identifier] of identifiers.entries()) {
      const fact = locationFacts.at(index);
      if (fact) symbols.set(identifier, fact);
    }
    const names = new Map<
      TypeScriptNameMeaning,
      ReadonlyMap<ts.Identifier, TypeScriptSymbolFact>
    >();
    if (this.request.names) {
      for (const [meaning, flags] of [
        [TypeScriptNameMeaning.Value, SymbolFlags.Value],
        [TypeScriptNameMeaning.Type, SymbolFlags.Type],
      ] as const) {
        const resolved = new Map<ts.Identifier, TypeScriptSymbolFact>();
        for (
          let offset = 0;
          offset < identifiers.length;
          offset += CONCURRENT_REQUESTS
        ) {
          const batch = identifiers.slice(offset, offset + CONCURRENT_REQUESTS);
          const facts = await Promise.all(
            batch.map(async (identifier) => {
              const symbol = await checker.resolveName(
                identifier.text,
                flags,
                identifier,
                false,
              );
              return symbol ? this.symbolFact(symbol) : false;
            }),
          );
          for (const [index, identifier] of batch.entries()) {
            const fact = facts.at(index);
            if (fact) resolved.set(identifier, fact);
          }
        }
        names.set(meaning, resolved);
      }
    }
    const types = new Map<ts.Node, TypeScriptTypeFact>();
    const undescribedTypes = new Set<ts.Node>();
    if (this.request.types) {
      await this.collectExpressionTypes({
        expressions,
        types,
        undescribedTypes,
      });
    }
    return { names, symbols, types, undescribedTypes };
  }

  /**
   * Asks for every expression type in one request. The TypeScript 7 API
   * panics while serializing some types (an empty `as const` array literal
   * is one), failing the whole request; the batch is then split until each
   * such expression is isolated and recorded as undescribed, so a policy
   * question about it fails closed while every other answer stays available.
   */
  private async collectExpressionTypes(
    request: CollectExpressionTypesRequest,
  ): Promise<void> {
    const { expressions, types, undescribedTypes } = request;
    if (expressions.length === 0) return;
    const expressionTypes = await this.expressionTypes(expressions);
    if (expressionTypes === false) {
      const [expression] = expressions;
      if (expressions.length === 1 && expression) {
        undescribedTypes.add(expression);
        return;
      }
      const middle = Math.floor(expressions.length / 2);
      for (const half of [
        expressions.slice(0, middle),
        expressions.slice(middle),
      ]) {
        await this.collectExpressionTypes({ ...request, expressions: half });
      }
      return;
    }
    for (
      let offset = 0;
      offset < expressions.length;
      offset += CONCURRENT_REQUESTS
    ) {
      const batch = expressions.slice(offset, offset + CONCURRENT_REQUESTS);
      const facts = await Promise.all(
        expressionTypes
          .slice(offset, offset + CONCURRENT_REQUESTS)
          .map((type) => (type ? this.typeFact(type) : false)),
      );
      for (const [index, expression] of batch.entries()) {
        const fact = facts.at(index);
        if (fact) types.set(expression, fact);
      }
    }
  }

  /**
   * Every expression type in one request, each absent type as `false`; or
   * `false` when the TypeScript 7 API panicked serializing one of them.
   */
  private async expressionTypes(
    expressions: readonly ts.Expression[],
  ): Promise<readonly (Type | false)[] | false> {
    try {
      const types = await this.request.checker.getTypeAtLocation(expressions);
      return types.map((type) => (type ? type : false));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('panic:')) {
        throw error;
      }
      return false;
    }
  }

  private symbolFact(symbol: CheckerSymbol): Promise<TypeScriptSymbolFact> {
    const cached = this.symbolFacts.get(symbol.id);
    if (cached) return cached;
    const fact = this.resolveSymbolFact(symbol);
    this.symbolFacts.set(symbol.id, fact);
    return fact;
  }

  private async resolveSymbolFact(
    symbol: CheckerSymbol,
  ): Promise<TypeScriptSymbolFact> {
    const sourcePath = this.request.sourceFile.path;
    const declarations = await Promise.all(
      symbol.declarations
        .filter((handle) => handle.path === sourcePath)
        .map((handle) => handle.resolve()),
    );
    const resolved = declarations.filter(
      (declaration): declaration is ts.Node => Boolean(declaration),
    );
    if (resolved.length !== declarations.length) {
      throw new Error(
        `TypeScript could not resolve a declaration of ${symbol.name}.`,
      );
    }
    if (
      resolved.some(
        (declaration) =>
          declaration.getSourceFile() !== this.request.sourceFile,
      )
    ) {
      throw new Error(
        `TypeScript resolved a declaration of ${symbol.name} outside its file.`,
      );
    }
    return Object.freeze({
      declarationCount: symbol.declarations.length,
      declarations: Object.freeze(resolved),
      name: symbol.name,
    });
  }

  /**
   * A type and its union or intersection members; members are built before
   * the type that contains them, so the member graph has no cycle to wait on.
   */
  private async typeFact(type: Type): Promise<TypeScriptTypeFact> {
    const cached = this.typeFacts.get(type.id);
    if (cached) {
      await cached.described;
      return cached.fact;
    }
    const fact: MutableTypeFact = {
      callSignatureCount: 0,
      constituents: [],
      constructSignatureCount: 0,
      flags: type.flags,
    };
    const described = this.describeType({ fact, type });
    this.typeFacts.set(type.id, { described, fact });
    await described;
    return fact;
  }

  private async describeType(request: {
    readonly fact: MutableTypeFact;
    readonly type: Type;
  }): Promise<void> {
    const { fact, type } = request;
    const checker = this.request.checker;
    const [members = [], callSignatures, constructSignatures] =
      await Promise.all([
        type.isUnionType() || type.isIntersectionType() ? type.getTypes() : [],
        checker.getSignaturesOfType(type, SignatureKind.Call),
        checker.getSignaturesOfType(type, SignatureKind.Construct),
      ]);
    fact.constituents.push(
      ...(await Promise.all(members.map((member) => this.typeFact(member)))),
    );
    fact.callSignatureCount = callSignatures.length;
    fact.constructSignatureCount = constructSignatures.length;
  }
}
