import { describe, expect, test } from 'bun:test';
import { asUntrustedYamlNode } from '../src/lib/guards.ts';
import {
  buildActionsEvidence,
  buildReviewEvidence,
  type BuildActionsEvidenceRequest,
  type BuildReviewEvidenceRequest,
} from '../src/lib/agent-stats-github.ts';

import type { UntrustedYamlNode } from '../src/lib/guards.ts';

const firstHead = '1111111111111111111111111111111111111111';
const finalHead = '2222222222222222222222222222222222222222';

describe('agent stats GitHub evidence', () => {
  test('groups validation by head and measures work after supersession', () => {
    const firstRun: ActionRunFixture = {
      id: 101,
      runAttempt: 1,
      headSha: firstHead,
      startedAt: '2026-08-01T10:00:00Z',
      finishedAt: '2026-08-01T10:10:00Z',
      conclusion: 'success',
    };
    const obsoleteRun: ActionRunFixture = {
      id: 102,
      runAttempt: 1,
      headSha: firstHead,
      startedAt: '2026-08-01T10:12:00Z',
      finishedAt: '2026-08-01T10:30:00Z',
      conclusion: 'cancelled',
    };
    const finalRun: ActionRunFixture = {
      id: 103,
      runAttempt: 1,
      headSha: finalHead,
      startedAt: '2026-08-01T10:20:00Z',
      finishedAt: '2026-08-01T10:25:00Z',
      conclusion: 'success',
    };
    const lateOldHeadRerun: ActionRunFixture = {
      id: 102,
      runAttempt: 2,
      headSha: firstHead,
      startedAt: '2026-08-01T10:31:00Z',
      finishedAt: '2026-08-01T10:32:00Z',
      conclusion: 'failure',
    };
    const pages = asUntrustedYamlNode([
      {
        id: 10,
        total_count: 3,
        workflow_runs: [
          actionRun(firstRun),
          actionRun(obsoleteRun),
          actionRun(finalRun),
          actionRun(lateOldHeadRerun),
        ],
      },
    ]);
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
    };
    const evidence = buildActionsEvidence(request);

    expect(evidence.runs).toHaveLength(4);
    expect(evidence.heads).toHaveLength(2);
    expect(evidence.validationCycles).toHaveLength(4);
    expect(evidence.obsoleteValidationSeconds).toBe(660);
    expect(evidence.obsoleteValidationCount).toBe(2);
    expect(evidence.cancelledValidationSeconds).toBe(1080);
    expect(evidence.cancelledValidationCount).toBe(1);
  });

  test('ignores a same-branch run associated with another PR', () => {
    const pages = asUntrustedYamlNode([
      {
        total_count: 2,
        workflow_runs: [
          actionRun({
            id: 101,
            runAttempt: 1,
            headSha: finalHead,
            startedAt: '2026-08-01T10:00:00Z',
            finishedAt: '2026-08-01T10:01:00Z',
            conclusion: 'success',
          }),
          actionRun({
            id: 102,
            runAttempt: 1,
            headSha: firstHead,
            startedAt: '2026-08-01T10:00:00Z',
            finishedAt: '2026-08-01T10:01:00Z',
            conclusion: 'success',
            sourcePr: 99,
          }),
        ],
      },
    ]);
    const evidence = buildActionsEvidence({
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
    });
    expect(evidence.runs).toHaveLength(1);
  });

  test('rejects nonterminal action attempts', () => {
    const pages = asUntrustedYamlNode([
      {
        total_count: 1,
        workflow_runs: [
          actionRun({
            id: 101,
            runAttempt: 1,
            headSha: finalHead,
            startedAt: '2026-08-01T10:00:00Z',
            finishedAt: '2026-08-01T10:01:00Z',
            conclusion: 'success',
            status: 'in_progress',
          }),
        ],
      },
    ]);
    expect(() =>
      buildActionsEvidence({ pages, prNumber: 42, finalHeadSha: finalHead }),
    ).toThrow('retry collection after completion');
  });

  test('pairs review requests and outcomes with exact delivery heads', () => {
    const issueCommentPages = yamlPages([
      {
        id: 10,
        body: `<!-- nook-codex-review:${firstHead.slice(0, 12)} -->`,
        created_at: '2026-08-01T09:00:00Z',
        author_association: 'NONE',
        user: { login: 'untrusted-user' },
      },
      {
        id: 11,
        body: `<!-- nook-codex-review:${firstHead.slice(0, 12)} -->`,
        created_at: '2026-08-01T10:00:00Z',
        author_association: 'MEMBER',
        user: { login: 'github-actions[bot]' },
      },
      {
        id: 12,
        body: `<!-- nook-codex-review:${finalHead.slice(0, 12)} -->`,
        created_at: '2026-08-01T10:20:00Z',
        author_association: 'MEMBER',
        user: { login: 'github-actions[bot]' },
      },
    ]);
    const reviewPages = yamlPages([
      {
        id: 501,
        body: '',
        commit_id: firstHead,
        submitted_at: '2026-08-01T10:05:00Z',
        user: { login: 'chatgpt-codex-connector[bot]' },
      },
    ]);
    const reviewCommentPages = yamlPages([
      {
        pull_request_review_id: 501,
        user: { login: 'chatgpt-codex-connector[bot]' },
      },
      {
        pull_request_review_id: 501,
        user: { login: 'chatgpt-codex-connector[bot]' },
      },
      {
        pull_request_review_id: 501,
        in_reply_to_id: 700,
        user: { login: 'chatgpt-codex-connector[bot]' },
      },
    ]);
    const reviewReactionPages = yamlPages([
      {
        request_comment_id: 12,
        content: '+1',
        created_at: '2026-08-01T10:23:00Z',
        user: { login: 'chatgpt-codex-connector[bot]' },
      },
    ]);
    const request: BuildReviewEvidenceRequest = {
      issueCommentPages,
      reviewPages,
      reviewCommentPages,
      reviewReactionPages,
      knownHeadShas: [firstHead, finalHead],
    };
    const evidence = buildReviewEvidence(request);

    expect(evidence.events).toHaveLength(2);
    expect(evidence.requestCount).toBe(2);
    expect(evidence.findingBatchCount).toBe(1);
    expect(evidence.findingCount).toBe(2);
    expect(evidence.events[0]?.latency_seconds).toBe(300);
    expect(evidence.events[1]?.outcome).toBe('clean');
    expect(evidence.events[1]?.latency_seconds).toBe(180);
  });
});

type ActionRunFixture = {
  readonly id: number;
  readonly runAttempt: number;
  readonly headSha: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly conclusion: string;
  readonly sourcePr?: number;
  readonly status?: string;
};

function actionRun(fixture: ActionRunFixture): UntrustedYamlNode {
  return {
    id: fixture.id,
    name: 'PR',
    run_attempt: fixture.runAttempt,
    head_sha: fixture.headSha,
    event: 'pull_request',
    created_at: fixture.startedAt,
    run_started_at: fixture.startedAt,
    updated_at: fixture.finishedAt,
    conclusion: fixture.conclusion,
    status: fixture.status ?? 'completed',
    pull_requests: [{ number: fixture.sourcePr ?? 42 }],
  };
}

function yamlPages(items: readonly UntrustedYamlNode[]): UntrustedYamlNode {
  return asUntrustedYamlNode([items]);
}
