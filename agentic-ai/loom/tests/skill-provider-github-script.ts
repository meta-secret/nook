import ts from 'typescript';
import { analyzeShellCommands } from './skill-provider-command-boundary.ts';
import type { ShellLaunchArgument } from './skill-provider-command-types.ts';
import type { ConfigurationNode } from './skill-provider-command-types.ts';
import type { ConfigurationReference } from './skill-provider-config-types.ts';
import { typescriptSubprocessCommands } from './skill-provider-typescript-subprocess.ts';
import { workflowGithubScriptSources } from './skill-provider-workflow-commands.ts';
import { githubScriptExecCommands } from './skill-provider-github-script-exec.ts';

type GithubScriptReferenceRequest = {
  readonly importer: string;
  readonly positionalArguments: readonly ShellLaunchArgument[] | false;
  readonly source: string;
  readonly workingDirectory: string;
};

type GithubScriptModuleRequest = {
  readonly importer: string;
  readonly source: string;
  readonly workingDirectory: string;
};

type GithubScriptTranspilerOptions = { readonly loader: 'tsx' };
const githubScriptTranspilerOptions: GithubScriptTranspilerOptions = {
  loader: 'tsx',
};
const GITHUB_SCRIPT_TRANSPILER = new Bun.Transpiler(
  githubScriptTranspilerOptions,
);

export function githubScriptConfigurationReferences(
  request: GithubScriptReferenceRequest,
): readonly ConfigurationReference[] {
  if (
    !/^\.github\/(?:workflows\/[^/]+|actions\/(?:[^/]+\/)*action)\.ya?ml$/u.test(
      request.importer,
    )
  )
    return [];
  const document = Bun.YAML.parse(request.source) as ConfigurationNode;
  const sourceRequest = {
    action: /(^|\/)action\.ya?ml$/u.test(request.importer),
    document,
  };
  return workflowGithubScriptSources(sourceRequest).flatMap((source) => {
    const normalized = normalizeGithubScriptSource(source);
    assertStaticGithubScriptLoaders(normalized);
    const moduleRequest: GithubScriptModuleRequest = {
      importer: request.importer,
      source: normalized,
      workingDirectory: request.workingDirectory,
    };
    const modules = githubScriptModuleReferences(moduleRequest);
    const subprocessInspection = {
      path: `${request.importer}.github-script.ts`,
      source: normalized,
    };
    const subprocesses = [
      ...typescriptSubprocessCommands(subprocessInspection),
      ...githubScriptExecCommands(normalized),
    ];
    const launches = subprocesses.flatMap((command) => {
      const shellInspection = {
        positionalArguments: request.positionalArguments,
        source: command,
        sourcePath: request.importer,
      };
      return analyzeShellCommands(shellInspection).launches;
    });
    return [
      ...modules,
      ...launches.map((launch) => ({
        importerRelative: false,
        positionalArguments: launch.positionalArguments,
        required: true,
        requiresExecuteMode: launch.requiresExecuteMode,
        shellRuntime: launch.shellRuntime,
        specifier: launch.specifier,
        taskInclude: false,
        workingDirectory: launch.workingDirectory,
      })),
    ];
  });
}

function normalizeGithubScriptSource(source: string): string {
  return source
    .replaceAll('${process.env.GITHUB_WORKSPACE}/', './')
    .replaceAll('/meta-secret/nook/', './');
}

function githubScriptModuleReferences(
  request: GithubScriptModuleRequest,
): readonly ConfigurationReference[] {
  return GITHUB_SCRIPT_TRANSPILER.scanImports(request.source).map((entry) => ({
    importerRelative: false,
    positionalArguments: false,
    required: entry.path.startsWith('.'),
    requiresExecuteMode: false,
    shellRuntime: false,
    specifier: entry.path,
    taskInclude: false,
    workingDirectory: request.workingDirectory,
  }));
}

function assertStaticGithubScriptLoaders(source: string): void {
  const sourceFile = ts.createSourceFile(
    'github-script.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isModuleLoaderCall(node.expression)) {
      const argument = node.arguments[0];
      if (
        !argument ||
        (!ts.isStringLiteral(argument) &&
          !ts.isNoSubstitutionTemplateLiteral(argument))
      )
        throw new Error('Dynamic github-script module load is forbidden.');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function isModuleLoaderCall(expression: ts.Expression): boolean {
  if (expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(expression)) return expression.text === 'require';
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'require'
  );
}
