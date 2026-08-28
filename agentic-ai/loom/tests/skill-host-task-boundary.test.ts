import { expect, test } from 'bun:test';
import {
  hasCanonicalToolsListTask,
  TOOLS_LIST_COMMAND,
} from './skill-host-task-boundary.ts';

const CANONICAL_SOURCE = `tasks:
  skills:tools-list:
    desc: List executable skill actions through strict YAML.
    silent: true
    deps: [skills:install]
    cmds:
      - ${TOOLS_LIST_COMMAND}
`;

test('accepts only the exact public tools-list task schema', () => {
  expect(hasCanonicalToolsListTask(CANONICAL_SOURCE)).toBe(true);
  for (const source of [
    CANONICAL_SOURCE.replace('silent: true', 'silent: false'),
    CANONICAL_SOURCE.replace('skills:install', 'loom:install'),
    CANONICAL_SOURCE.replace('cmds:', 'extra: true\n    cmds:'),
    `${CANONICAL_SOURCE}\n# ${TOOLS_LIST_COMMAND}`,
  ]) {
    expect(hasCanonicalToolsListTask(source), source).toBe(false);
  }
});
