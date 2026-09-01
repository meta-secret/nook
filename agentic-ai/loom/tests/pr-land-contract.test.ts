import { describe, expect, test } from 'bun:test';

import { PR_LAND_VALIDATE_NEXT_STEP } from '../src/commands/pr-land.ts';

describe('prLand validation continuation', () => {
  test('requires hosted checks and concurrent review before readiness', () => {
    expect(PR_LAND_VALIDATE_NEXT_STEP).toContain(
      'watch repository-owned checks and collect or stabilize exact-head review concurrently',
    );
    expect(PR_LAND_VALIDATE_NEXT_STEP).toContain(
      'after both settle, run a prLand.ready request',
    );
  });
});
