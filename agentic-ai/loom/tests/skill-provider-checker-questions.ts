import * as ts from 'typescript/unstable/ast';

import {
  TypeScriptCheckerFacts,
  TypeScriptNameMeaning,
  type TypeScriptNameQuestions,
  type TypeScriptTypeQuestions,
} from '../src/lib/typescript/checker-facts.ts';

/**
 * Owns the compiler questions the boundary scenarios can ask about a source.
 *
 * Each name lookup and each described type is a separate compiler request,
 * and the boundary scenarios check hundreds of repository sources, so a type
 * context collects only what the scenarios can query. A query outside these
 * questions fails closed in `TypeScriptCheckerFacts`.
 */
export class SkillProviderCheckerQuestions {
  private constructor() {}

  /**
   * `isAmbientIdentifier` is the only name lookup, and every caller first
   * matches the identifier against one of these ambient roots.
   */
  static readonly NAMES: TypeScriptNameQuestions = {
    identifiers: (identifier) => AMBIENT_IDENTIFIER_NAMES.has(identifier.text),
    meanings: [TypeScriptNameMeaning.Value],
  };

  /**
   * The dynamic-evaluator scenario asks for types only behind a computed
   * element access or a binding-element default, so a source with neither
   * needs none.
   */
  static types(sourceFile: ts.SourceFile): TypeScriptTypeQuestions {
    let asked = false;
    const visit = (node: ts.Node): void => {
      if (asked) return;
      if (
        SkillProviderCheckerQuestions.isComputedElementAccess(node) ||
        (ts.isBindingElement(node) && Boolean(node.initializer))
      ) {
        asked = true;
        return;
      }
      node.forEachChild(visit);
    };
    visit(sourceFile);
    return asked
      ? { expressions: SkillProviderCheckerQuestions.mayAskTypeOf }
      : TypeScriptCheckerFacts.NO_TYPES;
  }

  /**
   * The expressions whose type the dynamic-evaluator scenario reads: a
   * computed element access, its receiver, and every runtime receiver it
   * recovers. A recovered receiver is an initializer, an array element, a
   * property initializer, or a shorthand name, each with its transparent
   * wrappers (parentheses, `as`, `<T>`, `!`, `satisfies`) removed.
   */
  static mayAskTypeOf(expression: ts.Expression): boolean {
    if (SkillProviderCheckerQuestions.isComputedElementAccess(expression)) {
      return true;
    }
    let current: ts.Node = expression;
    for (;;) {
      const parent = current.parent;
      if (
        (SkillProviderCheckerQuestions.isComputedElementAccess(parent) &&
          parent.expression === current) ||
        ((ts.isVariableDeclaration(parent) ||
          ts.isParameterDeclaration(parent) ||
          ts.isBindingElement(parent)) &&
          parent.initializer === current) ||
        ts.isArrayLiteralExpression(parent) ||
        (ts.isPropertyAssignment(parent) && parent.initializer === current) ||
        (ts.isShorthandPropertyAssignment(parent) && parent.name === current)
      ) {
        return true;
      }
      if (
        !SkillProviderCheckerQuestions.isTransparentWrapper(parent) ||
        parent.expression !== current
      ) {
        return false;
      }
      current = parent;
    }
  }

  private static isComputedElementAccess(
    node: ts.Node,
  ): node is ts.ElementAccessExpression {
    return (
      ts.isElementAccessExpression(node) &&
      !ts.isNumericLiteral(node.argumentExpression)
    );
  }

  private static isTransparentWrapper(
    node: ts.Node,
  ): node is
    | ts.ParenthesizedExpression
    | ts.AsExpression
    | ts.TypeAssertion
    | ts.NonNullExpression
    | ts.SatisfiesExpression {
    return (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertion(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    );
  }
}

/** Every identifier text `isAmbientIdentifier` is asked about. */
const AMBIENT_IDENTIFIER_NAMES: ReadonlySet<string> = new Set([
  'AsyncFunction',
  'Function',
  'GeneratorFunction',
  'Object',
  'Reflect',
  'eval',
  'global',
  'globalThis',
  'module',
  'process',
  'require',
]);
