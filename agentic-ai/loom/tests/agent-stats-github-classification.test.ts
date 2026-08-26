import { describe, expect, test } from 'bun:test';
import {
  actionJobsRequestedValidation,
  type ActionJobsRequestedValidationRequest,
} from '../src/lib/agent-stats-github-api.ts';
import { substantiveReviewBodyFindingCount } from '../src/lib/agent-stats-github-review.ts';

describe('agent stats GitHub classification', () => {
  test('requires supported request provenance or a non-skipped job', () => {
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
});
