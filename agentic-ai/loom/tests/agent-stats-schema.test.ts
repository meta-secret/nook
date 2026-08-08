import { describe, expect, test } from 'bun:test';
import { validateAgentStatsYaml } from '../src/lib/agent-stats-schema.ts';

import type { ValidateAgentStatsYamlArgs } from '../src/lib/agent-stats-schema.ts';
const validYaml = `
schema_version: 3
source_pr:
  number: 481
  url: https://github.com/meta-secret/nook/pull/481
  title: Example change
  change_surface: docs_ci
  head_sha: 0123456789abcdef0123456789abcdef01234567
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
  github_actions_run_count: 0
  github_actions_seconds: 0
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
github_actions_runs: []
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
  test('accepts a schema-v3 record', () => {
    const resultArgs2: ValidateAgentStatsYamlArgs = {
      content: validYaml,
      expectedPrNumber: 481,
    };
    const result = validateAgentStatsYaml(resultArgs2);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
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
});
