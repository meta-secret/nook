import { join } from 'node:path';

import {
  type ConfigurationScriptGraph,
  type ExecutableProviderReferenceInspection,
  SkillProviderExecutableScriptScenario,
} from './skill-provider-executable-script.ts';

import { SkillProviderConfigApplicationScenario } from './skill-provider-config-application.ts';

import { SkillProviderConfigCommandsScenario } from './skill-provider-config-commands.ts';

export class SkillProviderConfigTestHelpersScenario {
  private constructor(
    private readonly request: ReachableSourceHydrationRequest,
  ) {}

  static hydrateReachableSources(
    request: ReachableSourceHydrationRequest,
  ): Promise<readonly string[]> {
    return new SkillProviderConfigTestHelpersScenario(request).execute();
  }

  private async execute(): Promise<readonly string[]> {
    const request = this.request;
    for (let pass = 0; pass <= MAX_REACHABLE_SOURCE_PASSES; pass += 1) {
      const reachablePaths = request.discover(request.graph);
      const unreadReachablePaths = reachablePaths.filter((path) =>
        request.unreadPaths.has(path),
      );
      if (unreadReachablePaths.length === 0) return reachablePaths;
      for (const path of unreadReachablePaths) {
        if (path.startsWith('/') || path.split('/').includes('..'))
          throw new Error(`Reachable configuration path is unsafe: ${path}`);
        const source = await request.readSource(path);
        SkillProviderConfigCommandsScenario.assertRunnableConfigurationBytes(
          source,
        );
        request.sources.set(path, source);
        request.unreadPaths.delete(path);
      }
    }
    throw new Error(
      'Reachable configuration hydration exceeds traversal limit',
    );
  }

  static async hydrateRepositorySources(
    request: RepositorySourceHydrationRequest,
  ): Promise<readonly string[]> {
    const readSource = (path: string): Promise<string> =>
      Bun.file(join(request.repositoryRoot, path)).text();
    const hydrationRequest = { ...request, readSource };
    return SkillProviderConfigTestHelpersScenario.hydrateReachableSources(
      hydrationRequest,
    );
  }

  static async pathsContainingProviderRoot(
    paths: readonly string[],
  ): Promise<readonly string[]> {
    const matches: string[] = [];
    for (const path of paths) {
      const source = await Bun.file(join(REPOSITORY_ROOT, path)).text();
      const inspection: ExecutableProviderReferenceInspection = {
        path,
        source,
      };
      if (
        SkillProviderConfigApplicationScenario.isApplicationDependency(path) ||
        SkillProviderExecutableScriptScenario.executableSourceReferencesProvider(
          inspection,
        )
      )
        matches.push(path);
    }
    return matches;
  }
}

const REPOSITORY_ROOT = join(import.meta.dir, '../../..');

const MAX_REACHABLE_SOURCE_PASSES = 32;

type ConfigurationDiscovery = (
  graph: ConfigurationScriptGraph,
) => readonly string[];

type ConfigurationSourceReader = (path: string) => Promise<string>;

type ReachableSourceHydrationRequest = {
  readonly discover: ConfigurationDiscovery;
  readonly graph: ConfigurationScriptGraph;
  readonly readSource: ConfigurationSourceReader;
  readonly sources: Map<string, string>;
  readonly unreadPaths: Set<string>;
};

type RepositorySourceHydrationRequest = Omit<
  ReachableSourceHydrationRequest,
  'readSource'
> & { readonly repositoryRoot: string };
