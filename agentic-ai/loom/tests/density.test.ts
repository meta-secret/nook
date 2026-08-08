import { describe, expect, test } from 'bun:test';
import { lintProseDensity } from '../src/lib/density.ts';

import type { LintProseDensityArgs } from '../src/lib/density.ts';
describe('lintProseDensity', () => {
  test('flags dense sentences', () => {
    const long =
      'This sentence keeps adding clauses and constraints and failure modes and commands until it becomes too dense for a single pass reader who also needs to remember actors and extras.';
    const findingsArgs: LintProseDensityArgs = {
      filePath: 'demo.md',
      content: long,
    };
    const findings = lintProseDensity(findingsArgs);
    expect(findings.length).toBeGreaterThan(0);
    const reasons = findings.map((item) => item.reason).join(' ');
    expect(reasons.includes('and') || reasons.includes('longer')).toBe(true);
  });

  test('ignores fenced code blocks', () => {
    const content = [
      '```bash',
      'echo one and two and three and four and five and six and seven and eight and nine and ten and eleven',
      '```',
    ].join('\n');
    const lintProseDensityArgs: LintProseDensityArgs = {
      filePath: 'demo.md',
      content,
    };
    expect(lintProseDensity(lintProseDensityArgs)).toEqual([]);
  });
});
