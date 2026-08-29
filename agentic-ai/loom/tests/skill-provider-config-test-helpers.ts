import { join } from 'node:path';
import {
  executableSourceReferencesProvider,
  type ConfigurationScriptGraph,
  type ExecutableProviderReferenceInspection,
} from './skill-provider-executable-script.ts';
import { PROVIDER_ROOT } from './skill-provider-config-application.ts';
import { assertRunnableConfigurationBytes } from './skill-provider-config-commands.ts';

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

export async function hydrateReachableSources(
  request: ReachableSourceHydrationRequest,
): Promise<readonly string[]> {
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
      assertRunnableConfigurationBytes(source);
      request.sources.set(path, source);
      request.unreadPaths.delete(path);
    }
  }
  throw new Error('Reachable configuration hydration exceeds traversal limit');
}

export async function hydrateRepositorySources(
  request: RepositorySourceHydrationRequest,
): Promise<readonly string[]> {
  const readSource = (path: string): Promise<string> =>
    Bun.file(join(request.repositoryRoot, path)).text();
  const hydrationRequest = { ...request, readSource };
  return hydrateReachableSources(hydrationRequest);
}

export async function pathsContainingProviderRoot(
  paths: readonly string[],
): Promise<readonly string[]> {
  const matches: string[] = [];
  for (const path of paths) {
    const source = await Bun.file(join(REPOSITORY_ROOT, path)).text();
    const inspection: ExecutableProviderReferenceInspection = { path, source };
    if (
      path.includes(PROVIDER_ROOT) ||
      executableSourceReferencesProvider(inspection)
    )
      matches.push(path);
  }
  return matches;
}
