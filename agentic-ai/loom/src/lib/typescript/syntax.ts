import * as ts from 'typescript/unstable/ast';

type ModifiableNode = ts.Node & {
  readonly modifiers?: ts.NodeArray<ts.ModifierLike>;
};

const MODIFIABLE_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.TypeParameter,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.IndexSignature,
  ts.SyntaxKind.ConstructorType,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.ClassExpression,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.ImportEqualsDeclaration,
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.ExportDeclaration,
]);

const TYPE_KEYWORD_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AnyKeyword,
  ts.SyntaxKind.UnknownKeyword,
  ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.BigIntKeyword,
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.BooleanKeyword,
  ts.SyntaxKind.SymbolKeyword,
  ts.SyntaxKind.ObjectKeyword,
  ts.SyntaxKind.UndefinedKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.NeverKeyword,
]);

const TYPE_ANNOTATED_PARENT_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.CallSignature,
  ts.SyntaxKind.ConstructSignature,
  ts.SyntaxKind.IndexSignature,
  ts.SyntaxKind.TypeAssertionExpression,
]);

const TYPE_ARGUMENT_PARENT_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.CallExpression,
  ts.SyntaxKind.NewExpression,
  ts.SyntaxKind.TaggedTemplateExpression,
]);

type TypeAnnotatedNode = ts.Node & { readonly type?: ts.Node };

type TypeArgumentNode = ts.Node & {
  readonly typeArguments?: ts.NodeArray<ts.TypeNode>;
};

/**
 * Owns the TypeScript 6 syntax predicates that the TypeScript 7 AST surface no
 * longer exports, with the same node-kind semantics.
 */
export class TypeScriptSyntax {
  private constructor() {}

  /** TypeScript 6 `canHaveModifiers`. */
  static canHaveModifiers(node: ts.Node): node is ModifiableNode {
    return MODIFIABLE_KINDS.has(node.kind);
  }

  /**
   * TypeScript 6 `ImportClause.isTypeOnly`: TypeScript 7 records `import type`
   * as the clause phase modifier.
   */
  static isTypeOnlyImportClause(node: ts.Node): boolean {
    return (
      ts.isImportClause(node) &&
      node.phaseModifier === ts.SyntaxKind.TypeKeyword
    );
  }

  /**
   * TypeScript 6 `ObjectLiteralElementLike.name`: TypeScript 7 gives a spread
   * assignment no name.
   */
  static objectElementName(
    element: ts.ObjectLiteralElementLike,
  ): ts.PropertyName | false {
    return ts.isSpreadAssignment(element) ? false : element.name;
  }

  /**
   * TypeScript 6 `ShorthandPropertyAssignment.name`, always an identifier;
   * TypeScript 7 types it as any property name.
   */
  static shorthandName(
    assignment: ts.ShorthandPropertyAssignment,
  ): ts.Identifier {
    if (!ts.isIdentifier(assignment.name)) {
      throw new Error('A shorthand property name must be an identifier.');
    }
    return assignment.name;
  }

  /** TypeScript 6 `getModifiers`: syntactic modifiers, without decorators. */
  static modifiers(node: ts.Node): readonly ts.Modifier[] {
    if (!TypeScriptSyntax.canHaveModifiers(node)) return [];
    const modifiers = node.modifiers;
    if (!modifiers) return [];
    return modifiers.filter((modifier): modifier is ts.Modifier =>
      ts.isModifier(modifier),
    );
  }

  /** TypeScript 6 `isPartOfTypeNode`. */
  static isPartOfTypeNode(node: ts.Node): boolean {
    if (TypeScriptSyntax.isTypeNodeKind(node.kind)) return true;
    if (TYPE_KEYWORD_KINDS.has(node.kind)) return true;
    if (node.kind === ts.SyntaxKind.VoidKeyword) {
      return node.parent.kind !== ts.SyntaxKind.VoidExpression;
    }
    if (ts.isExpressionWithTypeArguments(node)) {
      return TypeScriptSyntax.isPartOfTypeExpressionWithTypeArguments(node);
    }
    if (node.kind === ts.SyntaxKind.TypeParameter) {
      return (
        node.parent.kind === ts.SyntaxKind.MappedType ||
        node.parent.kind === ts.SyntaxKind.InferType
      );
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const container =
        (ts.isQualifiedName(parent) && parent.right === node) ||
        (ts.isPropertyAccessExpression(parent) && parent.name === node)
          ? parent
          : node;
      return TypeScriptSyntax.isTypeReferenceInContainer(container);
    }
    if (
      ts.isQualifiedName(node) ||
      ts.isPropertyAccessExpression(node) ||
      node.kind === ts.SyntaxKind.ThisKeyword
    ) {
      return TypeScriptSyntax.isTypeReferenceInContainer(node);
    }
    return false;
  }

  private static isTypeNodeKind(kind: ts.SyntaxKind): boolean {
    return (
      kind >= ts.SyntaxKind.FirstTypeNode && kind <= ts.SyntaxKind.LastTypeNode
    );
  }

  private static isTypeReferenceInContainer(node: ts.Node): boolean {
    const parent = node.parent;
    if (ts.isTypeQueryNode(parent)) return false;
    if (ts.isImportTypeNode(parent)) return !parent.isTypeOf;
    if (TypeScriptSyntax.isTypeNodeKind(parent.kind)) return true;
    if (ts.isExpressionWithTypeArguments(parent)) {
      return TypeScriptSyntax.isPartOfTypeExpressionWithTypeArguments(parent);
    }
    if (ts.isTypeParameterDeclaration(parent)) {
      return node === parent.constraint;
    }
    if (ts.isJSDocTemplateTag(parent)) return node === parent.constraint;
    if (TYPE_ANNOTATED_PARENT_KINDS.has(parent.kind)) {
      const annotated: TypeAnnotatedNode = parent;
      return node === annotated.type;
    }
    if (TYPE_ARGUMENT_PARENT_KINDS.has(parent.kind)) {
      const invocation: TypeArgumentNode = parent;
      const typeArguments = invocation.typeArguments;
      return Boolean(
        typeArguments &&
        typeArguments.some((typeArgument) => typeArgument === node),
      );
    }
    return false;
  }

  private static isPartOfTypeExpressionWithTypeArguments(
    node: ts.ExpressionWithTypeArguments,
  ): boolean {
    const parent = node.parent;
    if (ts.isJSDocImplementsTag(parent) || ts.isJSDocAugmentsTag(parent)) {
      return true;
    }
    if (!ts.isHeritageClause(parent)) return false;
    const extendsClass =
      ts.isClassLikeDeclaration(parent.parent) &&
      parent.token !== ts.SyntaxKind.ImplementsKeyword;
    return !extendsClass;
  }
}
