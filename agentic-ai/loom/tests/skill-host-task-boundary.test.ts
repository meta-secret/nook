import { expect, test } from 'bun:test';
import {
  hasCanonicalToolsListTask,
  hasOnlyCanonicalHostTaskEdge,
  HOST_CLI,
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
  expect(hasOnlyCanonicalHostTaskEdge(CANONICAL_SOURCE)).toBe(true);
  for (const source of [
    CANONICAL_SOURCE.replace('silent: true', 'silent: false'),
    CANONICAL_SOURCE.replace('skills:install', 'loom:install'),
    CANONICAL_SOURCE.replace('cmds:', 'extra: true\n    cmds:'),
    `${CANONICAL_SOURCE}\n# ${TOOLS_LIST_COMMAND}`,
  ]) {
    expect(hasCanonicalToolsListTask(source), source).toBe(false);
  }
});

test('binds the host edge to the originating canonical task', () => {
  for (const reference of [
    HOST_CLI,
    `./${HOST_CLI}`,
    `temporary/../${HOST_CLI}`,
    `../${HOST_CLI}`,
    `temporary/../../${HOST_CLI}`,
    HOST_CLI.replace('/src/cli.ts', '/src/../src/cli.ts'),
  ]) {
    const source = `${CANONICAL_SOURCE}\n  extra:\n    cmds:\n      - bun "${reference}" --default toolsList\n`;
    expect(hasCanonicalToolsListTask(source), reference).toBe(true);
    expect(hasOnlyCanonicalHostTaskEdge(source), reference).toBe(false);
  }
});
