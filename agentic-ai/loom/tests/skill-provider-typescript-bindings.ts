import ts from 'typescript';
import {
  CHILD_PROCESS_CALLS,
  SubprocessCallKind,
  WORKER_THREAD_CALLS,
} from './skill-provider-typescript-capability.ts';
import {
  isRunCommandDeclaration,
  lexicalScope,
} from './skill-provider-typescript-require.ts';

export type LexicalBinding = {
  readonly capability: SubprocessCallKind | false;
  readonly constant: boolean;
  readonly declaration: ts.Node;
  readonly importedFrom: string | false;
  readonly initializer: ts.Expression | false;
  readonly member: string | false;
  readonly name: string;
  readonly scope: ts.Node;
};

export type LexicalModel = {
  readonly bindings: readonly LexicalBinding[];
  readonly path: string;
};

export type BindingCollectionRequest = {
  readonly node: ts.Node;
  readonly target: LexicalBinding[];
};

export function collectBinding(request: BindingCollectionRequest): void {
  const node = request.node;
  if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
    const declarationList = node.parent;
    for (const element of node.name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const binding: LexicalBinding = {
        capability: false,
        constant:
          ts.isVariableDeclarationList(declarationList) &&
          Boolean(declarationList.flags & ts.NodeFlags.Const),
        declaration: element,
        importedFrom: false,
        initializer: node.initializer ?? false,
        member: ts.isIdentifier(element.propertyName ?? element.name)
          ? (element.propertyName ?? element.name).getText()
          : false,
        name: element.name.text,
        scope: lexicalScope(node),
      };
      request.target.push(binding);
    }
    return;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    const declarationList = node.parent;
    const binding: LexicalBinding = {
      capability: false,
      constant:
        ts.isVariableDeclarationList(declarationList) &&
        Boolean(declarationList.flags & ts.NodeFlags.Const),
      declaration: node,
      importedFrom: false,
      initializer: node.initializer ?? false,
      member: false,
      name: node.name.text,
      scope: lexicalScope(node),
    };
    request.target.push(binding);
    return;
  }
  if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
    const binding: LexicalBinding = {
      capability: false,
      constant: false,
      declaration: node,
      importedFrom: false,
      initializer: false,
      member: false,
      name: node.name.text,
      scope: lexicalScope(node),
    };
    request.target.push(binding);
    return;
  }
  if (ts.isFunctionDeclaration(node) && node.name) {
    const binding: LexicalBinding = {
      capability: isRunCommandDeclaration(node)
        ? SubprocessCallKind.RunCommand
        : false,
      constant: true,
      declaration: node,
      importedFrom: false,
      initializer: false,
      member: false,
      name: node.name.text,
      scope: node.parent,
    };
    request.target.push(binding);
    return;
  }
  if (ts.isClassDeclaration(node) && node.name) {
    const binding: LexicalBinding = {
      capability: false,
      constant: true,
      declaration: node,
      importedFrom: false,
      initializer: false,
      member: false,
      name: node.name.text,
      scope: node.parent,
    };
    request.target.push(binding);
    return;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression &&
    ts.isStringLiteral(node.moduleReference.expression)
  ) {
    const specifier = node.moduleReference.expression.text;
    const binding: LexicalBinding = {
      capability: /^(?:node:)?child_process$/u.test(specifier)
        ? SubprocessCallKind.Namespace
        : /^(?:node:)?worker_threads$/u.test(specifier)
          ? SubprocessCallKind.WorkerNamespace
          : false,
      constant: true,
      declaration: node,
      importedFrom: specifier,
      initializer: false,
      member: false,
      name: node.name.text,
      scope: node.getSourceFile(),
    };
    request.target.push(binding);
    return;
  }
  if (!ts.isImportDeclaration(node) || !node.importClause) return;
  const specifier = ts.isStringLiteral(node.moduleSpecifier)
    ? node.moduleSpecifier.text
    : '';
  if (node.importClause.name) {
    const binding: LexicalBinding = {
      capability: false,
      constant: true,
      declaration: node.importClause,
      importedFrom: specifier,
      initializer: false,
      member: 'default',
      name: node.importClause.name.text,
      scope: node.getSourceFile(),
    };
    request.target.push(binding);
  }
  const namedBindings = node.importClause.namedBindings;
  if (namedBindings && ts.isNamespaceImport(namedBindings)) {
    const binding: LexicalBinding = {
      capability: /^(?:node:)?child_process$/u.test(specifier)
        ? SubprocessCallKind.Namespace
        : /^(?:node:)?worker_threads$/u.test(specifier)
          ? SubprocessCallKind.WorkerNamespace
          : false,
      constant: true,
      declaration: namedBindings,
      importedFrom: specifier,
      initializer: false,
      member: false,
      name: namedBindings.name.text,
      scope: node.getSourceFile(),
    };
    request.target.push(binding);
  }
  if (!namedBindings || !ts.isNamedImports(namedBindings)) return;
  for (const element of namedBindings.elements) {
    const imported = (element.propertyName ?? element.name).text;
    const binding: LexicalBinding = {
      capability: /^(?:node:)?child_process$/u.test(specifier)
        ? (CHILD_PROCESS_CALLS.get(imported) ?? false)
        : /^(?:node:)?worker_threads$/u.test(specifier)
          ? (WORKER_THREAD_CALLS.get(imported) ?? false)
          : imported === 'runCommand' &&
              /(?:^|\/)lib\/run\.ts$/u.test(specifier)
            ? SubprocessCallKind.RunCommand
            : false,
      constant: true,
      declaration: element,
      importedFrom: specifier,
      initializer: false,
      member: imported,
      name: element.name.text,
      scope: node.getSourceFile(),
    };
    request.target.push(binding);
  }
}
