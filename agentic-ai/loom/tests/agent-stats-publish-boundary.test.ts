import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  GitHubPullRequestState,
  assertMergedAgentStatsSourcePr,
} from '../src/commands/agent-stats.ts';

const REPO_ROOT = join(import.meta.dir, '../../..');

describe('agent statistics publication boundary', () => {
  test('accepts only typed merged source PR evidence', () => {
    expect(() =>
      assertMergedAgentStatsSourcePr(
        JSON.stringify({
          state: GitHubPullRequestState.Merged,
          mergedAt: '2026-09-02T11:00:00Z',
        }),
      ),
    ).not.toThrow();

    for (const evidence of [
      { state: 'OPEN', mergedAt: '' },
      { state: GitHubPullRequestState.Merged, mergedAt: '' },
      { state: GitHubPullRequestState.Merged, mergedAt: 'not-a-timestamp' },
      { state: GitHubPullRequestState.Merged },
    ]) {
      expect(() =>
        assertMergedAgentStatsSourcePr(JSON.stringify(evidence)),
      ).toThrow(
        'AI-agent stats publication requires a currently merged source PR',
      );
    }
    expect(() => assertMergedAgentStatsSourcePr('not-json')).toThrow(
      'Failed to parse source PR merge state',
    );
    expect(() =>
      assertMergedAgentStatsSourcePr(
        JSON.stringify({
          state: GitHubPullRequestState.Merged,
          mergedAt: '2026-09-02T11:00:00Z',
          fallback: true,
        }),
      ),
    ).toThrow('must contain exactly state and mergedAt');
  });

  test('checks live merge state before the immutable Workbench write', async () => {
    const source = await readFile(
      join(REPO_ROOT, 'agentic-ai/loom/src/commands/agent-stats.ts'),
      'utf8',
    );
    const mergeCheck = source.indexOf(
      'verifyMergedAgentStatsSourcePr({ repoRoot, prNumber });',
    );
    const immutableWrite = source.indexOf("command: 'node'", mergeCheck);

    expect(mergeCheck).toBeGreaterThan(-1);
    expect(immutableWrite).toBeGreaterThan(mergeCheck);
  });
});
