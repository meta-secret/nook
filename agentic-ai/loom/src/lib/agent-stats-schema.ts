import { isRecord } from './guards.ts';

export type AgentStatsValidation = {
  readonly ok: boolean;
  readonly errors: string[];
};

export function validateAgentStatsYaml(
  content: string,
  expectedPrNumber: number,
): AgentStatsValidation {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`YAML parse failed: ${message}`] };
  }

  if (!isRecord(parsed)) {
    return { ok: false, errors: ['root must be a mapping'] };
  }

  const errors: string[] = [];
  if (parsed.schema_version !== 3) {
    errors.push('schema_version must be 3');
  }

  const sourcePr = parsed.source_pr;
  if (!isRecord(sourcePr)) {
    errors.push('source_pr must be a mapping');
  } else {
    if (sourcePr.number !== expectedPrNumber) {
      errors.push(
        `source_pr.number (${String(sourcePr.number)}) must match filename PR ${expectedPrNumber}`,
      );
    }
    for (const key of [
      'url',
      'title',
      'change_surface',
      'head_sha',
      'started_at',
      'opened_at',
      'merged_at',
    ] as const) {
      if (typeof sourcePr[key] !== 'string' || sourcePr[key] === '') {
        errors.push(`source_pr.${key} must be a non-empty string`);
      }
    }
    for (const key of ['elapsed_seconds', 'open_to_merge_seconds'] as const) {
      if (!isNonNegativeInt(sourcePr[key])) {
        errors.push(`source_pr.${key} must be a non-negative integer`);
      }
    }
  }

  const summary = parsed.summary;
  if (!isRecord(summary)) {
    errors.push('summary must be a mapping');
  } else {
    for (const key of [
      'local_execution_count',
      'local_check_count',
      'local_test_count',
      'local_combined_count',
      'local_execution_seconds',
      'github_actions_run_count',
      'github_actions_seconds',
      'pr_retrigger_count',
      'agent_requested_rerun_count',
      'merge_attempt_count',
    ] as const) {
      if (!isNonNegativeInt(summary[key])) {
        errors.push(`summary.${key} must be a non-negative integer`);
      }
    }
  }

  const inventory = parsed.test_inventory;
  if (!isRecord(inventory)) {
    errors.push('test_inventory must be a mapping');
  } else {
    if (typeof inventory.measured_at !== 'string') {
      errors.push('test_inventory.measured_at must be a string');
    }
    if (typeof inventory.head_sha !== 'string') {
      errors.push('test_inventory.head_sha must be a string');
    }
    if (
      isRecord(sourcePr) &&
      typeof sourcePr.head_sha === 'string' &&
      inventory.head_sha !== sourcePr.head_sha
    ) {
      errors.push('test_inventory.head_sha must match source_pr.head_sha');
    }
    const byType = inventory.by_type;
    if (!isRecord(byType)) {
      errors.push('test_inventory.by_type must be a mapping');
    } else {
      let sum = 0;
      for (const key of ['rust', 'preflight', 'web_unit', 'e2e'] as const) {
        if (!isNonNegativeInt(byType[key])) {
          errors.push(
            `test_inventory.by_type.${key} must be a non-negative integer`,
          );
        } else if (typeof byType[key] === 'number') {
          sum += byType[key];
        }
      }
      if (isNonNegativeInt(inventory.total) && inventory.total !== sum) {
        errors.push('test_inventory.total must equal the sum of by_type');
      }
    }
  }

  for (const key of [
    'local_executions',
    'github_actions_runs',
    'pr_retriggers',
    'merge_attempts',
  ] as const) {
    if (!Array.isArray(parsed[key])) {
      errors.push(`${key} must be a list`);
    }
  }

  if (!isRecord(parsed.comparison)) {
    errors.push('comparison must be a mapping');
  }
  if (!isRecord(parsed.waste_assessment)) {
    errors.push('waste_assessment must be a mapping');
  }
  if (!isRecord(parsed.cache_telemetry)) {
    errors.push('cache_telemetry must be a mapping');
  }

  if (isRecord(summary) && Array.isArray(parsed.local_executions)) {
    if (summary.local_execution_count !== parsed.local_executions.length) {
      errors.push(
        'summary.local_execution_count must match local_executions length',
      );
    }
  }
  if (isRecord(summary) && Array.isArray(parsed.github_actions_runs)) {
    if (
      summary.github_actions_run_count !== parsed.github_actions_runs.length
    ) {
      errors.push(
        'summary.github_actions_run_count must match github_actions_runs length',
      );
    }
  }
  if (isRecord(summary) && Array.isArray(parsed.merge_attempts)) {
    if (summary.merge_attempt_count !== parsed.merge_attempts.length) {
      errors.push(
        'summary.merge_attempt_count must match merge_attempts length',
      );
    }
  }
  if (isRecord(summary) && Array.isArray(parsed.pr_retriggers)) {
    if (summary.pr_retrigger_count !== parsed.pr_retriggers.length) {
      errors.push('summary.pr_retrigger_count must match pr_retriggers length');
    }
  }

  return { ok: errors.length === 0, errors };
}

function isNonNegativeInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
