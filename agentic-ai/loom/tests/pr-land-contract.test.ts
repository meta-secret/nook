import { describe, expect, test } from 'bun:test';

import { PR_LAND_VALIDATE_NEXT_STEP } from '../src/commands/pr-land.ts';

describe('prLand validation continuation', () => {
  test('returns hosted checks to the manager', () => {
    expect(PR_LAND_VALIDATE_NEXT_STEP).toContain(
      'watch repository-owned checks',
    );
    expect(PR_LAND_VALIDATE_NEXT_STEP).toContain(
      'return the resulting evidence',
    );
  });
});
