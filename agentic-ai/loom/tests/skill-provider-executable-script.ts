import { posix } from 'node:path';
import {
  referencesSkillProvider,
  violatesSkillProviderBoundary,
} from './skill-provider-boundary.test.ts';
import {
  specializeBoundedLocalDataLoaders,
  specializeBoundedPackageLoaders,
  specializeProvenGeneratedArtifactLoader,
} from './skill-provider-bounded-package-loader.ts';
import { specializeClosedFiniteNodeLoaders } from './skill-provider-finite-node-loader.ts';

export type ExecutableScriptInspection = {
  readonly path: string;
  readonly roots: ReadonlySet<string>;
  readonly shellPolicy: ShellExecutablePolicy;
  readonly source: string;
  readonly sources: ReadonlyMap<string, string>;
};

export type ExecutableProviderReferenceInspection = {
  readonly path: string;
  readonly source: string;
};
export type RequiredScriptLaunchInspection = {
  readonly source: string;
  readonly specifier: string;
};
export type ConfigurationExecutableSourceRequest = {
  readonly knownTaskVariables?: ReadonlyMap<string, string>;
  readonly path: string;
  readonly source: string;
};
export type ConfigurationScriptGraph = {
  readonly executablePaths: ReadonlySet<string>;
  readonly roots: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
  readonly symlinkPaths: ReadonlySet<string>;
};
export type ConfigurationReferenceInspection = {
  readonly importer: string;
  readonly source: string;
};
type TaskCommandOptions = {
  readonly cmd?: string;
  readonly dir?: string;
  readonly task?: string;
  readonly vars?: Readonly<Record<string, string>>;
};
type TaskCommandDocument = string | TaskCommandOptions;
type TaskShellValue = string | { readonly sh?: string };
type TaskPrecondition = string | { readonly sh?: string };
type TaskDefinitionDocument = {
  readonly cmds?: readonly TaskCommandDocument[];
  readonly deps?: readonly TaskCommandDocument[];
  readonly desc?: string;
  readonly dir?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly generates?: readonly string[];
  readonly preconditions?: readonly TaskPrecondition[];
  readonly requires?: { readonly vars?: readonly string[] };
  readonly status?: readonly string[];
  readonly vars?: Readonly<Record<string, TaskShellValue>>;
};
type TaskfileDocument = {
  readonly tasks?: Readonly<Record<string, TaskDefinitionDocument>>;
  readonly vars?: Readonly<Record<string, TaskShellValue>>;
  readonly version?: string;
};
type CanonicalHostTaskRequest = {
  readonly task: TaskDefinitionDocument;
  readonly taskName: string;
};
type DeclaredTaskVariables = ReadonlyMap<string, string>;
const EMPTY_TASK_VALUES: Readonly<Record<string, TaskShellValue>> = {};
const EMPTY_TASKS: Readonly<Record<string, TaskDefinitionDocument>> = {};
const EMPTY_STRING_VALUES: Readonly<Record<string, string>> = {};
export enum ShellExecutablePolicy {
  Reject = 'reject',
  TrackedConfiguration = 'tracked-configuration',
}
const TYPESCRIPT_JAVASCRIPT_SOURCE = /\.(?:[cm]?[jt]sx?)$/u;
const TYPESCRIPT_SOURCE = /\.(?:cts|mts|ts|tsx)$/u;
const SHELL_SOURCE = /\.sh$/u;
const SHELL_PROVIDER_EXECUTION =
  /(?:\b(?:bun|node|bash|sh|source)\s+|(?:^|[\n;&|])\s*\.\s+)["']?(?:\.\/|\.\.\/|\/)?[^\s"']*\.cortex\/teams\/ai\/dynamic-skills\/(?:cortex-article-structure|executable-skill-host)\/scripts\//gmu;
const SHELL_REPOSITORY_SCRIPT_EXECUTION =
  /(?:^|[\n;&|])\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*)(?:(?:exec|command)\s+)?(?:bun|node|bash|sh|source|\.)\s+(?!-)[^\n;&|]+/gmu;
type BoundaryTranspilerOptions = { readonly loader: 'tsx' };
const boundaryTranspilerOptions: BoundaryTranspilerOptions = { loader: 'tsx' };
const BOUNDARY_TRANSPILER = new Bun.Transpiler(boundaryTranspilerOptions);
function parseTaskfileSource(source: string): TaskfileDocument {
  const parseableSource = source
    .replace(
      /\{\{default \(printf "%s([^"]*)" \.([A-Za-z_][A-Za-z0-9_]*)\) \.[A-Za-z_][A-Za-z0-9_]*\}\}/gu,
      'TASK_VARIABLE_$2$1',
    )
    .replace(
      /\{\{default \.([A-Za-z_][A-Za-z0-9_]*) \.[A-Za-z_][A-Za-z0-9_]*\}\}/gu,
      'TASK_VARIABLE_$1',
    )
    .replace(/\{\{default "([^"]*)" \.[A-Za-z_][A-Za-z0-9_]*\}\}/gu, '$1')
    .replaceAll(
      '{{.TASK_NAMES | default .TASK_NAME}}',
      'TASK_VARIABLE_REQUESTED_TASK_NAMES',
    )
    .replace(/\{\{\.([A-Za-z_][A-Za-z0-9_]*)\}\}/gu, 'TASK_VARIABLE_$1')
    .replace(/\{\{[^}\n]+\}\}/gu, 'TASK_VARIABLE_UNKNOWN');
  return Bun.YAML.parse(parseableSource) as TaskfileDocument;
}
export function declaredTaskVariables(
  sources: DeclaredTaskVariables,
): DeclaredTaskVariables {
  const variables = new Map<string, string>();
  for (const [path, source] of sources) {
    if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
    try {
      const document = parseTaskfileSource(source);
      for (const [name, value] of Object.entries(
        document.vars ?? EMPTY_TASK_VALUES,
      )) {
        if (!variables.has(name))
          variables.set(
            name,
            typeof value === 'string' ? value : 'TASK_DECLARED_VALUE',
          );
      }
      for (const task of Object.values(document.tasks ?? EMPTY_TASKS)) {
        for (const name of Object.keys(task.vars ?? EMPTY_TASK_VALUES))
          variables.set(name, 'TASK_DECLARED_VALUE');
        for (const name of Object.keys(task.env ?? EMPTY_STRING_VALUES))
          variables.set(name, 'TASK_DECLARED_VALUE');
        for (const name of task.requires?.vars ?? [])
          variables.set(name, 'TASK_DECLARED_VALUE');
        for (const command of [...(task.deps ?? []), ...(task.cmds ?? [])]) {
          if (typeof command === 'string') continue;
          for (const name of Object.keys(command.vars ?? EMPTY_STRING_VALUES))
            variables.set(name, 'TASK_DECLARED_VALUE');
        }
      }
    } catch {
      // The executable scan retains malformed configuration source verbatim.
    }
  }
  return variables;
}
export function configurationExecutableSource(
  request: ConfigurationExecutableSourceRequest,
): string {
  const { knownTaskVariables, path, source } = request;
  if (!path.endsWith('.yml') && !path.endsWith('.yaml')) return source;
  let document: TaskfileDocument;
  try {
    document = parseTaskfileSource(source);
  } catch {
    return source;
  }
  const tasks = document?.tasks;
  if (!tasks) return source;
  const variables = new Map<string, string>([
    ['REPO_ROOT', '.'],
    ['ROOT_DIR', '.'],
    ['PREFLIGHT_SOURCE_ROOT', '.'],
    ['REQUESTED_TASK_NAMES', 'REQUIRED_VALUE'],
    ['TASKFILE_DIR', '.'],
  ]);
  for (const [name, value] of knownTaskVariables ?? []) {
    if (!variables.has(name)) variables.set(name, value);
  }
  for (const name of Object.keys(document.vars ?? EMPTY_TASK_VALUES)) {
    if (!variables.has(name)) variables.set(name, 'TASK_DECLARED_VALUE');
  }
  for (const task of Object.values(tasks)) {
    for (const name of [
      ...Object.keys(task.vars ?? EMPTY_TASK_VALUES),
      ...Object.keys(task.env ?? EMPTY_TASK_VALUES),
    ]) {
      if (!variables.has(name)) variables.set(name, 'TASK_LOCAL_VALUE');
    }
    for (const name of task.requires?.vars ?? []) {
      variables.set(name, 'REQUIRED_VALUE');
    }
  }
  const resolveTemplates = (text: string): string => {
    let resolved = text;
    for (let pass = 0; pass <= variables.size; pass += 1) {
      const previous = resolved;
      for (const [name, value] of variables)
        resolved = resolved.replaceAll(`TASK_VARIABLE_${name}`, value);
      if (resolved === previous) break;
    }
    if (resolved.includes('TASK_VARIABLE_'))
      throw new Error('Unresolved Task template in executable field.');
    return resolved;
  };
  const commandSources = Object.values(document.vars ?? EMPTY_TASK_VALUES).map(
    (value) =>
      resolveTemplates(typeof value === 'string' ? value : (value.sh ?? '')),
  );
  for (const [taskName, task] of Object.entries(tasks)) {
    const taskCommandSources: string[] = [];
    const taskDirectory = resolveTemplates(task.dir ?? '');
    const commands: readonly TaskCommandDocument[] = [
      ...(task.deps ?? []).map((value) =>
        typeof value === 'string' ? `task ${value}` : value,
      ),
      ...(task.cmds ?? []),
      ...(task.status ?? []),
      ...(task.env ? Object.values(task.env) : []),
      ...(task.preconditions ?? []).map((value) =>
        typeof value === 'string' ? value : (value.sh ?? ''),
      ),
      ...Object.values(task.vars ?? EMPTY_TASK_VALUES).map((value) =>
        typeof value === 'string' ? `task ${value}` : (value.sh ?? ''),
      ),
    ];
    for (const command of commands) {
      const commandText =
        typeof command === 'string'
          ? command
          : (command.cmd ?? `task ${command.task}`);
      let normalized = resolveTemplates(commandText);
      normalized = normalized.replace(
        /\bbun\s+(?:build|install|test|x|run\s+[A-Za-z0-9:_-]+)(?=\s|$)/u,
        'bun --version',
      );
      const launches = normalized.matchAll(
        /\b(?:bun|node|bash|sh)\s+(?:--cwd(?:=|\s+)["']?([^\s"']+)["']?\s+)?["']?([^\s"';&|]+)/gu,
      );
      const inlineDirectory = normalized.match(
        /(?:^|&&)\s*cd\s+["']?([^\s"';&|]+)["']?\s*&&/u,
      )?.[1];
      for (const launch of launches) {
        const target = launch[2];
        const directory = resolveTemplates(
          launch[1] ??
            inlineDirectory ??
            (typeof command === 'string'
              ? taskDirectory
              : (command.dir ?? taskDirectory)),
        );
        if (!target || !directory || target.startsWith('-')) continue;
        normalized = normalized.replace(target, posix.join(directory, target));
      }
      commandSources.push(normalized);
      taskCommandSources.push(normalized);
      if (typeof command !== 'string') {
        for (const value of Object.values(command.vars ?? EMPTY_STRING_VALUES))
          commandSources.push(resolveTemplates(value));
      }
    }
    for (const generated of task.generates ?? []) {
      const generatedPath = `- ${posix.join(taskDirectory, generated)}`;
      commandSources.push(generatedPath);
      taskCommandSources.push(generatedPath);
    }
    if (
      path === '.task/agentic-ai.yml' &&
      taskCommandSources.some((command) =>
        /executable-skill-host\/scripts\/src\/cli\.ts|\btask\s+skills:(?:run|tools-list)\b/u.test(
          command,
        ),
      )
    ) {
      const canonicalRequest: CanonicalHostTaskRequest = { task, taskName };
      assertCanonicalHostTask(canonicalRequest);
    }
  }
  for (const value of Object.values(document.vars ?? EMPTY_TASK_VALUES)) {
    if (typeof value !== 'string' && value.sh) {
      if (
        path === '.task/agentic-ai.yml' &&
        value.sh.includes(
          '.cortex/teams/ai/dynamic-skills/executable-skill-host/scripts/src/cli.ts',
        )
      ) {
        throw new Error('Unauthorized root Task variable reaches skill host.');
      }
      commandSources.push(value.sh);
    }
  }
  if (
    path === '.task/agentic-ai.yml' &&
    ('CONFIG' in (document.vars ?? EMPTY_TASK_VALUES) ||
      Object.entries(document.vars ?? EMPTY_TASK_VALUES).some(
        ([name, value]) => typeof value !== 'string' && name !== 'REPO_ROOT',
      ))
  )
    throw new Error('Unauthorized root Task variable reaches skill host.');
  return commandSources.join('\n');
}

function assertCanonicalHostTask(request: CanonicalHostTaskRequest): void {
  const { task, taskName } = request;
  const command = task.cmds?.at(0);
  const common =
    task.cmds?.length === 1 &&
    typeof command === 'string' &&
    !('dir' in task) &&
    task.deps?.length === 1 &&
    task.deps[0] === 'skills:install' &&
    !task.status &&
    !task.preconditions &&
    !task.vars;
  const validRun =
    taskName === 'skills:run' &&
    common &&
    Object.keys(task).sort().join() === 'cmds,deps,desc,env,requires' &&
    task.desc ===
      'Run one executable skill action from a domain YAML request (CONFIG=<request.yaml>).' &&
    command ===
      'bun .cortex/teams/ai/dynamic-skills/executable-skill-host/scripts/src/cli.ts "$NOOK_SKILL_CONFIG"' &&
    task.env?.NOOK_SKILL_CONFIG === 'TASK_VARIABLE_CONFIG' &&
    Object.keys(task.env).length === 1 &&
    task.requires?.vars?.length === 1 &&
    task.requires.vars[0] === 'CONFIG';
  const validList =
    taskName === 'skills:tools-list' &&
    common &&
    Object.keys(task).sort().join() === 'cmds,deps,desc' &&
    task.desc ===
      'List executable skill actions, YAML examples, and request schemas.' &&
    command ===
      'bun .cortex/teams/ai/dynamic-skills/executable-skill-host/scripts/src/cli.ts --default toolsList' &&
    !task.env &&
    !task.requires;
  if (!validRun && !validList)
    throw new Error(`Unauthorized host task: ${taskName}`);
}

export function isRequiredScriptLaunch(
  inspection: RequiredScriptLaunchInspection,
): boolean {
  if (inspection.specifier.includes('/node_modules/.bin/')) return false;
  if (
    inspection.specifier.includes('TASK_VARIABLE_') &&
    !/(?:cli\.ts|skill-action-registry\.ts|cortex-article-structure)/u.test(
      inspection.specifier,
    )
  ) {
    return false;
  }
  const escapedSpecifier = inspection.specifier.replace(
    /[.*+?^${}()|[\]\\]/gu,
    '\\$&',
  );
  const launchPattern = new RegExp(
    `(?:^|[\\s;&|"'=:\\[(])(?:bun(?:\\s+--cwd(?:=|\\s+)["']?\\S+["']?)?|node|bash|sh)\\s+["']?${escapedSpecifier}(?=$|[\\s"';&|])`,
    'u',
  );
  const generatedPattern = new RegExp(
    `(?:^|\\n)\\s*-\\s+["']?${escapedSpecifier}["']?(?:\\n|$)`,
    'u',
  );
  if (generatedPattern.test(inspection.source)) return false;
  return launchPattern.test(inspection.source);
}

export function executableScriptViolatesBoundary(
  inspection: ExecutableScriptInspection,
): boolean {
  if (SHELL_SOURCE.test(inspection.path)) {
    const referenceInspection: ExecutableProviderReferenceInspection = {
      path: inspection.path,
      source: inspection.source,
    };
    return (
      inspection.shellPolicy === ShellExecutablePolicy.Reject ||
      executableSourceReferencesProvider(referenceInspection)
    );
  }
  const extension = posix.extname(inspection.path);
  if (extension.length > 0 && !TYPESCRIPT_JAVASCRIPT_SOURCE.test(extension)) {
    return true;
  }
  const commonJsSource = inspection.path.endsWith('.cjs')
    ? inspection.source
        .replace(/\bmodule\.exports\b/gu, 'commonJsExports')
        .replace(/\brequire\.main\s*===\s*module\b/gu, 'isMainModule')
    : inspection.source;
  const normalizedSource = commonJsSource
    .replace(/\bglobalThis\.fetch\?\.bind\(globalThis\)/gu, 'globalThis.fetch')
    .replace(/(["'])document\1\s+in\s+globalThis/gu, 'documentIsAvailable')
    .replace(/\[Symbol\.asyncDispose\]/gu, '.safeAsyncDispose');
  const specialization = {
    path: inspection.path,
    roots: inspection.roots,
    source: normalizedSource,
    sources: inspection.sources,
  };
  const packageBoundedSource = specializeBoundedPackageLoaders(specialization);
  const localDataSpecialization = {
    path: inspection.path,
    roots: inspection.roots,
    source: packageBoundedSource,
    sources: inspection.sources,
  };
  const localDataBoundedSource = specializeBoundedLocalDataLoaders(
    localDataSpecialization,
  );
  const artifactSpecialization = {
    path: inspection.path,
    roots: inspection.roots,
    source: localDataBoundedSource,
    sources: inspection.sources,
  };
  const boundedSource = specializeProvenGeneratedArtifactLoader(
    artifactSpecialization,
  );
  const finiteNodeLoaderInspection = {
    path: extension.length === 0 ? `${inspection.path}.js` : inspection.path,
    source: boundedSource,
  };
  const finiteNodeLoaderSource = specializeClosedFiniteNodeLoaders(
    finiteNodeLoaderInspection,
  );
  const runtimeSource = TYPESCRIPT_SOURCE.test(inspection.path)
    ? BOUNDARY_TRANSPILER.transformSync(finiteNodeLoaderSource)
    : finiteNodeLoaderSource;
  const sourceInspection = {
    allowUnprovenComputedDataAccess: true as const,
    filePath:
      extension.length === 0 || TYPESCRIPT_SOURCE.test(inspection.path)
        ? `${inspection.path}.js`
        : inspection.path,
    source: runtimeSource,
  };
  return violatesSkillProviderBoundary(sourceInspection);
}

export function executableSourceReferencesProvider(
  inspection: ExecutableProviderReferenceInspection,
): boolean {
  if (TYPESCRIPT_JAVASCRIPT_SOURCE.test(inspection.path)) {
    const importSource = inspection.source.replace(/^#![^\n]*\n/u, '');
    return BOUNDARY_TRANSPILER.scanImports(importSource).some((imported) =>
      referencesSkillProvider(imported.path),
    );
  }
  SHELL_PROVIDER_EXECUTION.lastIndex = 0;
  return SHELL_PROVIDER_EXECUTION.test(inspection.source);
}

export function shellExecutableLaunchesUnprovenScript(source: string): boolean {
  SHELL_REPOSITORY_SCRIPT_EXECUTION.lastIndex = 0;
  return SHELL_REPOSITORY_SCRIPT_EXECUTION.test(source);
}
