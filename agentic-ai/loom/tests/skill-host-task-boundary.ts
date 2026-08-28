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
const TASK_SOURCE_PATH =
  /(?:^|\/)Taskfile(?:\.[^/]*)?\.ya?ml$|^\.task\/.*\.ya?ml$/u;
const TASK_SOURCE_DIGESTS =
  taskSourceDigests(`.task/agentic-ai.yml fc80418b8b6a5e507072bf97ab4be148be12ffa25dee473a204488f01e4ada0e;.task/ai-debug.yml b45b0c71fa32236fc135c7c8ef060ed28711865aadcef7e00e45c2801dc3150e
.task/ci-workflows.yml c346869df9748ee8748f0bab621d65ad1b1b7e7dee3673d34c636336bbca55ce;.task/remote-execution.yml e67aa4c7f3f75d28812729f654bb9ecdb9bf130061c6d327bb592c12e09985a5
Taskfile.yml 747eec65e025d70be608616fada72903c7c5e17d3851178b8c109079ae80fd43;agentic-ai/minds/Taskfile.yml 4ffb2e1afa0dd8244088164cb038ec63a99484cd7a38d65bccd1a8dd4e41c828
agentic-ai/minds/hive/Taskfile.yml 6bc9c933f1d0b1bccfd6f3acb40446514ed5ff5e6ba786e24c6e6cf359a79867;infra/Taskfile.yml 0176b6da6b911f1cc5c1dab693912703e962f90318101f22411d365bd839331c
nook-app/Taskfile.yml a3bd24816fa234f7f54243eb265f7ab40ad89e00d4b436bf41760e785cf18807;nook-app/ci/Taskfile.yml ae10c6ed814e8a40c78364e329c6ba9125eef4f27c978614b77453fcae52e923
nook-app/nook-platform/Taskfile.yml c15c5268a92a1accdcd8ca22975517f6e97ebd802ff8bcb1bc78f1e9bc980951;nook-app/nook-platform/docker/Taskfile.yml 3475b129a827eed736729c3bbd4c188525b6bbecd4e47b3693e7deaea06140dd
nook-app/nook-platform/nook-wasm/Taskfile.yml 61e0135cd3799014b5cbdd471cfaee8a842f1c692458a9b8ac46145902ca6e9d;nook-app/nook-web/Taskfile.yml 4e9621b933f04786d83f729bd3d49607a3a1f4db378cb8aba6d6a30fd948c0ea
nook-app/nook-web/docker/Taskfile.yml e1667ebef8d9cf26a242d5403001cc72fc311243b0e3539a27ae5c073f8040b3;nook-app/nook-web/nook-web-extension/Taskfile.yml cc8aaa8a8608086e00de88c7cbe8f28b88fe5fd54c6013e51f1c473efb2b7be2
preflight/Taskfile.yml 64f2a7a6125209a4207f7e5cd8a16b76c06804aee60ab25be6f0272203359dd9`);

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

export function hasOnlyCanonicalHostTaskEdge(source: BoundarySource): boolean {
  if (typeof source === 'string')
    return isDeepStrictEqual(parseMap(source), EXPECTED_TASK);
  const tasks: TaskSource[] = [...source]
    .filter(([path]) => TASK_SOURCE_PATH.test(path))
    .map(([path, text]) => ({ path, source: text }));
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
    !isDeepStrictEqual(parseMap(canonical), EXPECTED_TASK) ||
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
    const expectedDigest = TASK_SOURCE_DIGESTS.get(task.path);
    if (
      task.path !== CANONICAL_TASKFILE &&
      (typeof expectedDigest !== 'string' ||
        Bun.CryptoHasher.hash('sha256', task.source, 'hex') !== expectedDigest)
    )
      return false;
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

function taskSourceDigests(manifest: string): ReadonlyMap<string, string> {
  const digests = new Map<string, string>();
  for (const row of manifest.split(/[;\n]/u)) {
    const separator = row.indexOf(' ');
    if (separator < 1) throw new Error('Invalid Task source digest manifest.');
    digests.set(row.slice(0, separator), row.slice(separator + 1));
  }
  return digests;
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
