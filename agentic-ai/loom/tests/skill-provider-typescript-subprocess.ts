import { TypeScriptCommandExpression } from './skill-provider-typescript-command-expression.ts';
import ts from 'typescript';

import { SkillProviderTypescriptRequireScenario } from './skill-provider-typescript-require.ts';

import {
  type SerializedSubprocessCommand as StaticCommand,
  SubprocessCallKind,
  type BunShellTemplateRequest,
  type SubprocessCwdRequest,
  type UnsupportedCallArgumentRequest,
  SkillProviderTypescriptCapabilityScenario,
} from './skill-provider-typescript-capability.ts';

import {
  type BindingCollectionRequest,
  type BindingLookupRequest,
  type LexicalBinding,
  type LexicalModel,
  SkillProviderTypescriptBindingsScenario,
} from './skill-provider-typescript-bindings.ts';

export class SkillProviderTypescriptSubprocessScenario {
  private constructor(
    private readonly request: TypeScriptSubprocessInspection,
  ) {}

  static typescriptSubprocessCommands(
    inspection: TypeScriptSubprocessInspection,
  ): readonly string[] {
    return new SkillProviderTypescriptSubprocessScenario(inspection).execute();
  }

  private execute(): readonly string[] {
    const inspection = this.request;
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
      SkillProviderTypescriptBindingsScenario.collectBinding(collectionRequest);
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);
    const exemptionRequest = { path: inspection.path, sourceFile };
    const model: LexicalModel = {
      bindings,
      dynamicCwdExemptions:
        SkillProviderTypescriptBindingsScenario.dynamicCwdExemptions(
          exemptionRequest,
        ),
      dynamicEnvironmentExemptions:
        SkillProviderTypescriptBindingsScenario.dynamicEnvironmentExemptions(
          exemptionRequest,
        ),
      path: inspection.path,
    };
    const commands: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const capabilityRequest: CapabilityResolutionRequest = {
          expression: node.expression,
          location: node,
          model,
          visited: new Set(),
        };
        const adapterTarget =
          SkillProviderTypescriptBindingsScenario.nodePromisifyTarget([
            node,
            model,
          ]);
        const kind =
          adapterTarget === false
            ? SkillProviderTypescriptSubprocessScenario.resolveCapability(
                capabilityRequest,
              )
            : false;
        if (kind === false && adapterTarget === false)
          SkillProviderTypescriptSubprocessScenario.assertUnsupportedArguments([
            node,
            model,
          ]);
        if (kind !== false) {
          if (
            SkillProviderTypescriptCapabilityScenario.isReflectInvocation(kind)
          ) {
            const target = node.arguments[0];
            if (target) {
              const targetRequest: CapabilityResolutionRequest = {
                expression: target,
                location: node,
                model,
                visited: new Set(),
              };
              SkillProviderTypescriptCapabilityScenario.assertReflectInvocationTarget(
                [
                  kind,
                  SkillProviderTypescriptSubprocessScenario.resolveCapability(
                    targetRequest,
                  ),
                ],
              );
            }
          } else {
            const callRequest: CallCommandRequest = { call: node, kind, model };
            const command =
              SkillProviderTypescriptSubprocessScenario.commandFromCall(
                callRequest,
              );
            if (command !== false)
              commands.push(
                SkillProviderTypescriptCapabilityScenario.serializeSubprocessCommand(
                  command,
                ),
              );
          }
        }
      }
      if (ts.isNewExpression(node)) {
        const capabilityRequest: CapabilityResolutionRequest = {
          expression: node.expression,
          location: node,
          model,
          visited: new Set(),
        };
        const kind =
          SkillProviderTypescriptSubprocessScenario.resolveCapability(
            capabilityRequest,
          );
        if (kind === false)
          SkillProviderTypescriptSubprocessScenario.assertUnsupportedArguments([
            node,
            model,
          ]);
        if (kind === SubprocessCallKind.Worker) {
          const callRequest: CallCommandRequest = { call: node, kind, model };
          const command =
            SkillProviderTypescriptSubprocessScenario.commandFromCall(
              callRequest,
            );
          if (command !== false)
            commands.push(
              SkillProviderTypescriptCapabilityScenario.serializeSubprocessCommand(
                command,
              ),
            );
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
          capability:
            SkillProviderTypescriptSubprocessScenario.resolveCapability(
              capabilityRequest,
            ),
          evaluate: (expression) => {
            const evaluationRequest: ExpressionEvaluationRequest = {
              depth: 0,
              expression,
              location: node,
              model,
              visited: new Set(),
            };
            return TypeScriptCommandExpression.evaluateText(evaluationRequest);
          },
          tagged: node,
        };
        const command =
          SkillProviderTypescriptCapabilityScenario.bunShellTemplateCommand(
            templateRequest,
          );
        if (command !== false) commands.push(command);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return commands;
  }

  static assertUnsupportedArguments([call, model]: readonly [
    ts.CallExpression | ts.NewExpression,
    LexicalModel,
  ]): void {
    const requestFor = (
      expression: ts.Expression,
    ): CapabilityResolutionRequest => ({
      expression,
      location: expression,
      model,
      visited: new Set(),
    });
    for (const argument of call.arguments ? call.arguments : []) {
      const callArgumentRequest: UnsupportedCallArgumentRequest = {
        call: call.getText(),
        capability: (expression) =>
          SkillProviderTypescriptSubprocessScenario.resolveCapability(
            requestFor(expression),
          ),
        expression: argument,
        resolve: (expression) =>
          TypeScriptCommandExpression.resolveStaticExpression(
            requestFor(expression),
          ),
        sourcePath: model.path,
      };
      SkillProviderTypescriptCapabilityScenario.assertUnsupportedCallArgument(
        callArgumentRequest,
      );
    }
  }

  static resolveCapability(
    request: CapabilityResolutionRequest,
  ): SubprocessCallKind | false {
    if (request.visited.has(request.expression)) return false;
    const visited = new Set(request.visited).add(request.expression);
    const expression =
      SkillProviderTypescriptCapabilityScenario.unwrapTypescriptExpression(
        request.expression,
      );
    if (ts.isCallExpression(expression)) {
      const target =
        SkillProviderTypescriptBindingsScenario.nodePromisifyTarget([
          expression,
          request.model,
        ]);
      if (target !== false) {
        const targetRequest: CapabilityResolutionRequest = {
          expression: target,
          location: expression,
          model: request.model,
          visited,
        };
        return SkillProviderTypescriptSubprocessScenario.resolveCapability(
          targetRequest,
        );
      }
    }
    const importedCapability =
      SkillProviderTypescriptCapabilityScenario.dynamicImportCapability(
        expression,
      );
    if (importedCapability !== false) return importedCapability;
    if (ts.isIdentifier(expression)) {
      const lookupRequest: BindingLookupRequest = {
        location: request.location,
        model: request.model,
        name: expression.text,
      };
      const binding =
        SkillProviderTypescriptBindingsScenario.bindingAt(lookupRequest);
      if (binding === false)
        return expression.text === 'Worker'
          ? SubprocessCallKind.Worker
          : expression.text === 'Reflect'
            ? SubprocessCallKind.ReflectNamespace
            : false;
      if (binding.capability !== false) return binding.capability;
      if (!binding.constant || binding.initializer === false) return false;
      if (binding.member !== false) {
        const objectRequest: ArrayResolutionRequest = {
          expression: binding.initializer,
          location: binding.initializer,
          model: request.model,
          visited,
        };
        const object =
          SkillProviderTypescriptSubprocessScenario.resolveObjectLiteral(
            objectRequest,
          );
        if (object !== false) {
          const property =
            SkillProviderTypescriptCapabilityScenario.exactObjectProperty([
              object,
              binding.member,
            ]);
          if (property === false) return false;
          const propertyRequest: CapabilityResolutionRequest = {
            expression: property,
            location: property,
            model: request.model,
            visited,
          };
          return SkillProviderTypescriptSubprocessScenario.resolveCapability(
            propertyRequest,
          );
        }
        const ownerRequest: CapabilityResolutionRequest = {
          expression: binding.initializer,
          location: binding.initializer,
          model: request.model,
          visited,
        };
        const ownerCapability =
          SkillProviderTypescriptSubprocessScenario.resolveCapability(
            ownerRequest,
          );
        return (
          SkillProviderTypescriptCapabilityScenario.childProcessCapability([
            ownerCapability,
            binding.member,
          ]) ||
          SkillProviderTypescriptCapabilityScenario.workerThreadCapability([
            ownerCapability,
            binding.member,
          ]) ||
          SkillProviderTypescriptCapabilityScenario.reflectInvocationCapability(
            [ownerCapability, binding.member],
          ) ||
          SkillProviderTypescriptCapabilityScenario.functionInvocationCapability(
            [ownerCapability, binding.member],
          )
        );
      }
      const nestedRequest: CapabilityResolutionRequest = {
        expression: binding.initializer,
        location: binding.initializer,
        model: request.model,
        visited,
      };
      return SkillProviderTypescriptSubprocessScenario.resolveCapability(
        nestedRequest,
      );
    }
    if (
      SkillProviderTypescriptRequireScenario.isStaticChildProcessRequire(
        expression,
      ) &&
      !SkillProviderTypescriptBindingsScenario.hasBinding([
        request.model,
        request.location,
        'require',
      ])
    )
      return SubprocessCallKind.Namespace;
    if (
      SkillProviderTypescriptCapabilityScenario.isStaticWorkerThreadsRequire(
        expression,
      ) &&
      !SkillProviderTypescriptBindingsScenario.hasBinding([
        request.model,
        request.location,
        'require',
      ])
    )
      return SubprocessCallKind.WorkerNamespace;
    const access =
      SkillProviderTypescriptCapabilityScenario.staticMemberAccess(expression);
    if (access === false) return false;
    const [owner, member] = access;
    if (ts.isIdentifier(owner) && owner.text === 'globalThis') {
      if (
        SkillProviderTypescriptBindingsScenario.hasBinding([
          request.model,
          request.location,
          'globalThis',
        ])
      )
        return false;
      return member === 'Reflect' ? SubprocessCallKind.ReflectNamespace : false;
    }
    if (ts.isIdentifier(owner) && owner.text === 'Bun') {
      if (
        SkillProviderTypescriptBindingsScenario.hasBinding([
          request.model,
          request.location,
          'Bun',
        ])
      )
        return false;
      if (member === '$') return SubprocessCallKind.BunShell;
      return member === 'spawn' || member === 'spawnSync'
        ? SubprocessCallKind.Bun
        : false;
    }
    const resolutionRequest: ArrayResolutionRequest = {
      expression: owner,
      location: request.location,
      model: request.model,
      visited,
    };
    const resolvedOwner =
      SkillProviderTypescriptSubprocessScenario.resolveObjectLiteral(
        resolutionRequest,
      );
    if (resolvedOwner !== false) {
      if (
        resolvedOwner.properties.some((property) =>
          ts.isSpreadAssignment(property),
        )
      )
        throw new Error(
          'Spread TypeScript subprocess capability holders are forbidden.',
        );
      if (member === false) {
        if (
          SkillProviderTypescriptSubprocessScenario.objectContainsCapability([
            resolvedOwner,
            request,
            visited,
          ])
        )
          throw new Error(
            'Dynamic subprocess capability holder selection is forbidden.',
          );
        return false;
      }
      const property =
        SkillProviderTypescriptCapabilityScenario.exactObjectProperty([
          resolvedOwner,
          member,
        ]);
      if (property === false) return false;
      const propertyRequest: CapabilityResolutionRequest = {
        expression: property,
        location: property,
        model: request.model,
        visited,
      };
      return SkillProviderTypescriptSubprocessScenario.resolveCapability(
        propertyRequest,
      );
    }
    const ownerRequest: CapabilityResolutionRequest = {
      expression: owner,
      location: request.location,
      model: request.model,
      visited,
    };
    const ownerCapability =
      SkillProviderTypescriptSubprocessScenario.resolveCapability(ownerRequest);
    return (
      SkillProviderTypescriptCapabilityScenario.childProcessCapability([
        ownerCapability,
        member,
      ]) ||
      SkillProviderTypescriptCapabilityScenario.bunNamespaceCapability([
        ownerCapability,
        member,
      ]) ||
      SkillProviderTypescriptCapabilityScenario.workerThreadCapability([
        ownerCapability,
        member,
      ]) ||
      SkillProviderTypescriptCapabilityScenario.reflectInvocationCapability([
        ownerCapability,
        member,
      ]) ||
      SkillProviderTypescriptCapabilityScenario.functionInvocationCapability([
        ownerCapability,
        member,
      ])
    );
  }

  static resolveObjectLiteral(
    request: ArrayResolutionRequest,
  ): ts.ObjectLiteralExpression | false {
    const resolved =
      TypeScriptCommandExpression.resolveStaticExpression(request);
    if (ts.isObjectLiteralExpression(resolved)) return resolved;
    const access =
      SkillProviderTypescriptCapabilityScenario.staticMemberAccess(resolved);
    if (access === false) return false;
    const [owner, member] = access;
    if (member === false) return false;
    const ownerRequest: ArrayResolutionRequest = {
      ...request,
      expression: owner,
      visited: new Set(request.visited).add(resolved),
    };
    const object =
      SkillProviderTypescriptSubprocessScenario.resolveObjectLiteral(
        ownerRequest,
      );
    if (object === false) return false;
    const property =
      SkillProviderTypescriptCapabilityScenario.exactObjectProperty([
        object,
        member,
      ]);
    if (property === false || request.visited.has(property)) return false;
    const propertyRequest: ArrayResolutionRequest = {
      ...request,
      expression: property,
      location: property,
      visited: new Set(request.visited).add(property),
    };
    return SkillProviderTypescriptSubprocessScenario.resolveObjectLiteral(
      propertyRequest,
    );
  }

  static objectContainsCapability([object, request, visited]: readonly [
    ts.ObjectLiteralExpression,
    CapabilityResolutionRequest,
    ReadonlySet<ts.Node>,
  ]): boolean {
    return object.properties.some((property) => {
      let expression: ts.Expression | false = false;
      if (ts.isPropertyAssignment(property)) expression = property.initializer;
      if (ts.isShorthandPropertyAssignment(property))
        expression = property.name;
      if (expression === false) return false;
      const propertyRequest: CapabilityResolutionRequest = {
        expression,
        location: property,
        model: request.model,
        visited,
      };
      return (
        SkillProviderTypescriptSubprocessScenario.resolveCapability(
          propertyRequest,
        ) !== false
      );
    });
  }

  static commandFromCall(request: CallCommandRequest): StaticCommand | false {
    const first = request.call.arguments?.[0];
    if (!first) throw new Error('Recognized subprocess call has no command.');
    const cwdRequest: SubprocessCwdRequest = {
      allowDynamicCwd:
        SkillProviderTypescriptBindingsScenario.isDynamicCwdExempt([
          request.model,
          request.call,
        ]),
      allowDynamicEnvironment:
        SkillProviderTypescriptBindingsScenario.isDynamicEnvironmentExempt([
          request.model,
          request.call,
        ]),
      call: request.call,
      evaluate: (expression) => {
        const expressionRequest: CallExpressionRequest = {
          expression,
          request,
        };
        return TypeScriptCommandExpression.evaluate(expressionRequest);
      },
      kind: request.kind,
      resolveObject: (expression) => {
        const resolutionRequest: ArrayResolutionRequest = {
          expression,
          location: request.call,
          model: request.model,
          visited: new Set(),
        };
        return SkillProviderTypescriptSubprocessScenario.resolveObjectLiteral(
          resolutionRequest,
        );
      },
      sourcePath: request.model.path,
    };
    SkillProviderTypescriptCapabilityScenario.auditSubprocessEnvironment(
      cwdRequest,
    );
    const cwd = (): StaticText | false =>
      SkillProviderTypescriptCapabilityScenario.subprocessCwd(cwdRequest);
    const argumentList =
      SkillProviderTypescriptCapabilityScenario.subprocessArgumentList(
        cwdRequest,
      );
    if (request.kind === SubprocessCallKind.Worker) {
      const expressionRequest: CallExpressionRequest = {
        expression: first,
        request,
      };
      const entrypoint =
        TypeScriptCommandExpression.evaluate(expressionRequest);
      if (entrypoint.dynamic)
        throw new Error('Dynamic TypeScript worker entrypoint is forbidden.');
      if (/^[A-Za-z][A-Za-z+.-]*:/u.test(entrypoint.value))
        throw new Error('Non-file TypeScript worker entrypoint is forbidden.');
      return {
        cwd: cwd(),
        shellSource: false,
        words: [{ dynamic: false, value: 'node' }, entrypoint],
      };
    }
    if (request.kind === SubprocessCallKind.Bun) {
      const expressionRequest: CallExpressionRequest = {
        expression: first,
        request,
      };
      const commandRequest: CallExpressionRequest = {
        ...expressionRequest,
        expression:
          TypeScriptCommandExpression.bunCommandExpression(expressionRequest),
      };
      const command =
        TypeScriptCommandExpression.commandFromExpression(commandRequest);
      return command === false ||
        SkillProviderTypescriptCapabilityScenario.isSuccessorFreeExternalCommand(
          command,
        )
        ? false
        : { ...command, cwd: cwd() };
    }
    if (request.kind === SubprocessCallKind.Exec) {
      const expressionRequest: CallExpressionRequest = {
        expression: first,
        request,
      };
      return {
        ...TypeScriptCommandExpression.shellCommand(expressionRequest),
        cwd: cwd(),
      };
    }
    if (request.kind === SubprocessCallKind.RunCommand)
      return TypeScriptCommandExpression.commandFromRunCommand(request);
    if (request.kind === SubprocessCallKind.Fork) {
      const expressionRequest: CallExpressionRequest = {
        expression: first,
        request,
      };
      const module = TypeScriptCommandExpression.evaluate(expressionRequest);
      const argumentRequest: OptionalCallExpressionRequest = {
        expression: argumentList,
        request,
      };
      const argumentsValue =
        TypeScriptCommandExpression.callArguments(argumentRequest);
      return {
        cwd: cwd(),
        shellSource: false,
        words: [{ dynamic: false, value: 'node' }, module, ...argumentsValue],
      };
    }
    const expressionRequest: CallExpressionRequest = {
      expression: first,
      request,
    };
    const executable = TypeScriptCommandExpression.evaluate(expressionRequest);
    const argumentRequest: OptionalCallExpressionRequest = {
      expression: argumentList,
      request,
    };
    const argumentsValue =
      TypeScriptCommandExpression.callArguments(argumentRequest);
    if (executable.dynamic) {
      if (TypeScriptCommandExpression.isExactRunCommandDispatch(request))
        return false;
      const values = TypeScriptCommandExpression.finiteParameterMemberValues([
        first,
        request,
      ]);
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
    const command: StaticCommand = {
      cwd: false,
      shellSource: false,
      words: [executable, ...argumentsValue],
    };
    return SkillProviderTypescriptCapabilityScenario.isSuccessorFreeExternalCommand(
      command,
    )
      ? false
      : { ...command, cwd: cwd() };
  }
}

export type TypeScriptSubprocessInspection = {
  readonly path: string;
  readonly source: string;
};

export type StaticText = { readonly dynamic: boolean; readonly value: string };

export type ExpressionEvaluationRequest = {
  readonly depth: number;
  readonly expression: ts.Expression;
  readonly location: ts.Node;
  readonly model: LexicalModel;
  readonly visited: ReadonlySet<ts.Node>;
};

export type CallCommandRequest = {
  readonly call: ts.CallExpression | ts.NewExpression;
  readonly kind: SubprocessCallKind;
  readonly model: LexicalModel;
};

export type ArrayEvaluationRequest = {
  readonly expression: ts.ArrayLiteralExpression;
  readonly location: ts.Node;
  readonly model: LexicalModel;
};

export type ArrayResolutionRequest = {
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

const MAX_BYTES = 65_536;

export const MAX_DEPTH = 16;

const MAX_NODES = 65_536;

const encoder = new TextEncoder();

export type CallExpressionRequest = {
  readonly expression: ts.Expression;
  readonly request: CallCommandRequest;
};

export type OptionalCallExpressionRequest = {
  readonly expression: ts.Expression | false;
  readonly request: CallCommandRequest;
};
