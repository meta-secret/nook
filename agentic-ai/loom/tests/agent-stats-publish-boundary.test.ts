import { describe, expect, test } from 'bun:test';
import {
  GitHubPullRequestState,
  assertMergedAgentStatsSourcePr,
} from '../src/commands/agent-stats.ts';

const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567';
const MERGE_SHA = '89abcdef0123456789abcdef0123456789abcdef';
const EXPECTED = { headSha: HEAD_SHA, mergeSha: MERGE_SHA } as const;
const MERGED_ERROR = 'currently merged source PR';
const LIVE = {
  state: GitHubPullRequestState.Merged,
  mergedAt: '2026-09-02T11:00:00Z',
  headRefOid: HEAD_SHA,
  mergeCommit: { oid: MERGE_SHA },
} as const;

describe('agent statistics publication boundary', () => {
  test('accepts only matching merged source PR identity', () => {
    expect(() =>
      assertMergedAgentStatsSourcePr(JSON.stringify(LIVE), EXPECTED),
    ).not.toThrow();

    for (const [evidence, message, expected] of [
      [{ ...LIVE, state: 'OPEN' }, MERGED_ERROR, EXPECTED],
      [{ ...LIVE, mergedAt: 'bad' }, MERGED_ERROR, EXPECTED],
      [
        LIVE,
        'source PR commit identity',
        { headSha: '1'.repeat(40), mergeSha: MERGE_SHA },
      ],
      [
        LIVE,
        'source PR commit identity',
        { headSha: HEAD_SHA, mergeSha: '2'.repeat(40) },
      ],
      [{ ...LIVE, fallback: true }, 'invalid field set', EXPECTED],
    ] as const) {
      expect(() =>
        assertMergedAgentStatsSourcePr(JSON.stringify(evidence), expected),
      ).toThrow(message);
    }
    expect(() => assertMergedAgentStatsSourcePr('not-json', EXPECTED)).toThrow(
      'Failed to parse source PR merge state',
    );
  });
});
