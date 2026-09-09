import { posix } from 'node:path';

import { SkillProviderBoundaryScenario } from './skill-provider-boundary.test.ts';

import {
  type ConfigurationReferenceInspection,
  type ConfigurationScriptGraph,
  ShellExecutablePolicy,
  SkillProviderExecutableScriptScenario,
} from './skill-provider-executable-script.ts';

import {
  type ShellScriptLaunch,
  SkillProviderCommandBoundaryScenario,
} from './skill-provider-command-boundary.ts';

import type { SkillProviderSourceInspection } from './skill-provider-type-context.ts';

import { CortexArticleAdapterBoundaryScenario } from './cortex-article-adapter-boundary.ts';

import {
  LOOM_ARTICLE_ADAPTER,
  PROVIDER_ROOT,
  SkillProviderConfigApplicationScenario,
} from './skill-provider-config-application.ts';

import { SkillProviderConfigCommandsScenario } from './skill-provider-config-commands.ts';

import {
  ACTION_SOURCE_SUFFIXES,
  CONFIGURATION_GRAPH_LIMITS as LIMITS,
  SkillProviderConfigRuntimeScenario,
} from './skill-provider-config-runtime.ts';

import { SkillProviderGithubScriptScenario } from './skill-provider-github-script.ts';

import {
  eslintConfigurationReferences,
  type EslintConfigurationRequest,
} from './skill-provider-eslint-config.ts';

import { SkillProviderTypescriptSubprocessScenario } from './skill-provider-typescript-subprocess.ts';

import {
  AUDITED_SOURCE_SEAMS,
  SkillProviderSourcedSeamsScenario,
} from './skill-provider-sourced-seams.ts';

import type {
  ActionDependencyResolution,
  ActionRuntimeGraph,
  ApplicationConsumerEdge,
  ConfigurationReference,
  ConfigurationReferenceRequest,
  GitHubActionDocument,
  PendingConfiguration,
} from './skill-provider-config-types.ts';
export class SkillProviderConfigBoundaryScenario {
  private constructor(private readonly request: ConfigurationScriptGraph) {}

  static configurationScriptPaths(
    graph: ConfigurationScriptGraph,
  ): readonly string[] {
    return new SkillProviderConfigBoundaryScenario(graph).execute();
  }

  private execute(): readonly string[] {
    const graph = this.request;
    const pending: PendingConfiguration[] = graph.roots.map((importer) => ({
      importer,
      positionalArguments: false,
      shellRuntime: false,
      depth: 0,
      workingDirectory:
        SkillProviderConfigRuntimeScenario.configurationRootWorkingDirectory(
          importer,
        ),
    }));
    const visited = new Set<string>();
    const scripts = new Set<string>();
    while (pending.length > 0) {
      const next = pending.pop();
      if (!next) continue;
      const importer = next.importer;
      if (next.depth > LIMITS.depth || visited.size >= LIMITS.states)
        throw new Error('Runnable configuration graph exceeds its bound.');
      if (
        next.positionalArguments !== false &&
        next.positionalArguments.length > LIMITS.arguments
      )
        throw new Error('Runnable configuration arguments exceed their bound.');
      const visitKey = `${importer}\0${next.shellRuntime}\0${next.workingDirectory}\0${JSON.stringify(next.positionalArguments)}`;
      if (new TextEncoder().encode(visitKey).byteLength > LIMITS.stateBytes)
        throw new Error('Runnable configuration state exceeds its byte bound.');
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);
      const source = graph.sources.get(importer);
      if (typeof source !== 'string' || graph.symlinkPaths.has(importer)) {
        throw new Error(`Runnable configuration path is unsafe: ${importer}`);
      }
      const sourceBoundaryRequest = {
        path: importer,
        source,
      };
      if (graph.roots.includes(importer))
        SkillProviderConfigApplicationScenario.assertConfigurationSourceBoundary(
          sourceBoundaryRequest,
        );
      if (importer.startsWith(PROVIDER_ROOT)) {
        throw new Error(`Runnable configuration reaches provider: ${importer}`);
      }
      for (const seam of AUDITED_SOURCE_SEAMS.filter(
        (candidate) => candidate.sourcePath === importer,
      )) {
        if (!source.includes(seam.marker))
          throw new Error(`Audited source seam is absent: ${importer}`);
        if (seam.targetPath === false || seam.digest === false) continue;
        const [target = ''] = [graph.sources.get(seam.targetPath)];
        const digest = new Bun.CryptoHasher('sha256')
          .update(target)
          .digest('hex');
        if (digest !== seam.digest)
          throw new Error(
            `Audited source helper has drifted: ${seam.targetPath}`,
          );
      }
      const referenceInspection: ConfigurationReferenceInspection = {
        importer,
        source,
      };
      const configurationRequest = {
        inspection: referenceInspection,
        positionalArguments: next.positionalArguments,
        shellRuntime: next.shellRuntime,
        sources: graph.sources,
        workingDirectory: next.workingDirectory,
      };
      for (const reference of SkillProviderConfigBoundaryScenario.configurationScriptReferences(
        configurationRequest,
      )) {
        const specifier = reference.specifier;
        const resolutionRequest = {
          exactFirst: reference.required,
          importer,
          importerRelative: reference.importerRelative,
          specifier,
          sources: graph.sources,
          workingDirectory: next.workingDirectory,
        };
        const candidates =
          SkillProviderConfigRuntimeScenario.resolutionCandidates(
            resolutionRequest,
          );
        const [dependency = false] = candidates.filter((path) =>
          graph.sources.has(path),
        );
        if (dependency === false) {
          const packageRequest = { sources: graph.sources, specifier };
          if (
            SkillProviderConfigRuntimeScenario.isRepositoryBackedPackageSpecifier(
              packageRequest,
            )
          )
            throw new Error(
              `Runnable repository package import is unsupported: ${importer} -> ${specifier}`,
            );
          if (
            reference.required &&
            (reference.taskInclude || posix.extname(specifier).length > 0)
          ) {
            throw new Error(
              `Runnable script is untracked: ${importer} -> ${specifier}`,
            );
          }
          continue;
        }
        if (graph.symlinkPaths.has(dependency)) {
          throw new Error(
            `Runnable script is a tracked symlink: ${dependency}`,
          );
        }
        const isExtensionlessExecutable =
          posix.extname(dependency).length === 0 &&
          (!reference.requiresExecuteMode ||
            graph.executablePaths.has(dependency));
        if (
          reference.taskInclude ||
          reference.shellRuntime ||
          CONFIGURATION_SCRIPT_EXTENSION.test(dependency) ||
          isExtensionlessExecutable
        ) {
          const edge: ApplicationConsumerEdge = { dependency, importer };
          const applicationEdge =
            SkillProviderConfigApplicationScenario.isApplicationDependency(
              dependency,
            );
          if (
            applicationEdge &&
            !SkillProviderConfigApplicationScenario.isAuthorizedApplicationEdge(
              edge,
            )
          ) {
            throw new Error(`Unauthorized application edge: ${importer}`);
          }
          const specializationRequest = {
            arguments: reference.positionalArguments,
            source: [graph.sources.get(dependency)].join(''),
          };
          const specializedSource =
            SkillProviderConfigRuntimeScenario.specializePositionalArguments(
              specializationRequest,
            );
          const adapterInspection = {
            path: dependency,
            source: specializedSource,
          };
          if (
            dependency === LOOM_ARTICLE_ADAPTER &&
            CortexArticleAdapterBoundaryScenario.cortexArticleAdapterViolatesBoundary(
              adapterInspection,
            )
          ) {
            throw new Error(`Article adapter violates boundary: ${dependency}`);
          }
          const boundaryInspection = {
            path: reference.shellRuntime ? `${dependency}.sh` : dependency,
            roots: new Set(graph.roots),
            shellPolicy: ShellExecutablePolicy.TrackedConfiguration,
            source: specializedSource,
            sources: graph.sources,
          };
          const runtimeSourceRequest = {
            path: dependency,
            source: [graph.sources.get(dependency)].join(''),
          };
          if (
            !applicationEdge &&
            !reference.taskInclude &&
            !SkillProviderSourcedSeamsScenario.isAuditedRuntimeSource(
              runtimeSourceRequest,
            ) &&
            SkillProviderExecutableScriptScenario.executableScriptViolatesBoundary(
              boundaryInspection,
            )
          ) {
            throw new Error(
              `Runnable script violates runtime boundary: ${dependency}`,
            );
          }
          if (dependency.startsWith(PROVIDER_ROOT)) {
            continue;
          }
          scripts.add(dependency);
          const pendingConfiguration: PendingConfiguration = {
            importer: dependency,
            positionalArguments: reference.positionalArguments,
            shellRuntime: reference.shellRuntime,
            depth: next.depth + 1,
            workingDirectory: reference.workingDirectory,
          };
          pending.push(pendingConfiguration);
        }
      }
    }
    return [...scripts].sort();
  }

  static configurationScriptReferences(request: ConfigurationReferenceRequest) {
    const inspection = request.inspection;
    const extensionlessModule =
      posix.extname(inspection.importer).length === 0 &&
      (!inspection.source.startsWith('#!') ||
        /^#![^\n]*(?:bun|node)/u.test(inspection.source)) &&
      ACTION_IMPORT_SCANNER.scanImports(inspection.source).length > 0;
    if (
      !EXECUTABLE_SOURCE_EXTENSION.test(inspection.importer) &&
      !extensionlessModule
    ) {
      const runtimeSourceRequest = {
        path: inspection.importer,
        source: inspection.source,
      };
      if (
        SkillProviderSourcedSeamsScenario.isAuditedRuntimeSource(
          runtimeSourceRequest,
        )
      )
        return [];
      const commandInspection = {
        path: inspection.importer,
        source: inspection.source,
      };
      const commands = request.shellRuntime
        ? [inspection.source.replace(/^#![^\n]*(?:\n|$)/u, '')]
        : SkillProviderConfigCommandsScenario.runnableCommandSources(
            commandInspection,
          );
      const launches = commands.flatMap(
        (source): readonly ShellScriptLaunch[] => {
          const shellInspection = {
            positionalArguments: request.positionalArguments,
            source:
              SkillProviderConfigRuntimeScenario.normalizeConfigurationShellSource(
                [source, inspection.importer],
              ),
            sourcePath: inspection.importer,
          };
          return SkillProviderCommandBoundaryScenario.analyzeShellCommands(
            shellInspection,
          ).launches;
        },
      );
      const eslintRequest: EslintConfigurationRequest = {
        commands,
        importer: inspection.importer,
        sources: request.sources,
        workingDirectory: request.workingDirectory,
      };
      const references: ConfigurationReference[] = [
        ...eslintConfigurationReferences(eslintRequest),
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
      if (/\.ya?ml$/u.test(inspection.importer))
        references.push(
          ...SkillProviderConfigCommandsScenario.taskIncludeSpecifiers(
            inspection.source,
          ).map((specifier) => ({
            importerRelative: true,
            positionalArguments: false as const,
            required: true,
            requiresExecuteMode: false,
            shellRuntime: false,
            specifier,
            taskInclude: true,
            workingDirectory: request.workingDirectory,
          })),
        );
      const githubScriptRequest = {
        importer: inspection.importer,
        positionalArguments: request.positionalArguments,
        source: inspection.source,
        workingDirectory: request.workingDirectory,
      };
      references.push(
        ...SkillProviderGithubScriptScenario.githubScriptConfigurationReferences(
          githubScriptRequest,
        ),
      );
      return references;
    }
    const specializationRequest = {
      arguments: request.positionalArguments,
      source: inspection.source.replace(/^#![^\n]*\n/u, ''),
    };
    const importSource =
      SkillProviderConfigRuntimeScenario.specializePositionalArguments(
        specializationRequest,
      );
    const imports: ConfigurationReference[] = ACTION_IMPORT_SCANNER.scanImports(
      importSource,
    ).map((imported) => ({
      importerRelative: true,
      positionalArguments: false,
      required: false,
      requiresExecuteMode: false,
      shellRuntime: false,
      specifier: imported.path,
      taskInclude: false,
      workingDirectory: request.workingDirectory,
    }));
    const subprocessInspection = {
      path: inspection.importer,
      source: importSource,
    };
    const runtimeSourceRequest = {
      path: inspection.importer,
      source: inspection.source,
    };
    const subprocesses =
      SkillProviderSourcedSeamsScenario.isAuditedRuntimeSource(
        runtimeSourceRequest,
      )
        ? []
        : SkillProviderTypescriptSubprocessScenario.typescriptSubprocessCommands(
            subprocessInspection,
          );
    const launches = subprocesses.flatMap(
      (source): readonly ConfigurationReference[] => {
        const shellInspection = {
          positionalArguments: request.positionalArguments,
          source,
          sourcePath: inspection.importer,
        };
        const shellLaunches =
          SkillProviderCommandBoundaryScenario.analyzeShellCommands(
            shellInspection,
          ).launches;
        return shellLaunches.map((launch) => ({
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
        }));
      },
    );
    return [...imports, ...launches];
  }

  static actionRuntimePaths(graph: ActionRuntimeGraph): readonly string[] {
    const pending = [...graph.roots];
    const pendingSources: string[] = [];
    const visited = new Set<string>();
    const runtimePaths = new Set<string>();
    while (pending.length > 0) {
      const manifestPath = pending.pop();
      if (!manifestPath || visited.has(manifestPath)) continue;
      if (graph.symlinkPaths.has(manifestPath)) {
        throw new Error(`Action path is a tracked symlink: ${manifestPath}`);
      }
      visited.add(manifestPath);
      runtimePaths.add(manifestPath);
      const source = graph.sources.get(manifestPath);
      if (typeof source !== 'string') {
        throw new Error(
          `Tracked action manifest is unreadable: ${manifestPath}`,
        );
      }
      SkillProviderConfigCommandsScenario.assertRunnableConfigurationBytes(
        source,
      );
      const document = Bun.YAML.parse(source) as GitHubActionDocument;
      const runs = document?.runs;
      if (!runs || typeof runs.using !== 'string') {
        throw new Error(`Tracked action has no runs.using: ${manifestPath}`);
      }
      if (runs.using === 'composite') {
        if (!Array.isArray(runs.steps)) {
          throw new Error(`Composite action has no steps: ${manifestPath}`);
        }
        for (const step of runs.steps) {
          if (typeof step.uses !== 'string') {
            continue;
          }
          if (step.uses.startsWith('docker://')) {
            throw new Error(`Unsupported Docker action step: ${step.uses}`);
          }
          if (!step.uses.startsWith('./')) continue;
          const localRoot = posix.normalize(step.uses.slice(2));
          if (localRoot.startsWith('../') || posix.isAbsolute(localRoot)) {
            throw new Error(
              `Local action escapes the repository: ${step.uses}`,
            );
          }
          const candidates = [
            posix.join(localRoot, 'action.yml'),
            posix.join(localRoot, 'action.yaml'),
          ].filter((path) => graph.sources.has(path));
          if (candidates.length !== 1) {
            throw new Error(
              `Local action manifest is unresolved: ${step.uses}`,
            );
          }
          const nestedManifest = candidates[0];
          if (nestedManifest) pending.push(nestedManifest);
        }
        continue;
      }
      if (runs.using === 'docker') {
        throw new Error(`Unsupported Docker action runtime: ${manifestPath}`);
      }
      if (!runs.using.startsWith('node') || typeof runs.main !== 'string') {
        throw new Error(`Unsupported action runtime: ${manifestPath}`);
      }
      for (const field of ['pre', 'post'] as const) {
        if (field in runs && typeof runs[field] !== 'string') {
          throw new Error(
            `Invalid action ${field} entrypoint: ${manifestPath}`,
          );
        }
      }
      for (const entrypoint of [runs.main, runs.pre, runs.post]) {
        if (typeof entrypoint !== 'string') continue;
        const runtimePath = posix.normalize(
          posix.join(posix.dirname(manifestPath), entrypoint),
        );
        if (graph.symlinkPaths.has(runtimePath)) {
          throw new Error(`Action path is a tracked symlink: ${runtimePath}`);
        }
        if (!graph.sources.has(runtimePath)) {
          throw new Error(`Action entrypoint is untracked: ${runtimePath}`);
        }
        runtimePaths.add(runtimePath);
        pendingSources.push(runtimePath);
      }
    }
    const actionConfigurationGraph: ConfigurationScriptGraph = {
      executablePaths: new Set(),
      roots: pendingSources,
      sources: graph.sources,
      symlinkPaths: graph.symlinkPaths,
    };
    const actionConfigurationPaths =
      SkillProviderConfigBoundaryScenario.configurationScriptPaths(
        actionConfigurationGraph,
      );
    const visitedSources = new Set<string>();
    while (pendingSources.length > 0) {
      const importer = pendingSources.pop();
      if (!importer || visitedSources.has(importer)) continue;
      visitedSources.add(importer);
      const source = graph.sources.get(importer);
      if (typeof source !== 'string') {
        throw new Error(`Action source is unreadable: ${importer}`);
      }
      const boundaryInspection: SkillProviderSourceInspection = {
        filePath: posix.extname(importer) === '' ? `${importer}.js` : importer,
        source,
      };
      if (
        SkillProviderBoundaryScenario.violatesSkillProviderBoundary(
          boundaryInspection,
        )
      ) {
        throw new Error(`Action source violates runtime boundary: ${importer}`);
      }
      for (const imported of ACTION_IMPORT_SCANNER.scanImports(source)) {
        const resolution: ActionDependencyResolution = {
          importer,
          sources: graph.sources,
          specifier: imported.path,
        };
        if (!imported.path.startsWith('.')) {
          if (
            SkillProviderConfigRuntimeScenario.isRepositoryBackedPackageSpecifier(
              resolution,
            )
          ) {
            throw new Error(
              `Action repository import is unsupported: ${importer} -> ${imported.path}`,
            );
          }
          continue;
        }
        const dependency =
          SkillProviderConfigBoundaryScenario.resolveActionDependency(
            resolution,
          );
        if (
          dependency === false ||
          !EXECUTABLE_SOURCE_EXTENSION.test(dependency)
        ) {
          throw new Error(
            `Action relative import is unresolved: ${importer} -> ${imported.path}`,
          );
        }
        if (
          SkillProviderConfigApplicationScenario.isApplicationDependency(
            dependency,
          )
        ) {
          throw new Error(`Unauthorized action application edge: ${importer}`);
        }
        if (graph.symlinkPaths.has(dependency)) {
          throw new Error(`Action path is a tracked symlink: ${dependency}`);
        }
        if (!runtimePaths.has(dependency)) {
          runtimePaths.add(dependency);
          pendingSources.push(dependency);
        }
      }
    }
    for (const path of actionConfigurationPaths) runtimePaths.add(path);
    return [...runtimePaths].sort();
  }

  static resolveActionDependency(
    resolution: ActionDependencyResolution,
  ): string | false {
    const base = posix.normalize(
      posix.join(posix.dirname(resolution.importer), resolution.specifier),
    );
    for (const suffix of ACTION_SOURCE_SUFFIXES) {
      const direct = `${base}${suffix}`;
      if (resolution.sources.has(direct)) return direct;
      const indexed = posix.join(base, `index${suffix}`);
      if (resolution.sources.has(indexed)) return indexed;
    }
    return false;
  }
}

export const EXECUTABLE_SOURCE_EXTENSION = /\.(?:[cm]?tsx?|[cm]?jsx?)$/u;

export const CONFIGURATION_SCRIPT_EXTENSION = /\.(?:[cm]?tsx?|[cm]?jsx?|sh)$/u;

export const ACTION_IMPORT_SCANNER = new Bun.Transpiler({ loader: 'tsx' });
