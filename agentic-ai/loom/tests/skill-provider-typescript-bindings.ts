import ts from 'typescript';

import { createHash } from 'node:crypto';

import {
  CHILD_PROCESS_CALLS,
  SubprocessCallKind,
  WORKER_THREAD_CALLS,
} from './skill-provider-typescript-capability.ts';

import { SkillProviderTypescriptRequireScenario } from './skill-provider-typescript-require.ts';
import type { AuthoredCommandDeclaration } from './skill-provider-typescript-require.ts';

export class SkillProviderTypescriptBindingsScenario {
  private constructor(private readonly request: DynamicCwdExemptionRequest) {}

  static dynamicCwdExemptions(
    request: DynamicCwdExemptionRequest,
  ): readonly AuthoredCommandDeclaration[] {
    return new SkillProviderTypescriptBindingsScenario(request).execute();
  }

  private execute(): readonly AuthoredCommandDeclaration[] {
    const request = this.request;
    return DYNAMIC_CWD_EXEMPTIONS.flatMap((exemption) => {
      if (
        request.path !== exemption.path &&
        !request.path.endsWith(`/${exemption.path}`)
      )
        return [];
      const matches = request.sourceFile.statements.flatMap(
        (statement): AuthoredCommandDeclaration[] => {
          if (ts.isFunctionDeclaration(statement))
            return statement.name?.text === exemption.functionName
              ? [statement]
              : [];
          if (!ts.isClassDeclaration(statement)) return [];
          return statement.members.filter(
            (member): member is ts.MethodDeclaration =>
              ts.isMethodDeclaration(member) &&
              ts.isIdentifier(member.name) &&
              member.name.text === exemption.functionName,
          );
        },
      );
      const match = matches[0];
      if (matches.length !== 1 || !match) return [];
      if (
        !ts.isMethodDeclaration(match) ||
        !ts.isClassDeclaration(match.parent) ||
        match.parent.name?.text !== exemption.className
      )
        return [];
      const digest = createHash('sha256').update(match.getText()).digest('hex');
      return digest === exemption.digest ? [match] : [];
    });
  }

  static dynamicEnvironmentExemptions(
    request: DynamicCwdExemptionRequest,
  ): readonly AuthoredCommandDeclaration[] {
    return DYNAMIC_ENVIRONMENT_EXEMPTIONS.flatMap((exemption) => {
      if (
        request.path !== exemption.path &&
        !request.path.endsWith(`/${exemption.path}`)
      )
        return [];
      const matches = request.sourceFile.statements.flatMap(
        (statement): AuthoredCommandDeclaration[] => {
          if (ts.isFunctionDeclaration(statement))
            return statement.name?.text === exemption.functionName
              ? [statement]
              : [];
          if (!ts.isClassDeclaration(statement)) return [];
          return statement.members.filter(
            (member): member is ts.MethodDeclaration =>
              ts.isMethodDeclaration(member) &&
              ts.isIdentifier(member.name) &&
              member.name.text === exemption.functionName,
          );
        },
      );
      const match = matches[0];
      if (matches.length !== 1 || !match) return [];
      if (
        !ts.isMethodDeclaration(match) ||
        !ts.isClassDeclaration(match.parent) ||
        match.parent.name?.text !== exemption.className
      )
        return [];
      const digest = createHash('sha256').update(match.getText()).digest('hex');
      return digest === exemption.digest ? [match] : [];
    });
  }

  static isDynamicCwdExempt([model, location]: readonly [
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

  static isDynamicEnvironmentExempt([model, location]: readonly [
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

  static bindingAt(request: BindingLookupRequest): LexicalBinding | false {
    let node: ts.Node = request.location;
    for (;;) {
      if (
        ts.isBlock(node) ||
        ts.isFunctionLike(node) ||
        ts.isSourceFile(node)
      ) {
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

  static hasBinding([model, location, name]: readonly [
    LexicalModel,
    ts.Node,
    string,
  ]): boolean {
    let node: ts.Node = location;
    for (;;) {
      if (
        (ts.isBlock(node) ||
          ts.isFunctionLike(node) ||
          ts.isSourceFile(node)) &&
        model.bindings.some(
          (candidate) => candidate.scope === node && candidate.name === name,
        )
      )
        return true;
      if (!node.parent) return false;
      node = node.parent;
    }
  }

  static lookupBinding([model, location, name]: readonly [
    LexicalModel,
    ts.Node,
    string,
  ]): LexicalBinding | false {
    const request: BindingLookupRequest = { location, model, name };
    return SkillProviderTypescriptBindingsScenario.bindingAt(request);
  }

  static collectBinding(request: BindingCollectionRequest): void {
    const node = request.node;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      const declarationList = node.parent;
      for (const element of node.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const [defaulted1 = false] = [node.initializer];
        const [defaulted2 = element.name] = [element.propertyName];
        const [defaulted3 = element.name] = [element.propertyName];
        const binding: LexicalBinding = {
          capability: false,
          constant:
            ts.isVariableDeclarationList(declarationList) &&
            Boolean(declarationList.flags & ts.NodeFlags.Const),
          declaration: element,
          importedFrom: false,
          initializer: defaulted1,
          member: ts.isIdentifier(defaulted2) ? defaulted3.getText() : false,
          name: element.name.text,
          scope: SkillProviderTypescriptRequireScenario.lexicalScope(node),
        };
        request.target.push(binding);
      }
      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const declarationList = node.parent;
      const [defaulted4 = false] = [node.initializer];
      const binding: LexicalBinding = {
        capability: false,
        constant:
          ts.isVariableDeclarationList(declarationList) &&
          Boolean(declarationList.flags & ts.NodeFlags.Const),
        declaration: node,
        importedFrom: false,
        initializer: defaulted4,
        member: false,
        name: node.name.text,
        scope: SkillProviderTypescriptRequireScenario.lexicalScope(node),
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
        scope: SkillProviderTypescriptRequireScenario.lexicalScope(node),
      };
      request.target.push(binding);
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      const binding: LexicalBinding = {
        capability:
          SkillProviderTypescriptRequireScenario.isRunCommandDeclaration(node)
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
      const [defaulted5 = element.name] = [element.propertyName];
      const imported = defaulted5.text;
      const [defaulted6 = false] = [CHILD_PROCESS_CALLS.get(imported)];
      const [defaulted7 = false] = [WORKER_THREAD_CALLS.get(imported)];
      const binding: LexicalBinding = {
        capability: /^(?:node:)?child_process$/u.test(specifier)
          ? defaulted6
          : /^(?:node:)?worker_threads$/u.test(specifier)
            ? defaulted7
            : specifier === 'bun' && imported === '$'
              ? SubprocessCallKind.BunShell
              : imported === 'HostCommand' &&
                  /(?:^|\/)lib\/run\.ts$/u.test(specifier)
                ? SubprocessCallKind.HostCommand
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

  static importedMember([expression, location, model]: readonly [
    ts.Expression,
    ts.Node,
    LexicalModel,
  ]): readonly [string, string] | false {
    if (ts.isIdentifier(expression)) {
      const binding = SkillProviderTypescriptBindingsScenario.lookupBinding([
        model,
        location,
        expression.text,
      ]);
      return binding !== false && binding.importedFrom && binding.member
        ? [binding.importedFrom, binding.member]
        : false;
    }
    if (
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression)
    ) {
      const binding = SkillProviderTypescriptBindingsScenario.lookupBinding([
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

  static nodePromisifyTarget([call, model]: readonly [
    ts.CallExpression,
    LexicalModel,
  ]): ts.Expression | false {
    const imported = SkillProviderTypescriptBindingsScenario.importedMember([
      call.expression,
      call,
      model,
    ]);
    const [target] = call.arguments;
    return imported !== false &&
      /^(?:node:)?util$/u.test(imported[0]) &&
      imported[1] === 'promisify' &&
      call.arguments.length === 1 &&
      target
      ? target
      : false;
  }
}

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
  readonly dynamicCwdExemptions: readonly AuthoredCommandDeclaration[];
  readonly dynamicEnvironmentExemptions?: readonly AuthoredCommandDeclaration[];
  readonly path: string;
};

export type DynamicCwdExemptionRequest = {
  readonly path: string;
  readonly sourceFile: ts.SourceFile;
};

type DynamicCwdExemption = {
  readonly digest: string;
  readonly className: string;
  readonly functionName: string;
  readonly path: string;
};

const DYNAMIC_CWD_EXEMPTIONS: readonly DynamicCwdExemption[] = [
  {
    digest: '869bd43eef08b1fe97a911f626c0e72d854fc75ebee51c2bdf93f62e413aa700',
    className: 'ExecutableSkillPackageGate',
    functionName: 'runCommand',
    path: 'agentic-ai/loom/src/executable-skills/package-gate.ts',
  },
];

const DYNAMIC_ENVIRONMENT_EXEMPTIONS: readonly DynamicCwdExemption[] = [
  // The exact helper adds only GitHub's authenticated HTTPS header to the
  // trusted host environment for one fixed git push invocation.
  {
    digest: '4125c0b8ad204f30f5102367d50239e19d639f18e56a2dd1292210d50cd6b1df',
    className: 'CiRepository',
    functionName: 'pushAuthenticatedBranch',
    path: 'agentic-ai/ci-agent/src/main/git.ts',
  },
  // The exact helper is reachable only through the proven git/tar snapshot
  // calls and receives the runtime contract's audited platform allowlist.
  {
    digest: '625f72c6dbcace56e5832d3621ace71f9a3760991d94fb1b5e5e0eb9bba39bec',
    className: 'ModuleExpertIsolation',
    functionName: 'captureIsolatedCommand',
    path: 'agentic-ai/loom/src/module-experts/runtime-contract.ts',
  },
];

export type BindingCollectionRequest = {
  readonly node: ts.Node;
  readonly target: LexicalBinding[];
};

export type BindingLookupRequest = {
  readonly location: ts.Node;
  readonly model: LexicalModel;
  readonly name: string;
};
