import { expect, test } from 'bun:test';
import { parsePlaywrightSummary } from '../src/lib/agent-stats-assemble.ts';
const inventoryTransform = require('../playwright-inventory-transform.cjs');

// prettier-ignore
test('Playwright inventory summaries are exact and unambiguous', () => {
  for (const [summary, total] of [['Total: 239 tests in 70 files', 239], ['Total: 1 test in 1 file', 1], ['', -1], ['Total: broken', -1], ['Total: 1 test in 1 file\nTotal: 2 tests in 2 files', -1]] as const)
    expect(parsePlaywrightSummary(summary)).toBe(total);
});

// prettier-ignore
test('normalizes extension identity arrows after a trailing parameter is injected', () => {
  const identifier = { type: 'Identifier', name: 'v' };
  const assignment = { type: 'AssignmentPattern', left: identifier, right: { type: 'StringLiteral', value: 'fallback' } };
  const trailing = { type: 'Identifier', name: '__injected' };
  const rest = { type: 'RestElement', argument: { type: 'ArrayPattern', elements: [assignment] } };
  const node = { params: [rest] as Array<typeof rest | typeof trailing>, body: identifier };
  const visitor = inventoryTransform().visitor.ArrowFunctionExpression;
  expect(visitor.enter).toBeUndefined();
  node.params.push(trailing);
  visitor.exit({ node });
  expect(node.params).toEqual([assignment, trailing]);
});
