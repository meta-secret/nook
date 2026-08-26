import { describe, expect, test } from 'bun:test';
import {
  asUntrustedYamlNode,
  sealUntrustedYamlMap,
} from '../src/lib/guards.ts';
import {
  buildActionsEvidence,
  buildReviewEvidence,
  type BuildActionsEvidenceRequest,
  type BuildReviewEvidenceRequest,
} from '../src/lib/agent-stats-github.ts';
import { mergeReviewedDeliveryHeads } from '../src/lib/agent-stats-github-delivery.ts';
import {
  actionJobsRequestedValidation,
  type ActionJobsRequestedValidationRequest,
} from '../src/lib/agent-stats-github-api.ts';
import { substantiveReviewBodyFindingCount } from '../src/lib/agent-stats-github-review.ts';

import type { UntrustedYamlNode } from '../src/lib/guards.ts';

const firstHead = '1111111111111111111111111111111111111111';
const finalHead = '2222222222222222222222222222222222222222';
const thirdHead = '3333333333333333333333333333333333333333';

describe('agent stats GitHub evidence', () => {
  test('requires a non-skipped job beyond the validation gate', () => {
    const skippedRequest: ActionJobsRequestedValidationRequest = {
      gateJobName: 'Validate explicit CI request',
      jobs: [
        { name: 'Validate explicit CI request', conclusion: 'failure' },
        { name: 'Native Rust verification', conclusion: 'skipped' },
      ],
    };
    const requestedRequest: ActionJobsRequestedValidationRequest = {
      gateJobName: 'Validate explicit ecosystem request',
      jobs: [
        { name: 'Validate explicit ecosystem request', conclusion: 'success' },
        { name: 'Clippy', conclusion: 'failure' },
      ],
    };
    const cancelledRequest: ActionJobsRequestedValidationRequest = {
      gateJobName: 'Validate explicit CI request',
      jobs: [
        {
          name: 'Validate explicit CI request',
          conclusion: 'cancelled',
          steps: [
            {
              name: 'Reject unsupported label events',
              conclusion: 'success',
            },
          ],
        },
        { name: 'Native Rust verification', conclusion: 'skipped' },
      ],
    };
    const unsupportedCancelledRequest: ActionJobsRequestedValidationRequest = {
      gateJobName: 'Validate explicit CI request',
      jobs: [
        {
          name: 'Validate explicit CI request',
          conclusion: 'cancelled',
          steps: [
            {
              name: 'Reject unsupported label events',
              conclusion: 'cancelled',
            },
          ],
        },
        { name: 'Native Rust verification', conclusion: 'skipped' },
      ],
    };
    const supportedThenFailedRequest: ActionJobsRequestedValidationRequest = {
      gateJobName: 'Validate explicit ecosystem request',
      jobs: [
        {
          name: 'Validate explicit ecosystem request',
          conclusion: 'failure',
          steps: [
            {
              name: 'Reject unsupported label events',
              conclusion: 'success',
            },
            {
              name: 'Keep mixed PRs in the product workflow',
              conclusion: 'failure',
            },
          ],
        },
        { name: 'Rust ecosystem', conclusion: 'skipped' },
      ],
    };

    expect(actionJobsRequestedValidation(skippedRequest)).toBe(false);
    expect(actionJobsRequestedValidation(requestedRequest)).toBe(true);
    expect(actionJobsRequestedValidation(cancelledRequest)).toBe(true);
    expect(actionJobsRequestedValidation(unsupportedCancelledRequest)).toBe(
      false,
    );
    expect(actionJobsRequestedValidation(supportedThenFailedRequest)).toBe(
      true,
    );
  });

  test('counts findings in noncanonical details blocks', () => {
    const reviewBody = `### 💡 Codex Review

Here are some automated review suggestions for this pull request.

**Reviewed commit:** \`1234567890\`

<details><summary>Additional finding</summary>Do not discard this.</details>`;

    expect(substantiveReviewBodyFindingCount(reviewBody)).toBe(1);
  });

  test('counts text inserted into an otherwise status-only review', () => {
    const reviewBody = `### 💡 Codex Review

Here are some automated review suggestions for this pull request.

Preserve this actionable text.

**Reviewed commit:** \`1234567890\``;

    expect(substantiveReviewBodyFindingCount(reviewBody)).toBe(1);
  });

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
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [],
      deliveryHeadOrder: [firstHead, finalHead],
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

  test('uses delivery order when head timestamps tie', () => {
    const sharedTimestamp = '2026-08-01T10:00:00Z';
    const pages = actionPages([
      {
        id: 102,
        runAttempt: 1,
        headSha: finalHead,
        startedAt: sharedTimestamp,
        finishedAt: '2026-08-01T10:02:00Z',
        conclusion: 'success',
      },
      {
        id: 101,
        runAttempt: 1,
        headSha: firstHead,
        startedAt: sharedTimestamp,
        finishedAt: '2026-08-01T10:10:00Z',
        conclusion: 'success',
      },
    ]);
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [],
      deliveryHeadOrder: [firstHead, finalHead],
    };
    const evidence = buildActionsEvidence(request);

    expect(evidence.heads.map((head) => head.head_sha)).toEqual([
      firstHead,
      finalHead,
    ]);
    expect(evidence.obsoleteValidationSeconds).toBe(600);
  });

  test('uses delivery order when an ancestor is observed after its successor', () => {
    const pages = actionPages([
      {
        id: 105,
        runAttempt: 1,
        headSha: firstHead,
        startedAt: '2026-08-01T10:30:00Z',
        finishedAt: '2026-08-01T10:32:00Z',
        conclusion: 'failure',
      },
    ]);
    const successorReviewEvent = {
      head_sha: finalHead,
      requested_at: '2026-08-01T10:20:00Z',
      completed_at: '',
    };
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [sealUntrustedYamlMap(successorReviewEvent)],
      deliveryHeadOrder: [firstHead, finalHead],
    };
    const evidence = buildActionsEvidence(request);

    expect(evidence.heads.map((head) => head.head_sha)).toEqual([
      firstHead,
      finalHead,
    ]);
    expect(evidence.obsoleteValidationSeconds).toBe(120);
  });

  test('uses the earliest observed descendant as the supersession boundary', () => {
    const pages = actionPages([
      {
        id: 107,
        runAttempt: 1,
        headSha: firstHead,
        startedAt: '2026-08-01T10:00:00Z',
        finishedAt: '2026-08-01T10:40:00Z',
        conclusion: 'success',
      },
      {
        id: 108,
        runAttempt: 1,
        headSha: finalHead,
        startedAt: '2026-08-01T10:30:00Z',
        finishedAt: '2026-08-01T10:31:00Z',
        conclusion: 'success',
      },
    ]);
    const descendantReviewEvent = {
      head_sha: thirdHead,
      requested_at: '2026-08-01T10:20:00Z',
      completed_at: '',
    };
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: thirdHead,
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [sealUntrustedYamlMap(descendantReviewEvent)],
      deliveryHeadOrder: [firstHead, finalHead, thirdHead],
    };
    const evidence = buildActionsEvidence(request);
    const firstCycle = evidence.validationCycles.find(
      (cycle) => cycle.head_sha === firstHead,
    );

    expect(firstCycle?.obsolete_seconds).toBe(1200);
  });

  test('keeps unsupported-label runs out of validation cycles', () => {
    const pages = actionPages([
      {
        id: 104,
        runAttempt: 1,
        headSha: finalHead,
        startedAt: '2026-08-01T10:00:00Z',
        finishedAt: '2026-08-01T10:00:10Z',
        conclusion: 'failure',
        validationRequested: false,
      },
    ]);
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [],
      deliveryHeadOrder: [finalHead],
    };
    const evidence = buildActionsEvidence(request);

    expect(evidence.runs).toHaveLength(1);
    expect(evidence.validationCycles).toHaveLength(0);
  });

  test('ignores a same-branch run associated with another PR', () => {
    const sourceRun: ActionRunFixture = {
      id: 101,
      runAttempt: 1,
      headSha: finalHead,
      startedAt: '2026-08-01T10:00:00Z',
      finishedAt: '2026-08-01T10:01:00Z',
      conclusion: 'success',
    };
    const foreignRun: ActionRunFixture = {
      id: 102,
      runAttempt: 1,
      headSha: firstHead,
      startedAt: '2026-08-01T10:00:00Z',
      finishedAt: '2026-08-01T10:01:00Z',
      conclusion: 'success',
      sourcePr: 99,
    };
    const pages = asUntrustedYamlNode([
      {
        total_count: 2,
        workflow_runs: [actionRun(sourceRun), actionRun(foreignRun)],
      },
    ]);
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [],
      deliveryHeadOrder: [firstHead, finalHead],
    };
    const evidence = buildActionsEvidence(request);
    expect(evidence.runs).toHaveLength(1);
  });

  test('retains branch-scoped runs whose PR association was cleared', () => {
    const pages = actionPages([
      {
        id: 106,
        runAttempt: 1,
        headSha: finalHead,
        startedAt: '2026-08-01T10:00:00Z',
        finishedAt: '2026-08-01T10:01:00Z',
        conclusion: 'success',
        sourcePr: false,
      },
    ]);
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [],
      deliveryHeadOrder: [finalHead],
    };
    const evidence = buildActionsEvidence(request);

    expect(evidence.runs).toHaveLength(1);
    expect(evidence.runs[0]?.source_pr).toBe(42);
  });

  test('allows a final head with no applicable Actions workflow', () => {
    const pages = asUntrustedYamlNode([{ total_count: 0, workflow_runs: [] }]);
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [],
      deliveryHeadOrder: [finalHead],
    };
    const evidence = buildActionsEvidence(request);

    expect(evidence.runs).toHaveLength(0);
    expect(evidence.heads).toHaveLength(1);
    expect(evidence.heads[0]?.head_sha).toBe(finalHead);
    expect(evidence.heads[0]?.first_observed_at).toBe('');
    expect(evidence.validationCycles).toHaveLength(0);
  });

  test('counts every repository validation workflow', () => {
    const rustRun: ActionRunFixture = {
      id: 201,
      runAttempt: 1,
      headSha: firstHead,
      startedAt: '2026-08-01T10:00:00Z',
      finishedAt: '2026-08-01T10:01:00Z',
      conclusion: 'success',
      workflow: 'Rust ecosystem checks',
    };
    const researchRun: ActionRunFixture = {
      id: 202,
      runAttempt: 1,
      headSha: finalHead,
      startedAt: '2026-08-01T10:02:00Z',
      finishedAt: '2026-08-01T10:03:00Z',
      conclusion: 'success',
      workflow: 'Web research',
    };
    const pages = asUntrustedYamlNode([
      {
        total_count: 2,
        workflow_runs: [actionRun(rustRun), actionRun(researchRun)],
      },
    ]);
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [],
      deliveryHeadOrder: [firstHead, finalHead],
    };
    const evidence = buildActionsEvidence(request);

    expect(evidence.validationCycles).toHaveLength(2);
    expect(evidence.validationCycles.map((cycle) => cycle.workflow)).toEqual([
      'Rust ecosystem checks',
      'Web research',
    ]);
  });

  test('keeps manual runs out of validation cycles', () => {
    const pages = actionPages([
      {
        id: 203,
        runAttempt: 1,
        headSha: finalHead,
        startedAt: '2026-08-01T10:02:00Z',
        finishedAt: '2026-08-01T10:03:00Z',
        conclusion: 'success',
        workflow: 'Web research',
        trigger: 'workflow_dispatch',
      },
    ]);
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [],
      deliveryHeadOrder: [finalHead],
    };
    const evidence = buildActionsEvidence(request);

    expect(evidence.runs).toHaveLength(1);
    expect(evidence.validationCycles).toHaveLength(0);
  });

  test('excludes workflow attempts started after merge', () => {
    const deliveredRun: ActionRunFixture = {
      id: 301,
      runAttempt: 1,
      headSha: finalHead,
      startedAt: '2026-08-01T10:00:00Z',
      finishedAt: '2026-08-01T10:01:00Z',
      conclusion: 'success',
    };
    const postMergeRerun: ActionRunFixture = {
      id: 301,
      runAttempt: 2,
      headSha: finalHead,
      startedAt: '2026-08-01T10:06:00Z',
      finishedAt: '2026-08-01T10:07:00Z',
      conclusion: 'success',
      status: 'in_progress',
    };
    const pages = asUntrustedYamlNode([
      {
        total_count: 1,
        workflow_runs: [actionRun(deliveredRun), actionRun(postMergeRerun)],
      },
    ]);
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T10:05:00Z',
      reviewEvents: [],
      deliveryHeadOrder: [finalHead],
    };
    const evidence = buildActionsEvidence(request);

    expect(evidence.runs).toHaveLength(1);
    expect(evidence.validationCycles).toHaveLength(1);
  });

  test('includes queued time in action duration', () => {
    const queuedRun: ActionRunFixture = {
      id: 401,
      runAttempt: 1,
      headSha: finalHead,
      createdAt: '2026-08-01T09:55:00Z',
      startedAt: '2026-08-01T10:06:00Z',
      finishedAt: '2026-08-01T10:07:00Z',
      conclusion: 'success',
    };
    const pages = asUntrustedYamlNode([
      { total_count: 1, workflow_runs: [actionRun(queuedRun)] },
    ]);
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T10:05:00Z',
      reviewEvents: [],
      deliveryHeadOrder: [finalHead],
    };
    const evidence = buildActionsEvidence(request);

    expect(evidence.runs[0]?.duration_seconds).toBe(720);
  });

  test('uses review-only heads to supersede running validation', () => {
    const oldHeadRun: ActionRunFixture = {
      id: 402,
      runAttempt: 1,
      headSha: firstHead,
      startedAt: '2026-08-01T10:00:00Z',
      finishedAt: '2026-08-01T10:30:00Z',
      conclusion: 'success',
    };
    const reviewEventRecord = {
      head_sha: finalHead,
      requested_at: '2026-08-01T10:20:00Z',
      completed_at: '',
    };
    const pages = asUntrustedYamlNode([
      { total_count: 1, workflow_runs: [actionRun(oldHeadRun)] },
    ]);
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [sealUntrustedYamlMap(reviewEventRecord)],
      deliveryHeadOrder: [firstHead, finalHead],
    };
    const evidence = buildActionsEvidence(request);

    expect(evidence.obsoleteValidationSeconds).toBe(600);
    expect(evidence.obsoleteValidationCount).toBe(1);
  });

  test('does not invent supersession without server evidence', () => {
    const oldHeadRun: ActionRunFixture = {
      id: 403,
      runAttempt: 1,
      headSha: firstHead,
      startedAt: '2026-08-01T10:00:00Z',
      finishedAt: '2026-08-01T10:30:00Z',
      conclusion: 'success',
    };
    const pages = asUntrustedYamlNode([
      { total_count: 1, workflow_runs: [actionRun(oldHeadRun)] },
    ]);
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [],
      deliveryHeadOrder: [firstHead, finalHead],
    };
    const evidence = buildActionsEvidence(request);

    expect(evidence.obsoleteValidationSeconds).toBe(0);
    expect(evidence.heads[1]?.head_sha).toBe(finalHead);
  });

  test('rejects nonterminal action attempts', () => {
    const nonterminalRun: ActionRunFixture = {
      id: 101,
      runAttempt: 1,
      headSha: finalHead,
      startedAt: '2026-08-01T10:00:00Z',
      finishedAt: '2026-08-01T10:01:00Z',
      conclusion: 'success',
      status: 'in_progress',
    };
    const pages = asUntrustedYamlNode([
      {
        total_count: 1,
        workflow_runs: [actionRun(nonterminalRun)],
      },
    ]);
    const request: BuildActionsEvidenceRequest = {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [],
      deliveryHeadOrder: [finalHead],
    };
    expect(() => buildActionsEvidence(request)).toThrow(
      'retry collection after completion',
    );
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
        author_association: 'NONE',
        user: { login: 'github-actions[bot]' },
      },
      {
        id: 12,
        body: `<!-- nook-codex-review:${finalHead.slice(0, 12)} -->`,
        created_at: '2026-08-01T10:20:00Z',
        author_association: 'MEMBER',
        user: { login: 'github-actions[bot]' },
      },
      {
        id: 13,
        body: `<!-- nook-codex-review:${finalHead.slice(0, 12)} -->`,
        created_at: '2026-08-01T10:21:00Z',
        author_association: 'MEMBER',
        user: { login: 'github-actions[bot]' },
      },
    ]);
    const reviewPages = yamlPages([
      {
        id: 500,
        body: '',
        commit_id: firstHead,
        state: 'PENDING',
        user: { login: 'human-reviewer' },
      },
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
        request_comment_id: 13,
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
      mergedAt: '2026-08-01T11:00:00Z',
    };
    const evidence = buildReviewEvidence(request);

    expect(evidence.events).toHaveLength(3);
    expect(evidence.requestCount).toBe(3);
    expect(evidence.findingBatchCount).toBe(1);
    expect(evidence.findingCount).toBe(2);
    expect(evidence.events[0]?.latency_seconds).toBe(300);
    expect(evidence.events[1]?.outcome).toBe('unavailable');
    expect(evidence.events[2]?.outcome).toBe('clean');
    expect(evidence.events[2]?.latency_seconds).toBe(120);
  });

  test('counts a substantive review body as one finding', () => {
    const request: BuildReviewEvidenceRequest = {
      issueCommentPages: yamlPages([
        {
          id: 20,
          body: `<!-- nook-codex-review:${finalHead.slice(0, 12)} -->`,
          created_at: '2026-08-01T10:00:00Z',
          author_association: 'MEMBER',
          user: { login: 'github-actions[bot]' },
        },
      ]),
      reviewPages: yamlPages([
        {
          id: 502,
          body: 'Please preserve review evidence for this head.',
          commit_id: finalHead,
          submitted_at: '2026-08-01T10:05:00Z',
          user: { login: 'chatgpt-codex-connector[bot]' },
        },
      ]),
      reviewCommentPages: yamlPages([]),
      reviewReactionPages: yamlPages([]),
      knownHeadShas: [finalHead],
      mergedAt: '2026-08-01T11:00:00Z',
    };
    const evidence = buildReviewEvidence(request);

    expect(evidence.findingBatchCount).toBe(1);
    expect(evidence.findingCount).toBe(1);
    expect(evidence.events[0]?.outcome).toBe('findings');
  });

  test('retains a clean reaction for a request after an earlier finding', () => {
    const request: BuildReviewEvidenceRequest = {
      issueCommentPages: yamlPages([
        {
          id: 21,
          body: `<!-- nook-codex-review:${finalHead.slice(0, 12)} -->`,
          created_at: '2026-08-01T10:20:00Z',
          author_association: 'MEMBER',
          user: { login: 'github-actions[bot]' },
        },
      ]),
      reviewPages: yamlPages([
        {
          id: 503,
          body: 'Finding completed before the later request.',
          commit_id: finalHead,
          submitted_at: '2026-08-01T10:05:00Z',
          user: { login: 'chatgpt-codex-connector[bot]' },
        },
      ]),
      reviewCommentPages: yamlPages([]),
      reviewReactionPages: yamlPages([
        {
          request_comment_id: 21,
          content: '+1',
          created_at: '2026-08-01T10:23:00Z',
          user: { login: 'chatgpt-codex-connector[bot]' },
        },
      ]),
      knownHeadShas: [finalHead],
      mergedAt: '2026-08-01T11:00:00Z',
    };
    const evidence = buildReviewEvidence(request);

    expect(evidence.events).toHaveLength(2);
    expect(evidence.events[0]?.outcome).toBe('clean');
    expect(evidence.events[0]?.latency_seconds).toBe(180);
    expect(evidence.events[1]?.outcome).toBe('findings');
  });

  test('pairs a later duplicate request with its own clean reaction', () => {
    const request: BuildReviewEvidenceRequest = {
      issueCommentPages: yamlPages([
        {
          id: 23,
          body: `<!-- nook-codex-review:${finalHead} -->`,
          created_at: '2026-08-01T10:00:00Z',
          author_association: 'MEMBER',
          user: { login: 'github-actions[bot]' },
        },
        {
          id: 24,
          body: `<!-- nook-codex-review:${finalHead} -->`,
          created_at: '2026-08-01T10:10:00Z',
          author_association: 'MEMBER',
          user: { login: 'github-actions[bot]' },
        },
      ]),
      reviewPages: yamlPages([
        {
          id: 505,
          body: 'Finding for the first request.',
          commit_id: finalHead,
          submitted_at: '2026-08-01T10:05:00Z',
          user: { login: 'chatgpt-codex-connector[bot]' },
        },
      ]),
      reviewCommentPages: yamlPages([]),
      reviewReactionPages: yamlPages([
        {
          request_comment_id: 24,
          content: '+1',
          created_at: '2026-08-01T10:15:00Z',
          user: { login: 'chatgpt-codex-connector[bot]' },
        },
      ]),
      knownHeadShas: [finalHead],
      mergedAt: '2026-08-01T11:00:00Z',
    };
    const evidence = buildReviewEvidence(request);

    expect(evidence.events).toHaveLength(2);
    expect(evidence.events[0]?.outcome).toBe('findings');
    expect(evidence.events[0]?.latency_seconds).toBe(300);
    expect(evidence.events[1]?.outcome).toBe('clean');
    expect(evidence.events[1]?.latency_seconds).toBe(300);
  });

  test('retains trusted review evidence for a rebased-away full SHA', () => {
    const rebasedHead = '4444444444444444444444444444444444444444';
    const request: BuildReviewEvidenceRequest = {
      issueCommentPages: yamlPages([
        {
          id: 22,
          body: `<!-- nook-codex-review:${rebasedHead} -->`,
          created_at: '2026-08-01T10:00:00Z',
          author_association: 'MEMBER',
          user: { login: 'github-actions[bot]' },
        },
      ]),
      reviewPages: yamlPages([
        {
          id: 504,
          body: 'Finding on a head removed by rebase.',
          commit_id: rebasedHead,
          submitted_at: '2026-08-01T10:05:00Z',
          user: { login: 'chatgpt-codex-connector[bot]' },
        },
      ]),
      reviewCommentPages: yamlPages([]),
      reviewReactionPages: yamlPages([]),
      knownHeadShas: [finalHead],
      mergedAt: '2026-08-01T11:00:00Z',
    };
    const evidence = buildReviewEvidence(request);

    expect(evidence.requestCount).toBe(1);
    expect(evidence.findingBatchCount).toBe(1);
    expect(evidence.events[0]?.head_sha).toBe(rebasedHead);
  });

  test('excludes review results completed after merge', () => {
    const request: BuildReviewEvidenceRequest = {
      issueCommentPages: yamlPages([
        {
          id: 30,
          body: `<!-- nook-codex-review:${finalHead.slice(0, 12)} -->`,
          created_at: '2026-08-01T10:00:00Z',
          author_association: 'MEMBER',
          user: { login: 'github-actions[bot]' },
        },
      ]),
      reviewPages: yamlPages([
        {
          id: 503,
          body: 'A late finding must not alter delivery statistics.',
          commit_id: finalHead,
          submitted_at: '2026-08-01T11:01:00Z',
          user: { login: 'chatgpt-codex-connector[bot]' },
        },
      ]),
      reviewCommentPages: yamlPages([]),
      reviewReactionPages: yamlPages([]),
      knownHeadShas: [finalHead],
      mergedAt: '2026-08-01T11:00:00Z',
    };
    const evidence = buildReviewEvidence(request);

    expect(evidence.findingBatchCount).toBe(0);
    expect(evidence.findingCount).toBe(0);
    expect(evidence.events[0]?.outcome).toBe('unavailable');
  });

  test('appends unexpected review-only heads without reordering actions', () => {
    const actionHeadRecord = {
      head_sha: finalHead,
      first_observed_at: '2026-08-01T10:20:00Z',
      last_observed_at: '2026-08-01T10:25:00Z',
      final: true,
      action_run_count: 1,
      action_seconds: 300,
      obsolete_action_seconds: 0,
    };
    const actionHead = sealUntrustedYamlMap(actionHeadRecord);
    const reviewEventRecord = {
      head_sha: firstHead,
      requested_at: '2026-08-01T10:00:00Z',
      completed_at: '2026-08-01T10:05:00Z',
    };
    const reviewEvent = sealUntrustedYamlMap(reviewEventRecord);
    const mergeRequest = {
      actionHeads: [actionHead],
      reviewEvents: [reviewEvent],
      finalHeadSha: finalHead,
    };
    const heads = mergeReviewedDeliveryHeads(mergeRequest);

    expect(heads).toHaveLength(2);
    expect(heads[0]?.head_sha).toBe(finalHead);
    expect(heads[1]?.head_sha).toBe(firstHead);
    expect(heads[1]?.action_run_count).toBe(0);
    expect(heads[1]?.first_observed_at).toBe('2026-08-01T10:00:00Z');
    expect(heads[1]?.last_observed_at).toBe('2026-08-01T10:05:00Z');
  });

  test('enriches a zero-Actions final head with review timestamps', () => {
    const emptyHeadRecord = {
      head_sha: finalHead,
      first_observed_at: '',
      last_observed_at: '',
      final: true,
      action_run_count: 0,
      action_seconds: 0,
      obsolete_action_seconds: 0,
    };
    const reviewEventRecord = {
      head_sha: finalHead,
      requested_at: '2026-08-01T10:00:00Z',
      completed_at: '2026-08-01T10:05:00Z',
    };
    const mergeRequest = {
      actionHeads: [sealUntrustedYamlMap(emptyHeadRecord)],
      reviewEvents: [sealUntrustedYamlMap(reviewEventRecord)],
      finalHeadSha: finalHead,
    };
    const heads = mergeReviewedDeliveryHeads(mergeRequest);

    expect(heads).toHaveLength(1);
    expect(heads[0]?.first_observed_at).toBe('2026-08-01T10:00:00Z');
    expect(heads[0]?.last_observed_at).toBe('2026-08-01T10:05:00Z');
  });

  test('merges earlier review timestamps into an action head', () => {
    const actionHeadRecord = {
      head_sha: finalHead,
      first_observed_at: '2026-08-01T10:20:00Z',
      last_observed_at: '2026-08-01T10:25:00Z',
      final: true,
      action_run_count: 1,
      action_seconds: 300,
      obsolete_action_seconds: 0,
    };
    const reviewEventRecord = {
      head_sha: finalHead,
      requested_at: '2026-08-01T10:00:00Z',
      completed_at: '2026-08-01T10:05:00Z',
    };
    const mergeRequest = {
      actionHeads: [sealUntrustedYamlMap(actionHeadRecord)],
      reviewEvents: [sealUntrustedYamlMap(reviewEventRecord)],
      finalHeadSha: finalHead,
    };
    const heads = mergeReviewedDeliveryHeads(mergeRequest);

    expect(heads[0]?.first_observed_at).toBe('2026-08-01T10:00:00Z');
    expect(heads[0]?.last_observed_at).toBe('2026-08-01T10:25:00Z');
    expect(heads[0]?.action_run_count).toBe(1);
  });

  test('preserves delivery sequence while enriching head timestamps', () => {
    const firstActionHeadRecord = {
      head_sha: firstHead,
      first_observed_at: '2026-08-01T10:30:00Z',
      last_observed_at: '2026-08-01T10:32:00Z',
      final: false,
      action_run_count: 1,
      action_seconds: 120,
      obsolete_action_seconds: 120,
    };
    const finalActionHeadRecord = {
      head_sha: finalHead,
      first_observed_at: '2026-08-01T10:20:00Z',
      last_observed_at: '2026-08-01T10:25:00Z',
      final: true,
      action_run_count: 0,
      action_seconds: 0,
      obsolete_action_seconds: 0,
    };
    const mergeRequest = {
      actionHeads: [
        sealUntrustedYamlMap(firstActionHeadRecord),
        sealUntrustedYamlMap(finalActionHeadRecord),
      ],
      reviewEvents: [],
      finalHeadSha: finalHead,
    };
    const heads = mergeReviewedDeliveryHeads(mergeRequest);

    expect(heads.map((head) => head.head_sha)).toEqual([firstHead, finalHead]);
  });
});

type ActionRunFixture = {
  readonly id: number;
  readonly runAttempt: number;
  readonly headSha: string;
  readonly startedAt: string;
  readonly createdAt?: string;
  readonly finishedAt: string;
  readonly conclusion: string;
  readonly sourcePr?: number | false;
  readonly status?: string;
  readonly workflow?: string;
  readonly validationRequested?: boolean;
  readonly trigger?: string;
};

function actionRun(fixture: ActionRunFixture): UntrustedYamlNode {
  return {
    id: fixture.id,
    name: fixture.workflow ?? 'PR',
    run_attempt: fixture.runAttempt,
    head_sha: fixture.headSha,
    event: fixture.trigger ?? 'pull_request',
    created_at: fixture.createdAt ?? fixture.startedAt,
    run_started_at: fixture.startedAt,
    updated_at: fixture.finishedAt,
    conclusion: fixture.conclusion,
    status: fixture.status ?? 'completed',
    pull_requests:
      fixture.sourcePr === false ? [] : [{ number: fixture.sourcePr ?? 42 }],
    validation_requested:
      fixture.validationRequested === false ? 'false' : 'true',
  };
}

function actionPages(fixtures: readonly ActionRunFixture[]): UntrustedYamlNode {
  return asUntrustedYamlNode([
    {
      total_count: fixtures.length,
      workflow_runs: fixtures.map(actionRun),
    },
  ]);
}

function yamlPages(items: readonly UntrustedYamlNode[]): UntrustedYamlNode {
  return asUntrustedYamlNode([items]);
}
