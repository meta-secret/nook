import ts from 'typescript';

import { posix } from 'node:path';

import { SkillProviderCommandBoundaryScenario } from './skill-provider-command-boundary.ts';

import type { ShellLaunchArgument } from './skill-provider-command-types.ts';

import type { ConfigurationNode } from './skill-provider-command-types.ts';

import type { ConfigurationReference } from './skill-provider-config-types.ts';

import { SkillProviderTypescriptSubprocessScenario } from './skill-provider-typescript-subprocess.ts';

import { SkillProviderWorkflowCommandsScenario } from './skill-provider-workflow-commands.ts';

import { SkillProviderGithubScriptExecScenario } from './skill-provider-github-script-exec.ts';

import { SkillProviderGithubScriptRequireScenario } from './skill-provider-github-script-require.ts';

export class SkillProviderGithubScriptScenario {
  private constructor(private readonly request: string) {}

  static githubScriptConfigurationReferences(
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
    return SkillProviderWorkflowCommandsScenario.workflowGithubScriptSources(
      sourceRequest,
    ).flatMap((source) => {
      const normalized =
        SkillProviderGithubScriptScenario.normalizeGithubScriptSource(source);
      SkillProviderGithubScriptScenario.assertStaticGithubScriptLoaders(
        normalized,
      );
      const moduleRequest: GithubScriptModuleRequest = {
        importer: request.importer,
        source: normalized,
        workingDirectory: request.workingDirectory,
      };
      const modules =
        SkillProviderGithubScriptScenario.githubScriptModuleReferences(
          moduleRequest,
        );
      const subprocessInspection = {
        path: `${request.importer}.github-script.ts`,
        source: normalized,
      };
      const subprocesses = [
        ...SkillProviderTypescriptSubprocessScenario.typescriptSubprocessCommands(
          subprocessInspection,
        ),
        ...SkillProviderGithubScriptExecScenario.githubScriptExecCommands(
          normalized,
        ),
      ];
      const launches = subprocesses.flatMap((command) => {
        const shellInspection = {
          positionalArguments: request.positionalArguments,
          source: command,
          sourcePath: request.importer,
        };
        return SkillProviderCommandBoundaryScenario.analyzeShellCommands(
          shellInspection,
        ).launches;
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
          workingDirectory: posix
            .normalize(
              posix.join(request.workingDirectory, launch.workingDirectory),
            )
            .replace(/^\.$/u, ''),
        })),
      ];
    });
  }

  static normalizeGithubScriptSource(source: string): string {
    return new SkillProviderGithubScriptScenario(source).execute();
  }

  private execute(): string {
    const source = this.request;
    return source
      .replaceAll('${process.env.GITHUB_WORKSPACE}/', './')
      .replaceAll('/meta-secret/nook/', './');
  }

  static githubScriptModuleReferences(
    request: GithubScriptModuleRequest,
  ): readonly ConfigurationReference[] {
    const specifiers = new Set([
      ...GITHUB_SCRIPT_TRANSPILER.scanImports(request.source).map(
        (entry) => entry.path,
      ),
      ...SkillProviderGithubScriptRequireScenario.githubScriptRequireSpecifiers(
        request.source,
      ),
    ]);
    return [...specifiers].map((specifier) => ({
      importerRelative: false,
      positionalArguments: false,
      required: specifier.startsWith('.'),
      requiresExecuteMode: false,
      shellRuntime: false,
      specifier,
      taskInclude: false,
      workingDirectory: request.workingDirectory,
    }));
  }

  static assertStaticGithubScriptLoaders(source: string): void {
    const sourceFile = ts.createSourceFile(
      'github-script.ts',
      source,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        SkillProviderGithubScriptScenario.isModuleLoaderCall(node.expression)
      ) {
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

  static isModuleLoaderCall(expression: ts.Expression): boolean {
    if (expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    return (
      ts.isPropertyAccessExpression(expression) &&
      expression.name.text === 'require'
    );
  }
}

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
