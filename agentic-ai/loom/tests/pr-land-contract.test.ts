import { describe, expect, test } from 'bun:test';

import {
  PR_LAND_CODEX_REVIEW_ARG,
  PR_LAND_VALIDATE_NEXT_STEP,
} from '../src/commands/pr-land.ts';

describe('prLand validation continuation', () => {
  test('requires hosted checks and an opted-in final-head review before readiness', () => {
    expect(PR_LAND_CODEX_REVIEW_ARG).toBe('CODEX_REVIEW=1');
    expect(PR_LAND_VALIDATE_NEXT_STEP).toContain(
      'watch repository-owned checks and collect the opted-in exact-head review concurrently',
    );
    expect(PR_LAND_VALIDATE_NEXT_STEP).toContain(
      'after both settle, run a prLand.ready request',
    );
  });
});
