import ts from 'typescript';

import { posix } from 'node:path';

import { SkillProviderTypescriptRequireScenario } from './skill-provider-typescript-require.ts';

import {
  type SerializedSubprocessCommand as StaticCommand,
  SkillProviderTypescriptCapabilityScenario,
} from './skill-provider-typescript-capability.ts';

import {
  type BindingLookupRequest,
  type LexicalBinding,
  type LexicalModel,
  SkillProviderTypescriptBindingsScenario,
} from './skill-provider-typescript-bindings.ts';
import { MAX_DEPTH } from './skill-provider-typescript-subprocess.ts';
import type {
  CallCommandRequest,
  ArrayResolutionRequest,
  CallExpressionRequest,
  OptionalCallExpressionRequest,
  StaticText,
  ExpressionEvaluationRequest,
  ArrayEvaluationRequest,
} from './skill-provider-typescript-subprocess.ts';
export class TypeScriptCommandExpression {
  private constructor(private readonly request: CallExpressionRequest) {}
  static commandFromRunCommand(request: CallCommandRequest): StaticCommand {
    const first = request.call.arguments?.[0];
    if (!first) throw new Error('runCommand requires one exact request.');
    const resolutionRequest: ArrayResolutionRequest = {
      expression: first,
      location: request.call,
      model: request.model,
      visited: new Set(),
    };
    const resolved =
      TypeScriptCommandExpression.resolveStaticExpression(resolutionRequest);
    if (!ts.isObjectLiteralExpression(resolved))
      throw new Error('Dynamic runCommand request is forbidden.');
    const command =
      SkillProviderTypescriptCapabilityScenario.exactObjectProperty([
        resolved,
        'command',
      ]);
    if (command === false) throw new Error('runCommand command is not exact.');
    const commandRequest: CallExpressionRequest = {
      expression: command,
      request,
    };
    const executable = TypeScriptCommandExpression.evaluate(commandRequest);
    if (executable.dynamic)
      throw new Error('Dynamic runCommand executable is forbidden.');
    const argumentRequest: OptionalCallExpressionRequest = {
      expression: SkillProviderTypescriptCapabilityScenario.exactObjectProperty(
        [resolved, 'args'],
      ),
      request,
    };
    const result: StaticCommand = {
      cwd: false,
      shellSource: false,
      words: [
        executable,
        ...TypeScriptCommandExpression.callArguments(argumentRequest),
      ],
    };
    SkillProviderTypescriptCapabilityScenario.isSuccessorFreeExternalCommand(
      result,
    );
    return result;
  }

  static isExactRunCommandDispatch(request: CallCommandRequest): boolean {
    const [command, args] = request.call.arguments
      ? request.call.arguments
      : [];
    if (!command || !args || !ts.isIdentifier(command)) return false;
    const binding = SkillProviderTypescriptBindingsScenario.lookupBinding([
      request.model,
      command,
      command.text,
    ]);
    const initializer = binding === false ? false : binding.initializer;
    if (
      binding === false ||
      binding.member !== 'command' ||
      !initializer ||
      !ts.isIdentifier(initializer)
    )
      return false;
    const input = SkillProviderTypescriptBindingsScenario.lookupBinding([
      request.model,
      initializer,
      initializer.text,
    ]);
    const [spread] = ts.isArrayLiteralExpression(args) ? args.elements : [];
    if (
      input === false ||
      !ts.isParameter(input.declaration) ||
      !ts.isMethodDeclaration(input.declaration.parent) ||
      !SkillProviderTypescriptRequireScenario.isRunCommandDeclaration(
        input.declaration.parent,
      ) ||
      !ts.isArrayLiteralExpression(args) ||
      args.elements.length !== 1 ||
      !spread ||
      !ts.isSpreadElement(spread) ||
      !ts.isIdentifier(spread.expression)
    )
      return false;
    const argsBinding = SkillProviderTypescriptBindingsScenario.lookupBinding([
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

  static finiteParameterMemberValues([expression, request]: readonly [
    ts.Expression,
    CallCommandRequest,
  ]): readonly StaticText[] | false {
    let parameter: LexicalBinding | false = false;
    let member = '';
    if (
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression)
    ) {
      parameter = SkillProviderTypescriptBindingsScenario.lookupBinding([
        request.model,
        expression,
        expression.expression.text,
      ]);
      member = expression.name.text;
    } else if (ts.isIdentifier(expression)) {
      const binding = SkillProviderTypescriptBindingsScenario.lookupBinding([
        request.model,
        expression,
        expression.text,
      ]);
      const initializer = binding === false ? false : binding.initializer;
      if (
        binding !== false &&
        binding.member &&
        initializer &&
        ts.isIdentifier(initializer)
      ) {
        parameter = SkillProviderTypescriptBindingsScenario.lookupBinding([
          request.model,
          initializer,
          initializer.text,
        ]);
        member = binding.member;
      }
    }
    if (parameter === false || !ts.isParameter(parameter.declaration))
      return false;
    return TypeScriptCommandExpression.parameterMemberCallValues([
      parameter,
      member,
      request.model,
      new Set(),
    ]);
  }

  static parameterMemberCallValues([
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
        SkillProviderTypescriptBindingsScenario.lookupBinding([
          model,
          node,
          node.expression.text,
        ]) === ownerBinding
      ) {
        const argument = node.arguments[parameterIndex];
        const value = argument
          ? TypeScriptCommandExpression.parameterArgumentMember([
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

  static parameterArgumentMember([argument, member, model, visited]: readonly [
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
    const resolved =
      TypeScriptCommandExpression.resolveStaticExpression(resolutionRequest);
    if (ts.isObjectLiteralExpression(resolved)) {
      const property =
        SkillProviderTypescriptCapabilityScenario.exactObjectProperty([
          resolved,
          member,
        ]);
      if (property === false) return false;
      const evaluationRequest: ExpressionEvaluationRequest = {
        depth: 0,
        expression: property,
        location: argument,
        model,
        visited: new Set(),
      };
      return [TypeScriptCommandExpression.evaluateText(evaluationRequest)];
    }
    if (!ts.isIdentifier(resolved)) return false;
    const binding = SkillProviderTypescriptBindingsScenario.lookupBinding([
      model,
      argument,
      resolved.text,
    ]);
    return binding !== false && ts.isParameter(binding.declaration)
      ? TypeScriptCommandExpression.parameterMemberCallValues([
          binding,
          member,
          model,
          visited,
        ])
      : false;
  }

  static bunCommandExpression(request: CallExpressionRequest): ts.Expression {
    const resolutionRequest: ArrayResolutionRequest = {
      expression: request.expression,
      location: request.request.call,
      model: request.request.model,
      visited: new Set(),
    };
    const expression =
      TypeScriptCommandExpression.resolveStaticExpression(resolutionRequest);
    if (!ts.isObjectLiteralExpression(expression)) return expression;
    const properties = expression.properties.filter(
      (candidate) =>
        ts.isPropertyAssignment(candidate) &&
        ((ts.isIdentifier(candidate.name) && candidate.name.text === 'cmd') ||
          (ts.isStringLiteral(candidate.name) &&
            candidate.name.text === 'cmd')),
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

  static commandFromExpression(
    request: CallExpressionRequest,
  ): StaticCommand | false {
    let words: readonly StaticText[];
    const resolutionRequest: ArrayResolutionRequest = {
      expression: request.expression,
      location: request.request.call,
      model: request.request.model,
      visited: new Set(),
    };
    const resolved =
      TypeScriptCommandExpression.resolveArrayExpression(resolutionRequest);
    if (resolved !== false) {
      const arrayRequest: ArrayEvaluationRequest = {
        expression: resolved,
        location: request.request.call,
        model: request.request.model,
      };
      words = TypeScriptCommandExpression.evaluateArray(arrayRequest);
    } else words = [TypeScriptCommandExpression.evaluate(request)];
    if (!words[0])
      throw new Error(
        `Dynamic TypeScript subprocess executable is forbidden: ${request.request.call.getText()}`,
      );
    if (words[0].dynamic) {
      throw new Error(
        `Dynamic TypeScript subprocess executable is forbidden: ${request.request.call.getText()}`,
      );
    }
    return { cwd: false, shellSource: false, words };
  }

  static shellCommand(request: CallExpressionRequest): StaticCommand {
    const source = TypeScriptCommandExpression.evaluate(request);
    if (source.dynamic)
      throw new Error(
        'Dynamic TypeScript subprocess shell source is forbidden.',
      );
    return { cwd: false, shellSource: true, words: [source] };
  }

  static callArguments(
    request: OptionalCallExpressionRequest,
  ): readonly StaticText[] {
    if (!request.expression) return [];
    const resolutionRequest: ArrayResolutionRequest = {
      expression: request.expression,
      location: request.request.call,
      model: request.request.model,
      visited: new Set(),
    };
    const resolved =
      TypeScriptCommandExpression.resolveArrayExpression(resolutionRequest);
    if (resolved === false)
      return [{ dynamic: true, value: request.expression.getText() }];
    const arrayRequest: ArrayEvaluationRequest = {
      expression: resolved,
      location: request.request.call,
      model: request.request.model,
    };
    return TypeScriptCommandExpression.evaluateArray(arrayRequest);
  }

  static resolveArrayExpression(
    request: ArrayResolutionRequest,
  ): ts.ArrayLiteralExpression | false {
    const expression =
      TypeScriptCommandExpression.resolveStaticExpression(request);
    if (ts.isArrayLiteralExpression(expression)) return expression;
    return false;
  }

  static resolveStaticExpression(
    request: ArrayResolutionRequest,
  ): ts.Expression {
    const expression =
      SkillProviderTypescriptCapabilityScenario.unwrapTypescriptExpression(
        request.expression,
      );
    if (!ts.isIdentifier(expression)) return expression;
    const lookupRequest: BindingLookupRequest = {
      location: request.location,
      model: request.model,
      name: expression.text,
    };
    const binding =
      SkillProviderTypescriptBindingsScenario.bindingAt(lookupRequest);
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
    return TypeScriptCommandExpression.resolveStaticExpression(nestedRequest);
  }

  static evaluate(request: CallExpressionRequest): StaticText {
    return new TypeScriptCommandExpression(request).execute();
  }
  private execute(): StaticText {
    const request = this.request;
    const evaluationRequest: ExpressionEvaluationRequest = {
      depth: 0,
      expression: request.expression,
      location: request.request.call,
      model: request.request.model,
      visited: new Set(),
    };
    return TypeScriptCommandExpression.evaluateText(evaluationRequest);
  }

  static evaluateArray(request: ArrayEvaluationRequest): readonly StaticText[] {
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
      return TypeScriptCommandExpression.evaluateText(evaluationRequest);
    });
  }

  static evaluateText(request: ExpressionEvaluationRequest): StaticText {
    if (request.depth > MAX_DEPTH)
      throw new Error(
        'TypeScript subprocess expression exceeds its depth bound.',
      );
    const expression =
      SkillProviderTypescriptCapabilityScenario.unwrapTypescriptExpression(
        request.expression,
      );
    if (
      ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
    )
      return { dynamic: false, value: expression.text };
    if (
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'process' &&
      !SkillProviderTypescriptBindingsScenario.hasBinding([
        request.model,
        expression,
        'process',
      ]) &&
      expression.name.text === 'execPath'
    )
      return { dynamic: false, value: 'node' };
    if (ts.isCallExpression(expression)) {
      const [argument] = expression.arguments;
      if (
        ts.isPropertyAccessExpression(expression.expression) &&
        ts.isIdentifier(expression.expression.expression) &&
        expression.expression.expression.text === 'Bun' &&
        !SkillProviderTypescriptBindingsScenario.hasBinding([
          request.model,
          expression,
          'Bun',
        ]) &&
        expression.expression.name.text === 'which' &&
        expression.arguments.length === 1 &&
        argument &&
        ts.isStringLiteral(argument)
      )
        return { dynamic: false, value: argument.text };
      const pathValue = TypeScriptCommandExpression.evaluatePathCall([
        request,
        expression,
      ]);
      if (pathValue !== false) return pathValue;
    }
    if (ts.isIdentifier(expression)) {
      const lookupRequest: BindingLookupRequest = {
        location: request.location,
        model: request.model,
        name: expression.text,
      };
      const binding =
        SkillProviderTypescriptBindingsScenario.bindingAt(lookupRequest);
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
      return TypeScriptCommandExpression.evaluateText(nestedRequest);
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
      const left = TypeScriptCommandExpression.evaluateText(leftRequest);
      const right = TypeScriptCommandExpression.evaluateText(rightRequest);
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
        const part = TypeScriptCommandExpression.evaluateText(partRequest);
        value += part.value + span.literal.text;
        dynamic ||= part.dynamic;
      }
      return { dynamic, value };
    }
    return { dynamic: true, value: expression.getText() };
  }

  static evaluatePathCall([request, call]: readonly [
    ExpressionEvaluationRequest,
    ts.CallExpression,
  ]): StaticText | false {
    const imported = SkillProviderTypescriptBindingsScenario.importedMember([
      call.expression,
      call,
      request.model,
    ]);
    if (imported === false) return false;
    const [module, name] = imported;
    if (
      module === 'node:url' &&
      name === 'fileURLToPath' &&
      call.arguments.length === 1
    )
      return { dynamic: false, value: '/repository/source.ts' };
    if (
      module !== 'node:path' ||
      !['dirname', 'join', 'resolve'].includes(name)
    )
      return false;
    const values = call.arguments.map((argument) => {
      const nestedRequest: ExpressionEvaluationRequest = {
        ...request,
        depth: request.depth + 1,
        expression: argument,
        location: call,
      };
      return TypeScriptCommandExpression.evaluateText(nestedRequest);
    });
    if (values.some((value) => value.dynamic)) return false;
    const text = values.map((value) => value.value);
    const [first = ''] = text;
    if (name === 'dirname')
      return { dynamic: false, value: posix.dirname(first) };
    return {
      dynamic: false,
      value: name === 'join' ? posix.join(...text) : posix.resolve(...text),
    };
  }
}
