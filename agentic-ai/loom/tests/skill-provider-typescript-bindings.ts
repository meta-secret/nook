import ts from 'typescript';
import { createHash } from 'node:crypto';
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
  readonly dynamicCwdExemptions: readonly ts.FunctionDeclaration[];
  readonly dynamicEnvironmentExemptions?: readonly ts.FunctionDeclaration[];
  readonly path: string;
};

export type DynamicCwdExemptionRequest = {
  readonly path: string;
  readonly sourceFile: ts.SourceFile;
};

type DynamicCwdExemption = {
  readonly digest: string;
  readonly functionName: string;
  readonly path: string;
};
const DYNAMIC_CWD_EXEMPTIONS: readonly DynamicCwdExemption[] = [
  {
    digest: '766be918ab58c5e1721d05b89fcfe3759f510387da364afa30832db6cd0a6e92',
    functionName: 'runCommand',
    path: 'agentic-ai/loom/src/executable-skills/package-gate.ts',
  },
];
const DYNAMIC_ENVIRONMENT_EXEMPTIONS: readonly DynamicCwdExemption[] = [
  // The exact helper adds only GitHub's authenticated HTTPS header to the
  // trusted host environment for one fixed git push invocation.
  {
    digest: 'f3b7c182c601b7e552dd5d9f2f4f59c01a5f0cc01b6aa44a5dd3852a47ee94de',
    functionName: 'pushAuthenticatedBranch',
    path: 'agentic-ai/ci-agent/src/main/git.ts',
  },
  // The exact helper is reachable only through the proven git/tar snapshot
  // calls and receives the runtime contract's audited platform allowlist.
  {
    digest: 'fa7e1e512f530c597366bbe7e65ae321f911aa6da7951e99d54fed1f978ab95c',
    functionName: 'captureIsolatedCommand',
    path: 'agentic-ai/loom/src/module-experts/runtime-contract.ts',
  },
];

export function dynamicCwdExemptions(
  request: DynamicCwdExemptionRequest,
): readonly ts.FunctionDeclaration[] {
  return DYNAMIC_CWD_EXEMPTIONS.flatMap((exemption) => {
    if (
      request.path !== exemption.path &&
      !request.path.endsWith(`/${exemption.path}`)
    )
      return [];
    const matches = request.sourceFile.statements.filter(
      (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) &&
        node.name?.text === exemption.functionName,
    );
    const match = matches[0];
    if (matches.length !== 1 || !match) return [];
    const digest = createHash('sha256').update(match.getText()).digest('hex');
    return digest === exemption.digest ? [match] : [];
  });
}

export function dynamicEnvironmentExemptions(
  request: DynamicCwdExemptionRequest,
): readonly ts.FunctionDeclaration[] {
  return DYNAMIC_ENVIRONMENT_EXEMPTIONS.flatMap((exemption) => {
    if (
      request.path !== exemption.path &&
      !request.path.endsWith(`/${exemption.path}`)
    )
      return [];
    const matches = request.sourceFile.statements.filter(
      (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) &&
        node.name?.text === exemption.functionName,
    );
    const match = matches[0];
    if (matches.length !== 1 || !match) return [];
    const digest = createHash('sha256').update(match.getText()).digest('hex');
    return digest === exemption.digest ? [match] : [];
  });
}

export function isDynamicCwdExempt([model, location]: readonly [
  LexicalModel,
  ts.Node,
]): boolean {
  let node = location;
  for (;;) {
    if (model.dynamicCwdExemptions.some((candidate) => candidate === node))
      return true;
    if (!node.parent) return false;
    node = node.parent;
  }
}

export function isDynamicEnvironmentExempt([model, location]: readonly [
  LexicalModel,
  ts.Node,
]): boolean {
  let node = location;
  for (;;) {
    if (
      model.dynamicEnvironmentExemptions?.some(
        (candidate) => candidate === node,
      )
    )
      return true;
    if (!node.parent) return false;
    node = node.parent;
  }
}

export type BindingCollectionRequest = {
  readonly node: ts.Node;
  readonly target: LexicalBinding[];
};
export type BindingLookupRequest = {
  readonly location: ts.Node;
  readonly model: LexicalModel;
  readonly name: string;
};

export function bindingAt(
  request: BindingLookupRequest,
): LexicalBinding | false {
  let node: ts.Node = request.location;
  for (;;) {
    if (ts.isBlock(node) || ts.isFunctionLike(node) || ts.isSourceFile(node)) {
      const binding = request.model.bindings.find(
        (candidate) =>
          candidate.scope === node && candidate.name === request.name,
      );
      if (binding) return binding;
    }
    if (!node.parent) return false;
    node = node.parent;
  }
}

export function hasBinding([model, location, name]: readonly [
  LexicalModel,
  ts.Node,
  string,
]): boolean {
  let node: ts.Node = location;
  for (;;) {
    if (
      (ts.isBlock(node) || ts.isFunctionLike(node) || ts.isSourceFile(node)) &&
      model.bindings.some(
        (candidate) => candidate.scope === node && candidate.name === name,
      )
    )
      return true;
    if (!node.parent) return false;
    node = node.parent;
  }
}

export function lookupBinding([model, location, name]: readonly [
  LexicalModel,
  ts.Node,
  string,
]): LexicalBinding | false {
  const request: BindingLookupRequest = { location, model, name };
  return bindingAt(request);
}

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
      capability: /^(?:node:)?child_process$/u.test(specifier)
        ? SubprocessCallKind.Namespace
        : /^(?:node:)?worker_threads$/u.test(specifier)
          ? SubprocessCallKind.WorkerNamespace
          : specifier === 'bun'
            ? SubprocessCallKind.BunNamespace
            : false,
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
          : specifier === 'bun'
            ? SubprocessCallKind.BunNamespace
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
          : specifier === 'bun' && imported === '$'
            ? SubprocessCallKind.BunShell
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

export function importedMember([expression, location, model]: readonly [
  ts.Expression,
  ts.Node,
  LexicalModel,
]): readonly [string, string] | false {
  if (ts.isIdentifier(expression)) {
    const binding = lookupBinding([model, location, expression.text]);
    return binding !== false && binding.importedFrom && binding.member
      ? [binding.importedFrom, binding.member]
      : false;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    const binding = lookupBinding([
      model,
      location,
      expression.expression.text,
    ]);
    return binding !== false &&
      binding.importedFrom &&
      (!binding.member || binding.member === 'default')
      ? [binding.importedFrom, expression.name.text]
      : false;
  }
  return false;
}

export function nodePromisifyTarget([call, model]: readonly [
  ts.CallExpression,
  LexicalModel,
]): ts.Expression | false {
  const imported = importedMember([call.expression, call, model]);
  const [target] = call.arguments;
  return imported !== false &&
    /^(?:node:)?util$/u.test(imported[0]) &&
    imported[1] === 'promisify' &&
    call.arguments.length === 1 &&
    target
    ? target
    : false;
}
