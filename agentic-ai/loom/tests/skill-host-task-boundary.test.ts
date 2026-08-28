import { expect, test } from 'bun:test';
import {
  CANONICAL_TASKFILE,
  CANONICAL_TASK_SOURCE,
  hasExactToolsListTaskGraph,
  TASK_YAML_BYTE_LIMIT,
} from './skill-host-task-boundary.ts';
type Source = { readonly path: string; readonly source: string };
const REPOSITORY_ROOT = `${import.meta.dir}/../../..`;
const ROOT_SOURCE = await Bun.file(`${REPOSITORY_ROOT}/Taskfile.yml`).text();
const AGENTIC_SOURCE = await Bun.file(
  `${REPOSITORY_ROOT}/.task/agentic-ai.yml`,
).text();
function graph(provided?: readonly Source[]): readonly Source[] {
  return [
    { path: 'Taskfile.yml', source: ROOT_SOURCE },
    { path: '.task/agentic-ai.yml', source: AGENTIC_SOURCE },
    { path: CANONICAL_TASKFILE, source: CANONICAL_TASK_SOURCE },
    ...(provided ?? []),
  ];
}
function bad([path, source]: readonly [string, string]): void {
  expect(hasExactToolsListTaskGraph(graph([{ path, source }]))).toBe(false);
}
test('requires one exact flattened include chain', () => {
  expect(hasExactToolsListTaskGraph(graph())).toBe(true);
  bad([CANONICAL_TASKFILE, CANONICAL_TASK_SOURCE.replace('true', 'false')]);
  bad([
    '.task/agentic-ai.yml',
    AGENTIC_SOURCE.replace('flatten: true', 'flatten: false'),
  ]);
  bad([
    '.task/nested/alternate.yml',
    'includes: {executable-skill-host: {taskfile: executable-skill-host.yml, flatten: true}}',
  ]);
  bad([
    '.task/nested/alternate.yml',
    'includes:\n  executable-skill-host: {}\n  executable-skill-host: {}\n',
  ]);
});
test('rejects strict YAML hazards before conversion', () => {
  const hazards = [
    'safe: |\n  ' + 'x'.repeat(16_385),
    '#'.repeat(TASK_YAML_BYTE_LIMIT + 1),
  ];
  for (const [index, source] of hazards.entries())
    bad([`.task/hazard-${index}.yml`, source]);
});
