import { expect, test } from 'bun:test';
import { parsePlaywrightSummary } from '../src/lib/agent-stats-assemble.ts';
const inventoryTransform = require('../playwright-inventory-transform.cjs');

test('Playwright inventory summaries are exact and unambiguous', () => {
  expect(parsePlaywrightSummary('Total: 239 tests in 70 files')).toBe(239);
  expect(parsePlaywrightSummary('Total: 1 test in 1 file')).toBe(1);
  for (const invalid of [
    '',
    'Total: broken',
    'Total: 1 test in 1 file\nTotal: 2 tests in 2 files',
  ])
    expect(parsePlaywrightSummary(invalid)).toBe(-1);
});

// prettier-ignore
test('normalizes extension identity arrows after a trailing parameter is injected', () => {
  const identifier = { type: 'Identifier', name: 'v' };
  const assignment = { type: 'AssignmentPattern', left: identifier, right: { type: 'StringLiteral', value: 'fallback' } };
  const trailing = { type: 'Identifier', name: '__injected' };
  const node = {
    params: [{ type: 'RestElement', argument: { type: 'ArrayPattern', elements: [assignment] } }, trailing],
    body: identifier,
  };
  inventoryTransform().visitor.ArrowFunctionExpression({ node });
  expect(node.params).toEqual([assignment, trailing]);
});
