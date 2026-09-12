import { GitHubActionEvidence } from '../src/lib/agent-stats-github.ts';
import { GitHubDispatchTitle } from '../src/lib/agent-stats-github-api.ts';
import { ok } from 'neverthrow';
import {
  GitHubActionJobs,
  GitHubSourceVerification,
} from '../src/lib/agent-stats-github-jobs.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

import { UntrustedYamlBoundary } from '../src/lib/guards.ts';

import { type BuildActionsEvidenceRequest } from '../src/lib/agent-stats-github.ts';

import type { UntrustedYamlNode } from '../src/lib/guards.ts';

export class AgentStatsGithubManualE2eScenario {
  private constructor(private readonly request: UntrustedYamlNode) {}

  static actionPages(
    fixtures: readonly ManualActionFixture[],
  ): UntrustedYamlNode {
    return UntrustedYamlBoundary.fromHost([
      {
        total_count: fixtures.length,
        workflow_runs: fixtures.map((fixture) => {
          const [status = 'completed'] = [fixture.status];
          return {
            id: fixture.id,
            name: 'E2E (PR)',
            run_attempt: 1,
            head_sha: fixture.headSha,
            event: 'workflow_dispatch',
            created_at: '2026-08-01T10:00:00Z',
            updated_at: fixture.finishedAt,
            conclusion: fixture.conclusion,
            status,
            pull_requests: [{ number: 42 }],
            validation_requested: 'true',
          };
        }),
      },
    ]);
  }

  static evidenceRequest(
    pages: UntrustedYamlNode,
  ): BuildActionsEvidenceRequest {
    return new AgentStatsGithubManualE2eScenario(pages).execute();
  }

  private execute(): BuildActionsEvidenceRequest {
    const pages = this.request;
    return {
      pages,
      prNumber: 42,
      finalHeadSha: finalHead,
      mergedAt: '2026-08-01T11:00:00Z',
      reviewEvents: [],
      deliveryHeadOrder: [finalHead],
    };
  }
}

const firstHead = '1111111111111111111111111111111111111111';

const finalHead = '2222222222222222222222222222222222222222';

describe('agent stats manual E2E evidence', () => {
  test('routes production assembly through complete GitHub evidence', () => {
    const source = readFileSync(
      new URL('../src/lib/agent-stats-assemble.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      'new GithubAgentEvidence(evidenceRequest).collect()',
    );
    expect(source).not.toContain('collectGithubActionsRuns');
    expect(source).not.toContain("'run',\n      'list'");
  });

  test('retains the exact source head in durable workflow metadata', () => {
    const workflow = readFileSync(
      new URL('../../../.github/workflows/e2e-pr.yml', import.meta.url),
      'utf8',
    );

    expect(workflow).toContain('source_head_sha:');
    expect(workflow).toContain(
      'E2E PR #${{ inputs.pr_number }} @ ${{ inputs.source_head_sha }}',
    );
    expect(workflow).not.toContain('retention-days:');
  });

  test('resolves exact manual E2E source provenance', () => {
    const request = {
      displayTitle: `E2E PR #42 @ ${finalHead} · all`,
      prNumber: 42,
      runId: 500,
    };

    expect(new GitHubDispatchTitle(request).sourceHead()).toBe(finalHead);
  });

  test('keeps rerun provenance immutable in workflow metadata', () => {
    const request = {
      displayTitle: `E2E PR #42 @ ${firstHead} · e2e-pr`,
      prNumber: 42,
      runId: 500,
    };

    expect(new GitHubDispatchTitle(request).sourceHead()).toBe(firstHead);
  });

  test('leaves malformed manual E2E metadata unattributed', () => {
    const request = {
      displayTitle: 'E2E PR #42 @ missing · all',
      prNumber: 42,
      runId: 500,
    };

    expect(new GitHubDispatchTitle(request).sourceHead()).toBe('');
  });

  test('attributes manual provenance only after server-side verification', () => {
    const successful = {
      jobs: [
        {
          name: 'Build PR browser image',
          steps: [{ name: 'Resolve PR head SHA', conclusion: 'success' }],
        },
      ],
    };
    const rejected = {
      jobs: [
        {
          name: 'Build PR browser image',
          steps: [{ name: 'Resolve PR head SHA', conclusion: 'failure' }],
        },
      ],
    };
    const cancelledBeforeResolution = {
      jobs: [
        {
          name: 'Build PR browser image',
          steps: [{ name: 'Resolve PR head SHA', conclusion: '' }],
        },
      ],
    };

    expect(new GitHubActionJobs(successful.jobs).sourceVerification()).toEqual(
      ok(GitHubSourceVerification.Verified),
    );
    expect(new GitHubActionJobs(rejected.jobs).sourceVerification()).toEqual(
      ok(GitHubSourceVerification.Unverified),
    );
    expect(
      new GitHubActionJobs(cancelledBeforeResolution.jobs).sourceVerification(),
    ).toEqual(ok(GitHubSourceVerification.Unverified));
  });

  test('snapshots nonterminal action attempts at merge', () => {
    const pages = AgentStatsGithubManualE2eScenario.actionPages([
      {
        id: 101,
        headSha: finalHead,
        finishedAt: '2026-08-01T10:01:00Z',
        conclusion: 'success',
        status: 'in_progress',
      },
    ]);
    const request = AgentStatsGithubManualE2eScenario.evidenceRequest(pages);
    const evidenceResult = new GitHubActionEvidence(request).build();
    assert(evidenceResult.isOk());
    const evidence = evidenceResult.value;

    expect(evidence.runs).toHaveLength(1);
    expect(evidence.runs[0]?.finished_at).toBe(request.mergedAt);
    expect(evidence.runs[0]?.conclusion).toBe('nonterminal_at_merge');
  });

  test('clips an action that completes after merge to the merge boundary', () => {
    const pages = AgentStatsGithubManualE2eScenario.actionPages([
      {
        id: 104,
        headSha: finalHead,
        finishedAt: '2026-08-01T12:00:00Z',
        conclusion: 'success',
      },
    ]);
    const request = AgentStatsGithubManualE2eScenario.evidenceRequest(pages);
    const evidenceResult = new GitHubActionEvidence(request).build();
    assert(evidenceResult.isOk());
    const evidence = evidenceResult.value;

    expect(evidence.runs[0]?.finished_at).toBe(request.mergedAt);
    expect(evidence.runs[0]?.duration_seconds).toBe(3600);
    expect(evidence.runs[0]?.conclusion).toBe('nonterminal_at_merge');
  });

  test('counts malformed dispatches without inventing a delivery head', () => {
    const pages = AgentStatsGithubManualE2eScenario.actionPages([
      {
        id: 105,
        headSha: '',
        finishedAt: '2026-08-01T10:01:00Z',
        conclusion: 'failure',
      },
    ]);
    const evidenceResult = new GitHubActionEvidence(
      AgentStatsGithubManualE2eScenario.evidenceRequest(pages),
    ).build();
    assert(evidenceResult.isOk());
    const evidence = evidenceResult.value;

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
