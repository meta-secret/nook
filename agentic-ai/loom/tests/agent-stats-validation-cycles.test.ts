import { describe, expect, test } from 'bun:test';
import { sealUntrustedYamlMap } from '../src/lib/guards.ts';
import { validationRetriggerCount } from '../src/lib/agent-stats-validation-cycles.ts';

describe('validation retriggers', () => {
  test('does not count parallel required workflows as retriggers', () => {
    const prCycleRecord = { workflow: 'PR' };
    const researchCycleRecord = { workflow: 'Web research' };
    const cycles = [
      sealUntrustedYamlMap(prCycleRecord),
      sealUntrustedYamlMap(researchCycleRecord),
    ];

    expect(validationRetriggerCount(cycles)).toBe(0);
  });

  test('counts only repeated attempts within each workflow', () => {
    const firstPrCycleRecord = { workflow: 'PR' };
    const secondPrCycleRecord = { workflow: 'PR' };
    const researchCycleRecord = { workflow: 'Web research' };
    const cycles = [
      sealUntrustedYamlMap(firstPrCycleRecord),
      sealUntrustedYamlMap(secondPrCycleRecord),
      sealUntrustedYamlMap(researchCycleRecord),
    ];

    expect(validationRetriggerCount(cycles)).toBe(1);
  });
});
