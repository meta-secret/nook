import { describe, expect, test } from 'bun:test';
import { asUntrustedYamlNode } from '../src/lib/guards.ts';
import {
  buildActionsEvidence,
  type BuildActionsEvidenceRequest,
} from '../src/lib/agent-stats-github.ts';
import { dispatchedSourceHead } from '../src/lib/agent-stats-github-api.ts';

import type { UntrustedYamlNode } from '../src/lib/guards.ts';

const firstHead = '1111111111111111111111111111111111111111';
const finalHead = '2222222222222222222222222222222222222222';

describe('agent stats manual E2E evidence', () => {
  test('resolves exact manual E2E source provenance', () => {
    const pages = asUntrustedYamlNode([
      { artifacts: [{ name: `e2e-pr-source-42-1-${finalHead}` }] },
    ]);
    const request = {
      pages,
      prNumber: 42,
      runId: 500,
      runAttempt: 1,
    };

    expect(dispatchedSourceHead(request)).toBe(finalHead);
  });

  test('keeps manual E2E provenance scoped to its rerun attempt', () => {
    const pages = asUntrustedYamlNode([
      {
        artifacts: [
          { name: `e2e-pr-source-42-1-${firstHead}` },
          { name: `e2e-pr-source-42-2-${finalHead}` },
        ],
      },
    ]);
    const request = { pages, prNumber: 42, runId: 500, runAttempt: 1 };

    expect(dispatchedSourceHead(request)).toBe(firstHead);
  });

  test('leaves a pre-provenance cancellation unattributed', () => {
    const request = {
      pages: asUntrustedYamlNode([{ artifacts: [] }]),
      prNumber: 42,
      runId: 500,
      runAttempt: 1,
    };

    expect(dispatchedSourceHead(request)).toBe('');
  });

  test('snapshots nonterminal action attempts at merge', () => {
    const pages = actionPages([
      {
        id: 101,
        headSha: finalHead,
        finishedAt: '2026-08-01T10:01:00Z',
        conclusion: 'success',
        status: 'in_progress',
      },
    ]);
    const request = evidenceRequest(pages);
    const evidence = buildActionsEvidence(request);

    expect(evidence.runs).toHaveLength(1);
    expect(evidence.runs[0]?.finished_at).toBe(request.mergedAt);
    expect(evidence.runs[0]?.conclusion).toBe('nonterminal_at_merge');
  });

  test('clips an action that completes after merge to the merge boundary', () => {
    const pages = actionPages([
      {
        id: 104,
        headSha: finalHead,
        finishedAt: '2026-08-01T12:00:00Z',
        conclusion: 'success',
      },
    ]);
    const request = evidenceRequest(pages);
    const evidence = buildActionsEvidence(request);

    expect(evidence.runs[0]?.finished_at).toBe(request.mergedAt);
    expect(evidence.runs[0]?.duration_seconds).toBe(3600);
    expect(evidence.runs[0]?.conclusion).toBe('nonterminal_at_merge');
  });

  test('counts an action whose source was unavailable without inventing a head', () => {
    const pages = actionPages([
      {
        id: 105,
        headSha: '',
        finishedAt: '2026-08-01T10:01:00Z',
        conclusion: 'cancelled',
      },
    ]);
    const request = evidenceRequest(pages);
    const evidence = buildActionsEvidence(request);

    expect(evidence.runs).toHaveLength(1);
    expect(evidence.runs[0]?.source_attributed).toBe(false);
    expect(evidence.heads.map((head) => head.head_sha)).toEqual([finalHead]);
  });
});

type ManualActionFixture = {
  readonly id: number;
  readonly headSha: string;
  readonly finishedAt: string;
  readonly conclusion: string;
  readonly status?: string;
};

function actionPages(
  fixtures: readonly ManualActionFixture[],
): UntrustedYamlNode {
  return asUntrustedYamlNode([
    {
      total_count: fixtures.length,
      workflow_runs: fixtures.map((fixture) => ({
        id: fixture.id,
        name: 'E2E (PR)',
        run_attempt: 1,
        head_sha: fixture.headSha,
        event: 'workflow_dispatch',
        created_at: '2026-08-01T10:00:00Z',
        updated_at: fixture.finishedAt,
        conclusion: fixture.conclusion,
        status: fixture.status ?? 'completed',
        pull_requests: [{ number: 42 }],
        validation_requested: 'true',
      })),
    },
  ]);
}

function evidenceRequest(
  pages: UntrustedYamlNode,
): BuildActionsEvidenceRequest {
  return {
    pages,
    prNumber: 42,
    finalHeadSha: finalHead,
    mergedAt: '2026-08-01T11:00:00Z',
    reviewEvents: [],
    deliveryHeadOrder: [finalHead],
  };
}
