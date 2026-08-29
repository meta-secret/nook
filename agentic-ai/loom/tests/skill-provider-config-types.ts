import type { ShellLaunchArgument } from './skill-provider-command-types.ts';

export type ActionRuntimeGraph = {
  readonly roots: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
  readonly symlinkPaths: ReadonlySet<string>;
};
export type GitHubActionStep = { readonly uses?: string };
export type GitHubActionRuns = {
  readonly main?: string;
  readonly post?: string;
  readonly pre?: string;
  readonly steps?: readonly GitHubActionStep[];
  readonly using?: string;
};
export type GitHubActionDocument = { readonly runs?: GitHubActionRuns };
export type ActionDependencyResolution = {
  readonly importer: string;
  readonly sources: ReadonlyMap<string, string>;
  readonly specifier: string;
};
export type ActionTranspilerOptions = { readonly loader: 'tsx' };
export type ActionLoaderFixture = {
  readonly path: string;
  readonly source: string;
};
export type ConfigurationReference = {
  readonly positionalArguments: readonly ShellLaunchArgument[] | false;
  readonly required: boolean;
  readonly specifier: string;
  readonly taskInclude: boolean;
};
export type PendingConfiguration = {
  readonly depth: number;
  readonly importer: string;
  readonly positionalArguments: readonly ShellLaunchArgument[] | false;
};
export type ApplicationConsumerEdge = {
  readonly dependency: string;
  readonly importer: string;
};
export type RepositoryPackageDocument = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly name?: string;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
};
