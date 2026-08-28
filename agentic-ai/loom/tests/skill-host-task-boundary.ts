import { isDeepStrictEqual } from 'node:util';
import {
  isSkillYamlMap,
  parseSkillYamlText,
  type UntrustedSkillYamlMap as YamlMap,
  type UntrustedSkillYamlNode as YamlValue,
} from '../../../.cortex/teams/ai/dynamic-skills/executable-skill-host/scripts/src/skill-yaml-codec.ts';

type TaskSource = { readonly path: string; readonly source: string };
type BoundarySource = string | ReadonlyMap<string, string>;
type IncludeRequest = readonly [string, string, string];
type PropertyRequest = readonly [YamlMap, string];
type ProtectedSourceRequest = readonly [string, boolean];

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
export const TASK_YAML_BYTE_LIMIT = 2_097_152;
const [DEPTH_LIMIT, NODE_LIMIT, SCALAR_LIMIT] = [64, 65_536, 16_384];
const AGENTIC_INCLUDE_SOURCE =
  '  executable-skill-host:\n    taskfile: executable-skill-host.yml\n    flatten: true\n';

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
const EXPECTED_TASK = parseMap(CANONICAL_TASK_SOURCE);

export function hasCanonicalToolsListTask(source: string): boolean {
  return isDeepStrictEqual(parseMap(source), EXPECTED_TASK);
}

export function hasOnlyCanonicalHostTaskEdge(source: BoundarySource): boolean {
  if (typeof source === 'string') return hasCanonicalToolsListTask(source);
  const tasks: TaskSource[] = [];
  for (const [path, text] of source) {
    if (
      /(^|\/)Taskfile(?:\.[^/]*)?\.ya?ml$/u.test(path) ||
      /^\.task\/.*\.ya?ml$/u.test(path)
    ) {
      const task: TaskSource = { path, source: text };
      tasks.push(task);
    }
  }
  return hasExactToolsListTaskGraph(tasks);
}

export function hasExactToolsListTaskGraph(
  tasks: readonly TaskSource[],
): boolean {
  const sources = new Map(tasks.map((entry) => [entry.path, entry.source]));
  const canonical = sources.get(CANONICAL_TASKFILE);
  const root = sources.get(ROOT_TASKFILE);
  const agentic = sources.get(AGENTIC_AI_TASKFILE);
  if (
    typeof canonical !== 'string' ||
    typeof root !== 'string' ||
    typeof agentic !== 'string' ||
    !hasCanonicalToolsListTask(canonical) ||
    !includeMatches([root, 'agentic-ai', '.task/agentic-ai.yml']) ||
    !includeMatches([
      agentic,
      'executable-skill-host',
      'executable-skill-host.yml',
    ])
  )
    return false;
  let hostIncludes = 0;
  let agenticIncludes = 0;
  for (const task of tasks) {
    const map = parseMap(task.source);
    if (map === false) return false;
    const includes = property([map, 'includes']);
    if (isSkillYamlMap(includes)) {
      for (const value of Object.values(includes)) {
        const target =
          typeof value === 'string'
            ? value
            : isSkillYamlMap(value)
              ? property([value, 'taskfile'])
              : false;
        if (target === 'executable-skill-host.yml') hostIncludes += 1;
        if (target === '.task/agentic-ai.yml') agenticIncludes += 1;
      }
    }
    if (
      task.path !== CANONICAL_TASKFILE &&
      protectedTaskSource([task.source, task.path === AGENTIC_AI_TASKFILE])
    )
      return false;
  }
  return hostIncludes === 1 && agenticIncludes === 1;
}

function includeMatches([source, name, taskfile]: IncludeRequest): boolean {
  const map = parseMap(source);
  if (map === false) return false;
  const includes = property([map, 'includes']);
  if (!isSkillYamlMap(includes)) return false;
  const expected = { taskfile, flatten: true };
  return isDeepStrictEqual(property([includes, name]), expected);
}

function property([map, key]: PropertyRequest): YamlValue | false {
  for (const [name, value] of Object.entries(map))
    if (name === key) return value;
  return false;
}

function protectedTaskSource([
  source,
  allowInclude,
]: ProtectedSourceRequest): boolean {
  const text = allowInclude
    ? source
        .replace(AGENTIC_INCLUDE_SOURCE, '')
        .replace(
          'executable-skill-host: {taskfile: executable-skill-host.yml, flatten: true}',
          '',
        )
    : source;
  const compact = text.replace(/["'`\\\r\n\t $*?[\]{}()]/gu, '');
  return (
    compact.includes('executable-skill-host') ||
    compact.includes('skills:tools-list') ||
    /execut.ble-skill-hos./u.test(text.replace(/["'`\\\r\n\t ]/gu, '')) ||
    (/(?:^|[^a-z])(?:go-)?task(?:[^a-z]|$)/iu.test(text) &&
      /:\s*skills(?:\s*[,}\n])/u.test(text) &&
      /:\s*tools-list(?:\s*[,}\n])/u.test(text)) ||
    (text.includes('executable-skill-') && /:\s*host(?:\s*[,}\n])/u.test(text))
  );
}

function parseMap(source: string): YamlMap | false {
  if (!sourceWithinBounds(source)) return false;
  const parsed = parseSkillYamlText(source);
  return parsed.ok && isSkillYamlMap(parsed.value) ? parsed.value : false;
}

export function sourceWithinBounds(source: string): boolean {
  if (new TextEncoder().encode(source).byteLength > TASK_YAML_BYTE_LIMIT)
    return false;
  let nodes = 0;
  let blockIndent = -1;
  let blockLength = 0;
  for (const line of source.split('\n')) {
    if (line.length > SCALAR_LIMIT) return false;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trimStart();
    if (blockIndent >= 0 && (trimmed === '' || indent > blockIndent)) {
      blockLength += Math.max(1, line.length - indent);
      if (blockLength > SCALAR_LIMIT) return false;
      continue;
    }
    blockIndent = -1;
    blockLength = 0;
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const syntax = trimmed.replace(/\s+#.*$/u, '');
    let flow = 0;
    for (const character of syntax) {
      if (character === '[' || character === '{') flow += 1;
      if ((character === ']' || character === '}') && flow > 0) flow -= 1;
      if (/[:,[\]{},]/u.test(character)) nodes += 1;
      if (flow > DEPTH_LIMIT) return false;
    }
    nodes += 1;
    if (indent + flow > DEPTH_LIMIT || nodes > NODE_LIMIT) return false;
    if (/(?:^|:|-\s)\s*[>|][+-]?\d?\s*$/u.test(syntax)) blockIndent = indent;
  }
  return true;
}
