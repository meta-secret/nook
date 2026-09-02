import { expect, test } from 'bun:test';
import { parsePlaywrightSummary } from '../src/lib/agent-stats-assemble.ts';

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
