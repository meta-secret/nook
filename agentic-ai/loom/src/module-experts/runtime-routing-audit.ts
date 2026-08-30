import * as ts from 'typescript';

export const MODULE_EXPERT_CLI = 'agentic-ai/loom/src/module-experts/cli.ts';
export const MODULE_EXPERT_TRUSTED_RUNTIME =
  'agentic-ai/loom/src/module-experts/trusted-runtime.ts';

export type AuditModuleExpertRuntimeRoutingArgs = {
  readonly moduleExpertCliSource: string;
  readonly trustedRuntimeSource: string;
};

export type ModuleExpertRuntimeRoutingFinding = {
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export function auditModuleExpertRuntimeRouting(
  args: AuditModuleExpertRuntimeRoutingArgs,
): readonly ModuleExpertRuntimeRoutingFinding[] {
  const findings: ModuleExpertRuntimeRoutingFinding[] = [];
  const moduleExpertRuntimeNames = constructedRuntimeNames(
    args.moduleExpertCliSource,
  );
  const moduleExpertCallNames = calledFunctionNames(args.moduleExpertCliSource);
  const trustedRuntimeCallNames = calledFunctionNames(
    args.trustedRuntimeSource,
  );
  const trustedRuntimeNames = constructedRuntimeNames(
    args.trustedRuntimeSource,
  );
  if (
    !moduleExpertCallNames.includes('invokeModuleExpert') ||
    moduleExpertRuntimeNames.includes('ModuleExpertCodexSdkAgentRuntime') ||
    moduleExpertRuntimeNames.includes('CodexSdkAgentRuntime') ||
    !trustedRuntimeCallNames.includes('executeIsolatedModuleExpertAgent') ||
    !trustedRuntimeCallNames.includes('consumeIsolatedModuleExpertExecution') ||
    trustedRuntimeNames.includes('ModuleExpertCodexSdkAgentRuntime') ||
    trustedRuntimeNames.includes('CodexSdkAgentRuntime')
  ) {
    findings[findings.length] = {
      code: 'unsafe-module-expert-runtime-routing',
      path: MODULE_EXPERT_TRUSTED_RUNTIME,
      message:
        'Module expert invocation must use only the isolated module-expert Codex runtime.',
    };
  }
  return findings;
}

function constructedRuntimeNames(source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    'runtime-routing.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      names[names.length] = node.expression.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

function calledFunctionNames(source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    'runtime-routing.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      names[names.length] = node.expression.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}
