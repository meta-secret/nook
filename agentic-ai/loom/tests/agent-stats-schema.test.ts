import { describe, expect, test } from 'bun:test';
import { validateAgentStatsYaml } from '../src/lib/agent-stats-schema.ts';

import type { ValidateAgentStatsYamlArgs } from '../src/lib/agent-stats-schema.ts';
const validYaml = `
schema_version: 4
source_pr:
  number: 481
  url: https://github.com/meta-secret/nook/pull/481
  title: Example change
  change_surface: docs_ci
  head_sha: 0123456789abcdef0123456789abcdef01234567
  merge_sha: 89abcdef0123456789abcdef0123456789abcdef
  started_at: 2026-07-18T18:10:00Z
  opened_at: 2026-07-18T18:25:00Z
  merged_at: 2026-07-18T18:55:00Z
  elapsed_seconds: 2700
  open_to_merge_seconds: 1800
summary:
  local_execution_count: 1
  local_check_count: 1
  local_test_count: 0
  local_combined_count: 0
  local_execution_seconds: 40
  github_actions_run_count: 1
  github_actions_seconds: 60
  delivery_head_count: 1
  review_request_count: 1
  review_finding_batch_count: 1
  review_finding_count: 2
  validation_cycle_count: 1
  obsolete_validation_seconds: 0
  obsolete_validation_count: 0
  cancelled_validation_seconds: 60
  cancelled_validation_count: 1
  pr_retrigger_count: 0
  agent_requested_rerun_count: 0
  merge_attempt_count: 1
test_inventory:
  measured_at: 2026-07-18T18:56:00Z
  head_sha: 0123456789abcdef0123456789abcdef01234567
  by_type:
    rust: 1
    preflight: 1
    web_unit: 1
    e2e: 1
  total: 4
local_executions:
  - command: task format
    category: check
    started_at: 2026-07-18T18:24:00Z
    finished_at: 2026-07-18T18:24:40Z
    duration_seconds: 40
    outcome: passed
    reason: pre_push_hygiene
github_actions_runs:
  - workflow: PR
    run_id: 123
    run_attempt: 1
    head_sha: 0123456789abcdef0123456789abcdef01234567
    trigger: pull_request
    started_at: 2026-07-18T18:25:00Z
    finished_at: 2026-07-18T18:26:00Z
    duration_seconds: 60
    conclusion: cancelled
    source_pr: 481
    source_attributed: true
    validation_requested: true
delivery_heads:
  - head_sha: 0123456789abcdef0123456789abcdef01234567
    first_observed_at: 2026-07-18T18:25:00Z
    last_observed_at: 2026-07-18T18:26:00Z
    final: true
    action_run_count: 1
    action_seconds: 60
    obsolete_action_seconds: 0
review_events:
  - head_sha: 0123456789abcdef0123456789abcdef01234567
    requested_at: 2026-07-18T18:25:00Z
    completed_at: 2026-07-18T18:26:00Z
    reviewer: codex
    outcome: findings
    requested: true
    finding_count: 2
    latency_seconds: 60
validation_cycles:
  - head_sha: 0123456789abcdef0123456789abcdef01234567
    workflow: PR
    run_id: 123
    run_attempt: 1
    started_at: 2026-07-18T18:25:00Z
    finished_at: 2026-07-18T18:26:00Z
    duration_seconds: 60
    conclusion: cancelled
    obsolete_seconds: 0
cache_telemetry:
  totals:
    job_count: 0
  jobs: []
pr_retriggers: []
merge_attempts:
  - at: 2026-07-18T18:55:00Z
    method: squash
    outcome: success
    reason: readiness_passed
comparison:
  baseline_prs: []
  baseline_quality: incomplete
  baseline_note: no baselines
  regression: false
  regression_reasons: []
waste_assessment:
  wasteful: false
  findings: []
  required_actions: []
`;

describe('validateAgentStatsYaml', () => {
  test('accepts a schema-v4 record', () => {
    const resultArgs2: ValidateAgentStatsYamlArgs = {
      content: validYaml,
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(resultArgs2);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(
      validateAgentStatsYaml({
        content: validYaml.replace('\n  total: 4\n', '\n'),
        expectedPrNumber: 481,
      }).errors,
    ).toContain('test_inventory.total must be a non-negative integer');
  });

  test('preserves validation for schema-v3 records', () => {
    const request: ValidateAgentStatsYamlArgs = {
      content: validYaml.replace('schema_version: 4', 'schema_version: 3'),
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(request);
    expect(result.ok).toBe(true);
  });

  test('accepts review evidence outside the action observation window', () => {
    const content = validYaml
      .replace(
        'first_observed_at: 2026-07-18T18:25:00Z',
        'first_observed_at: 2026-07-18T18:24:00Z',
      )
      .replace(
        'requested_at: 2026-07-18T18:25:00Z',
        'requested_at: 2026-07-18T18:24:00Z',
      )
      .replace('latency_seconds: 60', 'latency_seconds: 120');
    const request: ValidateAgentStatsYamlArgs = {
      content,
      expectedPrNumber: 481,
    };

    expect(validateAgentStatsYaml(request).ok).toBe(true);
  });

  test('accepts every repository validation workflow', () => {
    const content = validYaml.replaceAll(
      'workflow: PR',
      'workflow: Web research',
    );
    const request: ValidateAgentStatsYamlArgs = {
      content,
      expectedPrNumber: 481,
    };

    expect(validateAgentStatsYaml(request).ok).toBe(true);
  });

  test('rejects contradictory review outcomes and finding counts', () => {
    const request: ValidateAgentStatsYamlArgs = {
      content: validYaml.replace(
        '    finding_count: 2',
        '    finding_count: 0',
      ),
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(request);
    expect(
      result.errors.some((error) => error.includes('review outcome')),
    ).toBe(true);
  });

  test('rejects head observation timestamps outside action extrema', () => {
    const request: ValidateAgentStatsYamlArgs = {
      content: validYaml.replace(
        'first_observed_at: 2026-07-18T18:25:00Z',
        'first_observed_at: 2026-07-18T18:24:00Z',
      ),
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(request);
    expect(
      result.errors.some((error) => error.includes('first_observed_at')),
    ).toBe(true);
  });

  test('requires every PR attempt to have exactly one validation cycle', () => {
    const request: ValidateAgentStatsYamlArgs = {
      content: validYaml.replace(
        'validation_cycles:',
        'validation_cycles: []\nignored_validation_cycles:',
      ),
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(request);
    expect(
      result.errors.some((error) =>
        error.includes('must include requested github_actions_runs attempt'),
      ),
    ).toBe(true);
  });

  test('rejects delivery summary values that do not match per-head evidence', () => {
    const invalidYaml = validYaml.replace(
      'obsolete_validation_seconds: 0',
      'obsolete_validation_seconds: 1',
    );
    const resultArgs: ValidateAgentStatsYamlArgs = {
      content: invalidYaml,
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(resultArgs);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((item) =>
        item.includes('summary.obsolete_validation_seconds'),
      ),
    ).toBe(true);
  });

  test('rejects per-head action totals that contradict collected runs', () => {
    const invalidYaml = validYaml.replace(
      'action_run_count: 1',
      'action_run_count: 2',
    );
    const resultArgs: ValidateAgentStatsYamlArgs = {
      content: invalidYaml,
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(resultArgs);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((item) => item.includes('action_run_count')),
    ).toBe(true);
  });

  test('rejects per-head action seconds that contradict collected runs', () => {
    const invalidYaml = validYaml.replace(
      'action_seconds: 60',
      'action_seconds: 61',
    );
    const resultArgs: ValidateAgentStatsYamlArgs = {
      content: invalidYaml,
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(resultArgs);
    expect(result.ok).toBe(false);
    expect(result.errors.some((item) => item.includes('action_seconds'))).toBe(
      true,
    );
  });

  test('rejects obsolete action seconds that contradict collected runs', () => {
    const invalidYaml = validYaml.replace(
      'obsolete_action_seconds: 0',
      'obsolete_action_seconds: 1',
    );
    const resultArgs: ValidateAgentStatsYamlArgs = {
      content: invalidYaml,
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(resultArgs);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((item) => item.includes('obsolete_action_seconds')),
    ).toBe(true);
  });

  test('rejects validation cycles that do not match an action attempt', () => {
    const invalidYaml = validYaml.replace(
      '    run_attempt: 1\n    started_at: 2026-07-18T18:25:00Z\n    finished_at:',
      '    run_attempt: 2\n    started_at: 2026-07-18T18:25:00Z\n    finished_at:',
    );
    const resultArgs: ValidateAgentStatsYamlArgs = {
      content: invalidYaml,
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(resultArgs);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((item) =>
        item.includes(
          'must match a requested validation github_actions_runs attempt',
        ),
      ),
    ).toBe(true);
  });

  test('rejects review latency that contradicts event timestamps', () => {
    const invalidYaml = validYaml.replace(
      '    latency_seconds: 60',
      '    latency_seconds: 61',
    );
    const resultArgs: ValidateAgentStatsYamlArgs = {
      content: invalidYaml,
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(resultArgs);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((item) => item.includes('latency_seconds must match')),
    ).toBe(true);
  });

  test('rejects delivery heads outside chronological order', () => {
    const laterHead = `delivery_heads:
  - head_sha: 1111111111111111111111111111111111111111
    first_observed_at: 2026-07-18T18:27:00Z
    last_observed_at: 2026-07-18T18:27:00Z
    final: false
    action_run_count: 0
    action_seconds: 0
    obsolete_action_seconds: 0`;
    const invalidYaml = validYaml
      .replace('  delivery_head_count: 1', '  delivery_head_count: 2')
      .replace('delivery_heads:', laterHead);
    const resultArgs: ValidateAgentStatsYamlArgs = {
      content: invalidYaml,
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(resultArgs);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((item) =>
        item.includes('must be later than the preceding delivery head'),
      ),
    ).toBe(true);
  });

  test('derives PR retriggers from validation cycles instead of scratch attribution', () => {
    const invalidYaml = validYaml.replace(
      'pr_retrigger_count: 0',
      'pr_retrigger_count: 1',
    );
    const resultArgs: ValidateAgentStatsYamlArgs = {
      content: invalidYaml,
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(resultArgs);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((item) => item.includes('pr_retrigger_count')),
    ).toBe(true);
  });

  test('rejects filename/source PR mismatch', () => {
    const resultArgs: ValidateAgentStatsYamlArgs = {
      content: validYaml,
      expectedPrNumber: 999,
    };
    const result = validateAgentStatsYaml(resultArgs);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((item) => item.includes('source_pr.number')),
    ).toBe(true);
  });

  test('rejects malformed per-head evidence entries', () => {
    const invalidYaml = validYaml.replace(
      'head_sha: 0123456789abcdef0123456789abcdef01234567\n    first_observed_at:',
      'head_sha: short\n    first_observed_at:',
    );
    const resultArgs: ValidateAgentStatsYamlArgs = {
      content: invalidYaml,
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(resultArgs);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((item) => item.includes('must be a full SHA')),
    ).toBe(true);
  });

  test('rejects a malformed merge SHA', () => {
    const invalidYaml = validYaml.replace(
      'merge_sha: 89abcdef0123456789abcdef0123456789abcdef',
      'merge_sha: not-a-commit',
    );
    const resultArgs: ValidateAgentStatsYamlArgs = {
      content: invalidYaml,
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(resultArgs);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((item) =>
        item.includes('merge_sha must be a full SHA'),
      ),
    ).toBe(true);
  });

  test('rejects an identical final head and squash merge SHA', () => {
    const invalidYaml = validYaml.replace(
      'merge_sha: 89abcdef0123456789abcdef0123456789abcdef',
      'merge_sha: 0123456789abcdef0123456789abcdef01234567',
    );
    const resultArgs: ValidateAgentStatsYamlArgs = {
      content: invalidYaml,
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(resultArgs);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((item) => item.includes('head_sha must differ')),
    ).toBe(true);
  });
});
