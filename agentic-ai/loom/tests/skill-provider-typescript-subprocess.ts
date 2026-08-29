import ts from 'typescript';
import { posix } from 'node:path';
import {
  isRunCommandDeclaration,
  isStaticChildProcessRequire,
  lexicalScope,
} from './skill-provider-typescript-require.ts';
import {
  bunShellTemplateCommand,
  CHILD_PROCESS_CALLS,
  serializeSubprocessCommand,
  staticMemberAccess,
  SubprocessCallKind,
  type BunShellTemplateRequest,
} from './skill-provider-typescript-capability.ts';

export type TypeScriptSubprocessInspection = {
  readonly path: string;
  readonly source: string;
};
type StaticText = { readonly dynamic: boolean; readonly value: string };
type StaticCommand = {
  readonly shellSource: boolean;
  readonly words: readonly StaticText[];
};
type LexicalBinding = {
  readonly capability: SubprocessCallKind | false;
  readonly constant: boolean;
  readonly declaration: ts.Node;
  readonly importedFrom: string | false;
  readonly initializer: ts.Expression | false;
  readonly member: string | false;
  readonly name: string;
  readonly scope: ts.Node;
};
type LexicalModel = {
  readonly bindings: readonly LexicalBinding[];
  readonly path: string;
};
type ExpressionEvaluationRequest = {
  readonly depth: number;
  readonly expression: ts.Expression;
  readonly location: ts.Node;
  readonly model: LexicalModel;
  readonly visited: ReadonlySet<ts.Node>;
};
type CallCommandRequest = {
  readonly call: ts.CallExpression;
  readonly kind: SubprocessCallKind;
  readonly model: LexicalModel;
};
type ArrayEvaluationRequest = {
  readonly expression: ts.ArrayLiteralExpression;
  readonly location: ts.Node;
  readonly model: LexicalModel;
};
type ArrayResolutionRequest = {
  readonly expression: ts.Expression;
  readonly location: ts.Node;
  readonly model: LexicalModel;
  readonly visited: ReadonlySet<ts.Node>;
};
type CapabilityResolutionRequest = {
  readonly expression: ts.Expression;
  readonly location: ts.Node;
  readonly model: LexicalModel;
  readonly visited: ReadonlySet<ts.Node>;
};
type BindingLookupRequest = {
  readonly location: ts.Node;
  readonly model: LexicalModel;
  readonly name: string;
};
const MAX_BYTES = 65_536;
const MAX_DEPTH = 16;
const MAX_NODES = 65_536;
const encoder = new TextEncoder();
export function typescriptSubprocessCommands(
  inspection: TypeScriptSubprocessInspection,
): readonly string[] {
  if (encoder.encode(inspection.source).byteLength > MAX_BYTES)
    throw new Error(
      'TypeScript subprocess source exceeds its UTF-8 byte bound.',
    );
  const sourceFile = ts.createSourceFile(
    inspection.path,
    inspection.source,
    ts.ScriptTarget.ES2022,
    true,
    inspection.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let nodeCount = 0;
  const bindings: LexicalBinding[] = [];
  const collect = (node: ts.Node): void => {
    if (++nodeCount > MAX_NODES)
      throw new Error('TypeScript subprocess AST exceeds its node bound.');
    const collectionRequest: BindingCollectionRequest = {
      node,
      target: bindings,
    };
    collectBinding(collectionRequest);
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  const model: LexicalModel = { bindings, path: inspection.path };
  const commands: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const capabilityRequest: CapabilityResolutionRequest = {
        expression: node.expression,
        location: node,
        model,
        visited: new Set(),
      };
      const kind = resolveCapability(capabilityRequest);
      if (kind !== false) {
        const callRequest: CallCommandRequest = { call: node, kind, model };
        const command = commandFromCall(callRequest);
        if (command !== false)
          commands.push(serializeSubprocessCommand(command));
      }
    }
    if (ts.isTaggedTemplateExpression(node)) {
      const capabilityRequest: CapabilityResolutionRequest = {
        expression: node.tag,
        location: node,
        model,
        visited: new Set(),
      };
      const templateRequest: BunShellTemplateRequest = {
        capability: resolveCapability(capabilityRequest),
        evaluate: (expression) => {
          const evaluationRequest: ExpressionEvaluationRequest = {
            depth: 0,
            expression,
            location: node,
            model,
            visited: new Set(),
          };
          return evaluateText(evaluationRequest);
        },
        tagged: node,
      };
      const command = bunShellTemplateCommand(templateRequest);
      if (command !== false) commands.push(command);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return commands;
}
type BindingCollectionRequest = {
  readonly node: ts.Node;
  readonly target: LexicalBinding[];
};

function collectBinding(request: BindingCollectionRequest): void {
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
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression &&
    ts.isStringLiteral(node.moduleReference.expression)
  ) {
    const binding: LexicalBinding = {
      capability: /^(?:node:)?child_process$/u.test(
        node.moduleReference.expression.text,
      )
        ? SubprocessCallKind.Namespace
        : false,
      constant: true,
      declaration: node,
      importedFrom: node.moduleReference.expression.text,
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
        : imported === 'runCommand' && /(?:^|\/)lib\/run\.ts$/u.test(specifier)
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

function resolveCapability(
  request: CapabilityResolutionRequest,
): SubprocessCallKind | false {
  if (request.visited.has(request.expression)) return false;
  const visited = new Set(request.visited).add(request.expression);
  const expression = unwrapExpression(request.expression);
  if (ts.isIdentifier(expression)) {
    const lookupRequest: BindingLookupRequest = {
      location: request.location,
      model: request.model,
      name: expression.text,
    };
    const binding = bindingAt(lookupRequest);
    if (binding === false) return false;
    if (binding.capability !== false) return binding.capability;
    if (!binding.constant || binding.initializer === false) return false;
    if (binding.member !== false) {
      const ownerRequest: CapabilityResolutionRequest = {
        expression: binding.initializer,
        location: binding.initializer,
        model: request.model,
        visited,
      };
      return resolveCapability(ownerRequest) === SubprocessCallKind.Namespace
        ? (CHILD_PROCESS_CALLS.get(binding.member) ?? false)
        : false;
    }
    const nestedRequest: CapabilityResolutionRequest = {
      expression: binding.initializer,
      location: binding.initializer,
      model: request.model,
      visited,
    };
    return resolveCapability(nestedRequest);
  }
  if (
    isStaticChildProcessRequire(expression) &&
    !hasBinding([request.model, request.location, 'require'])
  )
    return SubprocessCallKind.Namespace;
  const access = staticMemberAccess(expression);
  if (access === false) return false;
  const [owner, member] = access;
  if (ts.isIdentifier(owner) && owner.text === 'Bun') {
    if (hasBinding([request.model, request.location, 'Bun'])) return false;
    if (member === '$') return SubprocessCallKind.BunShell;
    return member === 'spawn' || member === 'spawnSync'
      ? SubprocessCallKind.Bun
      : false;
  }
  const ownerRequest: CapabilityResolutionRequest = {
    expression: owner,
    location: request.location,
    model: request.model,
    visited,
  };
  return resolveCapability(ownerRequest) === SubprocessCallKind.Namespace
    ? (CHILD_PROCESS_CALLS.get(member) ?? false)
    : false;
}

function bindingAt(request: BindingLookupRequest): LexicalBinding | false {
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

function hasBinding([model, location, name]: readonly [
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

function lookupBinding([model, location, name]: readonly [
  LexicalModel,
  ts.Node,
  string,
]): LexicalBinding | false {
  const request: BindingLookupRequest = { location, model, name };
  return bindingAt(request);
}

function commandFromCall(request: CallCommandRequest): StaticCommand | false {
  const first = request.call.arguments[0];
  if (!first) throw new Error('Recognized subprocess call has no command.');
  if (request.kind === SubprocessCallKind.Bun) {
    const expressionRequest: CallExpressionRequest = {
      expression: first,
      request,
    };
    const commandRequest: CallExpressionRequest = {
      ...expressionRequest,
      expression: bunCommandExpression(expressionRequest),
    };
    return commandFromExpression(commandRequest);
  }
  if (request.kind === SubprocessCallKind.Exec) {
    const expressionRequest: CallExpressionRequest = {
      expression: first,
      request,
    };
    return shellCommand(expressionRequest);
  }
  if (request.kind === SubprocessCallKind.RunCommand)
    return commandFromRunCommand(request);
  if (request.kind === SubprocessCallKind.Fork) {
    const expressionRequest: CallExpressionRequest = {
      expression: first,
      request,
    };
    const module = evaluate(expressionRequest);
    const argumentRequest: OptionalCallExpressionRequest = {
      expression: request.call.arguments[1] ?? false,
      request,
    };
    const argumentsValue = callArguments(argumentRequest);
    return {
      shellSource: false,
      words: [{ dynamic: false, value: 'node' }, module, ...argumentsValue],
    };
  }
  const expressionRequest: CallExpressionRequest = {
    expression: first,
    request,
  };
  const executable = evaluate(expressionRequest);
  const argumentRequest: OptionalCallExpressionRequest = {
    expression: request.call.arguments[1] ?? false,
    request,
  };
  const argumentsValue = callArguments(argumentRequest);
  if (executable.dynamic) {
    if (isExactRunCommandDispatch(request)) return false;
    const values = finiteParameterMemberValues([first, request]);
    if (
      values !== false &&
      values.length > 0 &&
      values.every(
        (value) => !value.dynamic && /^(?:git|tar)$/u.test(value.value),
      )
    )
      return false;
    throw new Error(
      `Dynamic TypeScript subprocess executable is forbidden in ${request.model.path}: ${request.call.getText()}`,
    );
  }
  return {
    shellSource: false,
    words: [executable, ...argumentsValue],
  };
}

function commandFromRunCommand(request: CallCommandRequest): StaticCommand {
  const first = request.call.arguments[0];
  if (!first) throw new Error('runCommand requires one exact request.');
  const resolutionRequest: ArrayResolutionRequest = {
    expression: first,
    location: request.call,
    model: request.model,
    visited: new Set(),
  };
  const resolved = resolveStaticExpression(resolutionRequest);
  if (!ts.isObjectLiteralExpression(resolved))
    throw new Error('Dynamic runCommand request is forbidden.');
  const command = exactObjectProperty([resolved, 'command']);
  if (command === false) throw new Error('runCommand command is not exact.');
  const commandRequest: CallExpressionRequest = {
    expression: command,
    request,
  };
  const executable = evaluate(commandRequest);
  if (executable.dynamic)
    throw new Error('Dynamic runCommand executable is forbidden.');
  const argumentRequest: OptionalCallExpressionRequest = {
    expression: exactObjectProperty([resolved, 'args']),
    request,
  };
  return {
    shellSource: false,
    words: [executable, ...callArguments(argumentRequest)],
  };
}

function exactObjectProperty([object, name]: readonly [
  ts.ObjectLiteralExpression,
  string,
]): ts.Expression | false {
  const matches = object.properties.filter(
    (candidate) => candidate.name?.getText() === name,
  );
  const match = matches[0];
  return matches.length === 1 && match && ts.isPropertyAssignment(match)
    ? match.initializer
    : false;
}

function isExactRunCommandDispatch(request: CallCommandRequest): boolean {
  const [command, args] = request.call.arguments;
  if (!command || !args || !ts.isIdentifier(command)) return false;
  const binding = lookupBinding([request.model, command, command.text]);
  const initializer = binding === false ? false : binding.initializer;
  if (
    binding === false ||
    binding.member !== 'command' ||
    !initializer ||
    !ts.isIdentifier(initializer)
  )
    return false;
  const input = lookupBinding([request.model, initializer, initializer.text]);
  const [spread] = ts.isArrayLiteralExpression(args) ? args.elements : [];
  if (
    input === false ||
    !ts.isParameter(input.declaration) ||
    !ts.isFunctionDeclaration(input.declaration.parent) ||
    !isRunCommandDeclaration(input.declaration.parent) ||
    !ts.isArrayLiteralExpression(args) ||
    args.elements.length !== 1 ||
    !spread ||
    !ts.isSpreadElement(spread) ||
    !ts.isIdentifier(spread.expression)
  )
    return false;
  const argsBinding = lookupBinding([
    request.model,
    spread,
    spread.expression.text,
  ]);
  return (
    argsBinding !== false &&
    argsBinding.member === 'args' &&
    argsBinding.initializer === initializer
  );
}

function finiteParameterMemberValues([expression, request]: readonly [
  ts.Expression,
  CallCommandRequest,
]): readonly StaticText[] | false {
  let parameter: LexicalBinding | false = false;
  let member = '';
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    parameter = lookupBinding([
      request.model,
      expression,
      expression.expression.text,
    ]);
    member = expression.name.text;
  } else if (ts.isIdentifier(expression)) {
    const binding = lookupBinding([request.model, expression, expression.text]);
    const initializer = binding === false ? false : binding.initializer;
    if (
      binding !== false &&
      binding.member &&
      initializer &&
      ts.isIdentifier(initializer)
    ) {
      parameter = lookupBinding([request.model, initializer, initializer.text]);
      member = binding.member;
    }
  }
  if (parameter === false || !ts.isParameter(parameter.declaration))
    return false;
  return parameterMemberCallValues([
    parameter,
    member,
    request.model,
    new Set(),
  ]);
}

function parameterMemberCallValues([
  parameter,
  member,
  model,
  visited,
]: readonly [LexicalBinding, string, LexicalModel, ReadonlySet<ts.Node>]):
  readonly StaticText[] | false {
  if (visited.has(parameter.declaration)) return false;
  const declaration = parameter.declaration;
  if (!ts.isParameter(declaration)) return false;
  const owner = declaration.parent;
  if (!ts.isFunctionDeclaration(owner) || !owner.name) return false;
  const ownerBinding = model.bindings.find(
    (candidate) => candidate.declaration === owner,
  );
  const parameterIndex = owner.parameters.indexOf(declaration);
  if (!ownerBinding || parameterIndex < 0) return false;
  const values: StaticText[] = [];
  let invalid = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      lookupBinding([model, node, node.expression.text]) === ownerBinding
    ) {
      const argument = node.arguments[parameterIndex];
      const value = argument
        ? parameterArgumentMember([
            argument,
            member,
            model,
            new Set(visited).add(declaration),
          ])
        : false;
      if (value === false) invalid = true;
      else values.push(...value);
    }
    ts.forEachChild(node, visit);
  };
  visit(owner.getSourceFile());
  return invalid || values.length === 0 ? false : values;
}

function parameterArgumentMember([argument, member, model, visited]: readonly [
  ts.Expression,
  string,
  LexicalModel,
  ReadonlySet<ts.Node>,
]): readonly StaticText[] | false {
  const resolutionRequest: ArrayResolutionRequest = {
    expression: argument,
    location: argument,
    model,
    visited: new Set(),
  };
  const resolved = resolveStaticExpression(resolutionRequest);
  if (ts.isObjectLiteralExpression(resolved)) {
    const property = exactObjectProperty([resolved, member]);
    if (property === false) return false;
    const evaluationRequest: ExpressionEvaluationRequest = {
      depth: 0,
      expression: property,
      location: argument,
      model,
      visited: new Set(),
    };
    return [evaluateText(evaluationRequest)];
  }
  if (!ts.isIdentifier(resolved)) return false;
  const binding = lookupBinding([model, argument, resolved.text]);
  return binding !== false && ts.isParameter(binding.declaration)
    ? parameterMemberCallValues([binding, member, model, visited])
    : false;
}

type CallExpressionRequest = {
  readonly expression: ts.Expression;
  readonly request: CallCommandRequest;
};
type OptionalCallExpressionRequest = {
  readonly expression: ts.Expression | false;
  readonly request: CallCommandRequest;
};

function bunCommandExpression(request: CallExpressionRequest): ts.Expression {
  const resolutionRequest: ArrayResolutionRequest = {
    expression: request.expression,
    location: request.request.call,
    model: request.request.model,
    visited: new Set(),
  };
  const expression = resolveStaticExpression(resolutionRequest);
  if (!ts.isObjectLiteralExpression(expression)) return expression;
  const properties = expression.properties.filter(
    (candidate) =>
      ts.isPropertyAssignment(candidate) &&
      ((ts.isIdentifier(candidate.name) && candidate.name.text === 'cmd') ||
        (ts.isStringLiteral(candidate.name) && candidate.name.text === 'cmd')),
  );
  const property = properties[0];
  if (
    properties.length !== 1 ||
    !property ||
    !ts.isPropertyAssignment(property)
  )
    throw new Error('Bun subprocess object requires one exact cmd property.');
  return property.initializer;
}

function commandFromExpression(
  request: CallExpressionRequest,
): StaticCommand | false {
  let words: readonly StaticText[];
  const resolutionRequest: ArrayResolutionRequest = {
    expression: request.expression,
    location: request.request.call,
    model: request.request.model,
    visited: new Set(),
  };
  const resolved = resolveArrayExpression(resolutionRequest);
  if (resolved !== false) {
    const arrayRequest: ArrayEvaluationRequest = {
      expression: resolved,
      location: request.request.call,
      model: request.request.model,
    };
    words = evaluateArray(arrayRequest);
  } else words = [evaluate(request)];
  if (!words[0])
    throw new Error(
      `Dynamic TypeScript subprocess executable is forbidden: ${request.request.call.getText()}`,
    );
  if (words[0].dynamic) {
    throw new Error(
      `Dynamic TypeScript subprocess executable is forbidden: ${request.request.call.getText()}`,
    );
  }
  return { shellSource: false, words };
}

function shellCommand(request: CallExpressionRequest): StaticCommand {
  const source = evaluate(request);
  if (source.dynamic)
    throw new Error('Dynamic TypeScript subprocess shell source is forbidden.');
  return { shellSource: true, words: [source] };
}

function callArguments(
  request: OptionalCallExpressionRequest,
): readonly StaticText[] {
  if (!request.expression) return [];
  const resolutionRequest: ArrayResolutionRequest = {
    expression: request.expression,
    location: request.request.call,
    model: request.request.model,
    visited: new Set(),
  };
  const resolved = resolveArrayExpression(resolutionRequest);
  if (resolved === false)
    return [{ dynamic: true, value: request.expression.getText() }];
  const arrayRequest: ArrayEvaluationRequest = {
    expression: resolved,
    location: request.request.call,
    model: request.request.model,
  };
  return evaluateArray(arrayRequest);
}

function resolveArrayExpression(
  request: ArrayResolutionRequest,
): ts.ArrayLiteralExpression | false {
  const expression = resolveStaticExpression(request);
  if (ts.isArrayLiteralExpression(expression)) return expression;
  return false;
}

function resolveStaticExpression(
  request: ArrayResolutionRequest,
): ts.Expression {
  const expression = unwrapExpression(request.expression);
  if (!ts.isIdentifier(expression)) return expression;
  const lookupRequest: BindingLookupRequest = {
    location: request.location,
    model: request.model,
    name: expression.text,
  };
  const binding = bindingAt(lookupRequest);
  if (
    binding === false ||
    !binding.constant ||
    binding.initializer === false ||
    request.visited.has(binding.initializer)
  )
    return expression;
  const nestedRequest: ArrayResolutionRequest = {
    expression: binding.initializer,
    location: binding.initializer,
    model: request.model,
    visited: new Set(request.visited).add(binding.initializer),
  };
  return resolveStaticExpression(nestedRequest);
}

function evaluate(request: CallExpressionRequest): StaticText {
  const evaluationRequest: ExpressionEvaluationRequest = {
    depth: 0,
    expression: request.expression,
    location: request.request.call,
    model: request.request.model,
    visited: new Set(),
  };
  return evaluateText(evaluationRequest);
}

function evaluateArray(request: ArrayEvaluationRequest): readonly StaticText[] {
  return request.expression.elements.map((element) => {
    if (ts.isSpreadElement(element))
      return { dynamic: true, value: element.getText() };
    const evaluationRequest: ExpressionEvaluationRequest = {
      depth: 0,
      expression: element,
      location: request.location,
      model: request.model,
      visited: new Set(),
    };
    return evaluateText(evaluationRequest);
  });
}

function evaluateText(request: ExpressionEvaluationRequest): StaticText {
  if (request.depth > MAX_DEPTH)
    throw new Error(
      'TypeScript subprocess expression exceeds its depth bound.',
    );
  const expression = unwrapExpression(request.expression);
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  )
    return { dynamic: false, value: expression.text };
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'process' &&
    !hasBinding([request.model, expression, 'process']) &&
    expression.name.text === 'execPath'
  )
    return { dynamic: false, value: 'node' };
  if (ts.isCallExpression(expression)) {
    const [argument] = expression.arguments;
    if (
      ts.isPropertyAccessExpression(expression.expression) &&
      ts.isIdentifier(expression.expression.expression) &&
      expression.expression.expression.text === 'Bun' &&
      !hasBinding([request.model, expression, 'Bun']) &&
      expression.expression.name.text === 'which' &&
      expression.arguments.length === 1 &&
      argument &&
      ts.isStringLiteral(argument)
    )
      return { dynamic: false, value: argument.text };
    const pathValue = evaluatePathCall([request, expression]);
    if (pathValue !== false) return pathValue;
  }
  if (ts.isIdentifier(expression)) {
    const lookupRequest: BindingLookupRequest = {
      location: request.location,
      model: request.model,
      name: expression.text,
    };
    const binding = bindingAt(lookupRequest);
    if (
      binding === false ||
      !binding.constant ||
      binding.initializer === false ||
      request.visited.has(binding.initializer)
    )
      return { dynamic: true, value: expression.text };
    const nestedRequest: ExpressionEvaluationRequest = {
      ...request,
      depth: request.depth + 1,
      expression: binding.initializer,
      location: binding.initializer,
      visited: new Set(request.visited).add(binding.initializer),
    };
    return evaluateText(nestedRequest);
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const leftRequest: ExpressionEvaluationRequest = {
      ...request,
      depth: request.depth + 1,
      expression: expression.left,
      location: expression,
    };
    const rightRequest: ExpressionEvaluationRequest = {
      ...request,
      depth: request.depth + 1,
      expression: expression.right,
      location: expression,
    };
    const left = evaluateText(leftRequest);
    const right = evaluateText(rightRequest);
    return {
      dynamic: left.dynamic || right.dynamic,
      value: left.value + right.value,
    };
  }
  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    let dynamic = false;
    for (const span of expression.templateSpans) {
      const partRequest: ExpressionEvaluationRequest = {
        ...request,
        depth: request.depth + 1,
        expression: span.expression,
        location: expression,
      };
      const part = evaluateText(partRequest);
      value += part.value + span.literal.text;
      dynamic ||= part.dynamic;
    }
    return { dynamic, value };
  }
  return { dynamic: true, value: expression.getText() };
}

function evaluatePathCall([request, call]: readonly [
  ExpressionEvaluationRequest,
  ts.CallExpression,
]): StaticText | false {
  const imported = importedMember([call.expression, call, request.model]);
  if (imported === false) return false;
  const [module, name] = imported;
  if (
    module === 'node:url' &&
    name === 'fileURLToPath' &&
    call.arguments.length === 1
  )
    return { dynamic: false, value: '/repository/source.ts' };
  if (module !== 'node:path' || !['dirname', 'join', 'resolve'].includes(name))
    return false;
  const values = call.arguments.map((argument) => {
    const nestedRequest: ExpressionEvaluationRequest = {
      ...request,
      depth: request.depth + 1,
      expression: argument,
      location: call,
    };
    return evaluateText(nestedRequest);
  });
  if (values.some((value) => value.dynamic)) return false;
  const text = values.map((value) => value.value);
  if (name === 'dirname')
    return { dynamic: false, value: posix.dirname(text[0] ?? '') };
  return {
    dynamic: false,
    value: name === 'join' ? posix.join(...text) : posix.resolve(...text),
  };
}

function importedMember([expression, location, model]: readonly [
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

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression)
  )
    return unwrapExpression(expression.expression);
  return expression;
}
