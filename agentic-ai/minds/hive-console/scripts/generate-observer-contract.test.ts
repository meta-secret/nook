import { describe, expect, test } from 'bun:test';
import { ObserverValidatorSource } from './generate-observer-contract';

describe('ObserverValidatorSource', () => {
  test('renders validator absence without nullish tokens', () => {
    const generated = new ObserverValidatorSource(
      'let errors = null; value === undefined; errors === null;',
    ).withoutImplicitAbsence();

    expect(generated).toBe(
      'let errors = void 0; value === void 0; errors === void 0;',
    );
    expect(generated).not.toMatch(/\b(?:null|undefined)\b/);
  });
});
