import { isDeepStrictEqual } from 'node:util';

type YamlValue =
  boolean | number | string | readonly YamlValue[] | YamlRecord | undefined;

interface YamlRecord {
  readonly [key: string]: YamlValue;
}

type TaskDocument = {
  readonly includes?: Readonly<Record<string, YamlValue>>;
};

type TaskSource = {
  readonly path: string;
  readonly source: string;
};

type TaskBoundarySource = string | ReadonlyMap<string, string>;

type IncludeExpectation = {
  readonly name: string;
  readonly source: string;
  readonly taskfile: string;
};

type TaskIncludeResolution = {
  readonly importer: string;
  readonly target: string;
};

type ProtectedReferenceOptions = {
  readonly allowCanonicalInclude: boolean;
};

type ProtectedReferenceInspection = {
  readonly options: ProtectedReferenceOptions;
  readonly path: readonly string[];
  readonly value: YamlValue | false;
};

export const HOST_ROOT =
  '.cortex/teams/ai/dynamic-skills/executable-skill-host/scripts/src/';
export const HOST_CLI = `${HOST_ROOT}cli.ts`;
export const HOST_TOOLS_LIST_SOURCE_PATHS = [
  HOST_CLI,
  ...'skill-action-registry skill-cli-invocation skill-command-domain skill-command-path skill-yaml-codec'
    .split(' ')
    .map((name) => `${HOST_ROOT}${name}.ts`),
];
export const ROOT_TASKFILE = 'Taskfile.yml';
export const AGENTIC_AI_TASKFILE = '.task/agentic-ai.yml';
export const CANONICAL_TASKFILE = '.task/executable-skill-host.yml';
export const HOST_CLI_TEMPLATE = `{{.REPO_ROOT}}/${HOST_CLI}`;
export const TOOLS_LIST_COMMAND = `bun "${HOST_CLI_TEMPLATE}" --default toolsList`;

export const CANONICAL_TASK_SOURCE = `version: '3'

vars:
  REPO_ROOT:
    sh: 'if [ -n "\${REPO_ROOT:-}" ]; then printf "%s" "$REPO_ROOT"; else git rev-parse --show-toplevel; fi'
  SKILL_APPLICATION_DIRS: .cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts .cortex/teams/ai/dynamic-skills/executable-skill-host/scripts

tasks:
  skills:install:
    desc: Install every executable skill package with its frozen lockfile.
    silent: true
    cmds:
      - set -euo pipefail; bun "{{.REPO_ROOT}}/agentic-ai/loom/src/executable-skills/repository-cli.ts" "{{.REPO_ROOT}}"; for skill_dir in {{.SKILL_APPLICATION_DIRS}}; do (cd "{{.REPO_ROOT}}/$skill_dir" && bun install --frozen-lockfile --silent); done

  skills:tools-list:
    desc: List executable skill actions through strict YAML.
    silent: true
    deps: [skills:install]
    cmds:
      - ${TOOLS_LIST_COMMAND}
`;

const EXPECTED_CANONICAL_TASK = parseTask(CANONICAL_TASK_SOURCE);
const PROTECTED_REFERENCES = ['executable-skill-host', 'skills:tools-list'];
const EMPTY_INCLUDES: YamlRecord = {};

export function hasCanonicalToolsListTask(source: string): boolean {
  return isDeepStrictEqual(parseTask(source), EXPECTED_CANONICAL_TASK);
}

export function hasOnlyCanonicalHostTaskEdge(
  source: TaskBoundarySource,
): boolean {
  if (typeof source === 'string') return hasCanonicalToolsListTask(source);
  const taskSources: TaskSource[] = [];
  for (const [path, taskSource] of source) {
    if (
      /(^|\/)Taskfile(?:\.[^/]*)?\.ya?ml$/u.test(path) ||
      /^\.task\/(?:[^/]+\/)*[^/]+\.ya?ml$/u.test(path)
    ) {
      const entry: TaskSource = { path, source: taskSource };
      taskSources.push(entry);
    }
  }
  return hasExactToolsListTaskGraph(taskSources);
}

export function hasExactToolsListTaskGraph(
  taskSources: readonly TaskSource[],
): boolean {
  const sources = new Map(
    taskSources.map(({ path, source }) => [path, source]),
  );
  const canonicalSource = sources.get(CANONICAL_TASKFILE);
  if (
    typeof canonicalSource !== 'string' ||
    !hasCanonicalToolsListTask(canonicalSource)
  ) {
    return false;
  }
  const rootSource = sources.get(ROOT_TASKFILE);
  const agenticSource = sources.get(AGENTIC_AI_TASKFILE);
  const rootInclude: IncludeExpectation = {
    name: 'agentic-ai',
    source: rootSource ?? '',
    taskfile: '.task/agentic-ai.yml',
  };
  const agenticInclude: IncludeExpectation = {
    name: 'executable-skill-host',
    source: agenticSource ?? '',
    taskfile: 'executable-skill-host.yml',
  };
  if (
    typeof rootSource !== 'string' ||
    typeof agenticSource !== 'string' ||
    !hasExactInclude(rootInclude) ||
    !hasExactInclude(agenticInclude)
  ) {
    return false;
  }

  let canonicalIncludeCount = 0;
  let agenticIncludeCount = 0;
  for (const taskSource of taskSources) {
    const document = parseTask(taskSource.source);
    if (document === false) return false;
    const includes = document.includes ?? EMPTY_INCLUDES;
    for (const [includeName, include] of Object.entries(includes)) {
      const target = includeTarget(include);
      if (target === false) continue;
      const resolution: TaskIncludeResolution = {
        importer: taskSource.path,
        target,
      };
      const resolved = resolveTaskInclude(resolution);
      if (resolved === CANONICAL_TASKFILE) canonicalIncludeCount += 1;
      if (resolved === AGENTIC_AI_TASKFILE) agenticIncludeCount += 1;
      if (
        includeName === 'executable-skill-host' &&
        (taskSource.path !== AGENTIC_AI_TASKFILE ||
          resolved !== CANONICAL_TASKFILE)
      ) {
        return false;
      }
    }
    const referenceInspection: ProtectedReferenceInspection = {
      options: {
        allowCanonicalInclude: taskSource.path === AGENTIC_AI_TASKFILE,
      },
      path: [],
      value: parseYaml(taskSource.source),
    };
    if (
      taskSource.path !== CANONICAL_TASKFILE &&
      containsProtectedReference(referenceInspection)
    ) {
      return false;
    }
  }
  return canonicalIncludeCount === 1 && agenticIncludeCount === 1;
}

function hasExactInclude(expectation: IncludeExpectation): boolean {
  const document = parseTask(expectation.source);
  const expectedInclude = {
    taskfile: expectation.taskfile,
    flatten: true,
  };
  return (
    document !== false &&
    isDeepStrictEqual(document.includes?.[expectation.name], expectedInclude)
  );
}

function includeTarget(include: YamlValue): string | false {
  if (typeof include === 'string') return include;
  if (!isYamlRecord(include)) return false;
  return typeof include.taskfile === 'string' ? include.taskfile : false;
}

function resolveTaskInclude(resolution: TaskIncludeResolution): string {
  const importerDirectory = resolution.importer.includes('/')
    ? resolution.importer.slice(0, resolution.importer.lastIndexOf('/'))
    : '';
  const components = `${importerDirectory}/${resolution.target}`.split('/');
  const resolved: string[] = [];
  for (const component of components) {
    if (component === '' || component === '.') continue;
    if (component === '..') resolved.pop();
    else resolved.push(component);
  }
  return resolved.join('/');
}

function containsProtectedReference(
  inspection: ProtectedReferenceInspection,
): boolean {
  const { options, path, value } = inspection;
  if (value === false || typeof value === 'undefined') return false;
  if (typeof value === 'string') {
    const isCanonicalInclude =
      options.allowCanonicalInclude &&
      path.join('.') === 'includes.executable-skill-host.taskfile' &&
      value === 'executable-skill-host.yml';
    return (
      !isCanonicalInclude &&
      PROTECTED_REFERENCES.some((reference) => value.includes(reference))
    );
  }
  if (typeof value === 'boolean' || typeof value === 'number') return false;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const nestedInspection: ProtectedReferenceInspection = {
        options,
        path: [...path, String(index)],
        value: entry,
      };
      if (containsProtectedReference(nestedInspection)) return true;
    }
    return false;
  }
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = [...path, key];
    const isCanonicalIncludeKey =
      options.allowCanonicalInclude &&
      entryPath.join('.') === 'includes.executable-skill-host';
    if (
      !isCanonicalIncludeKey &&
      PROTECTED_REFERENCES.some((reference) => key.includes(reference))
    ) {
      return true;
    }
    const nestedInspection: ProtectedReferenceInspection = {
      options,
      path: entryPath,
      value: entry,
    };
    if (containsProtectedReference(nestedInspection)) return true;
  }
  return false;
}

function parseTask(source: string): TaskDocument | false {
  const value = parseYaml(source);
  return isYamlRecord(value) ? (value as TaskDocument) : false;
}

function parseYaml(source: string): YamlValue | false {
  try {
    return Bun.YAML.parse(source) as YamlValue;
  } catch {
    return false;
  }
}

function isYamlRecord(value: YamlValue | false): value is YamlRecord {
  return (
    value !== false &&
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}
