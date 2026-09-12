import { describe, expect, test } from 'bun:test';
import { UntrustedYamlBoundary } from '../src/lib/guards.ts';
import { ValidationCycleHistory } from '../src/lib/agent-stats-validation-cycles.ts';

describe('validation retriggers', () => {
  test('does not count parallel required workflows as retriggers', () => {
    const prCycleRecord = { workflow: 'PR' };
    const researchCycleRecord = { workflow: 'Web research' };
    const cycles = [
      UntrustedYamlBoundary.seal(prCycleRecord),
      UntrustedYamlBoundary.seal(researchCycleRecord),
    ];

    expect(ValidationCycleHistory.countRetriggers(cycles)).toBe(0);
  });

  test('counts only repeated attempts within each workflow', () => {
    const firstPrCycleRecord = { workflow: 'PR' };
    const secondPrCycleRecord = { workflow: 'PR' };
    const researchCycleRecord = { workflow: 'Web research' };
    const cycles = [
      UntrustedYamlBoundary.seal(firstPrCycleRecord),
      UntrustedYamlBoundary.seal(secondPrCycleRecord),
      UntrustedYamlBoundary.seal(researchCycleRecord),
    ];

    expect(ValidationCycleHistory.countRetriggers(cycles)).toBe(1);
  });
});
