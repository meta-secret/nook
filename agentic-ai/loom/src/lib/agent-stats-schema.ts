import {
  ExternalPropertyPresence,
  asExternalValue,
  externalProperty,
  type ExternalObject,
  type ExternalValue,
  isRecord,
} from './guards.ts';

import type { ExternalPropertyArgs } from './guards.ts';
export type AgentStatsValidation = {
  readonly ok: boolean;
  readonly errors: string[];
};

export type ValidateAgentStatsYamlArgs = {
  readonly content: string;
  readonly expectedPrNumber: number;
};

export function validateAgentStatsYaml(
  args: ValidateAgentStatsYamlArgs,
): AgentStatsValidation {
  const { content, expectedPrNumber } = args;

  let parsed: ExternalValue;
  try {
    parsed = asExternalValue(Bun.YAML.parse(content) as ExternalValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`YAML parse failed: ${message}`] };
  }

  if (!isRecord(parsed)) {
    return { ok: false, errors: ['root must be a mapping'] };
  }

  const errors: string[] = [];
  const schemaVersionArgs: ExternalPropertyArgs = {
    record: parsed,
    key: 'schema_version',
  };
  const schemaVersion = externalProperty(schemaVersionArgs);
  if (
    schemaVersion.presence === ExternalPropertyPresence.Absent ||
    schemaVersion.value !== 3
  ) {
    errors.push('schema_version must be 3');
  }

  const sourcePrPropertyArgs: ExternalPropertyArgs = {
    record: parsed,
    key: 'source_pr',
  };
  const sourcePrProperty = externalProperty(sourcePrPropertyArgs);
  const sourcePr =
    sourcePrProperty.presence === ExternalPropertyPresence.Present &&
    isRecord(sourcePrProperty.value)
      ? sourcePrProperty.value
      : emptyObject();
  if (
    sourcePrProperty.presence === ExternalPropertyPresence.Absent ||
    !isRecord(sourcePrProperty.value)
  ) {
    errors.push('source_pr must be a mapping');
  } else {
    const numberPropertyArgs: ExternalPropertyArgs = {
      record: sourcePr,
      key: 'number',
    };
    const numberProperty = externalProperty(numberPropertyArgs);
    if (
      numberProperty.presence === ExternalPropertyPresence.Absent ||
      numberProperty.value !== expectedPrNumber
    ) {
      errors.push(
        `source_pr.number (${String(
          numberProperty.presence === ExternalPropertyPresence.Present
            ? numberProperty.value
            : '',
        )}) must match filename PR ${expectedPrNumber}`,
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
      const propertyArgs5: ExternalPropertyArgs = {
        record: sourcePr,
        key: key,
      };
      const property = externalProperty(propertyArgs5);
      if (
        property.presence === ExternalPropertyPresence.Absent ||
        typeof property.value !== 'string' ||
        property.value === ''
      ) {
        errors.push(`source_pr.${key} must be a non-empty string`);
      }
    }
    for (const key of ['elapsed_seconds', 'open_to_merge_seconds'] as const) {
      const propertyArgs4: ExternalPropertyArgs = {
        record: sourcePr,
        key: key,
      };
      const property = externalProperty(propertyArgs4);
      if (
        property.presence === ExternalPropertyPresence.Absent ||
        !isNonNegativeInt(property.value)
      ) {
        errors.push(`source_pr.${key} must be a non-negative integer`);
      }
    }
  }

  const summaryPropertyArgs: ExternalPropertyArgs = {
    record: parsed,
    key: 'summary',
  };
  const summaryProperty = externalProperty(summaryPropertyArgs);
  const summary =
    summaryProperty.presence === ExternalPropertyPresence.Present &&
    isRecord(summaryProperty.value)
      ? summaryProperty.value
      : emptyObject();
  if (
    summaryProperty.presence === ExternalPropertyPresence.Absent ||
    !isRecord(summaryProperty.value)
  ) {
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
      const propertyArgs3: ExternalPropertyArgs = { record: summary, key: key };
      const property = externalProperty(propertyArgs3);
      if (
        property.presence === ExternalPropertyPresence.Absent ||
        !isNonNegativeInt(property.value)
      ) {
        errors.push(`summary.${key} must be a non-negative integer`);
      }
    }
  }

  const inventoryPropertyArgs: ExternalPropertyArgs = {
    record: parsed,
    key: 'test_inventory',
  };
  const inventoryProperty = externalProperty(inventoryPropertyArgs);
  const inventory =
    inventoryProperty.presence === ExternalPropertyPresence.Present &&
    isRecord(inventoryProperty.value)
      ? inventoryProperty.value
      : emptyObject();
  if (
    inventoryProperty.presence === ExternalPropertyPresence.Absent ||
    !isRecord(inventoryProperty.value)
  ) {
    errors.push('test_inventory must be a mapping');
  } else {
    const measuredAtArgs: ExternalPropertyArgs = {
      record: inventory,
      key: 'measured_at',
    };
    const measuredAt = externalProperty(measuredAtArgs);
    if (
      measuredAt.presence === ExternalPropertyPresence.Absent ||
      typeof measuredAt.value !== 'string'
    ) {
      errors.push('test_inventory.measured_at must be a string');
    }
    const inventoryHeadShaArgs: ExternalPropertyArgs = {
      record: inventory,
      key: 'head_sha',
    };
    const inventoryHeadSha = externalProperty(inventoryHeadShaArgs);
    if (
      inventoryHeadSha.presence === ExternalPropertyPresence.Absent ||
      typeof inventoryHeadSha.value !== 'string'
    ) {
      errors.push('test_inventory.head_sha must be a string');
    }
    const sourceHeadShaArgs: ExternalPropertyArgs = {
      record: sourcePr,
      key: 'head_sha',
    };
    const sourceHeadSha = externalProperty(sourceHeadShaArgs);
    if (
      sourcePrProperty.presence === ExternalPropertyPresence.Present &&
      isRecord(sourcePrProperty.value) &&
      sourceHeadSha.presence === ExternalPropertyPresence.Present &&
      typeof sourceHeadSha.value === 'string' &&
      inventoryHeadSha.presence === ExternalPropertyPresence.Present &&
      inventoryHeadSha.value !== sourceHeadSha.value
    ) {
      errors.push('test_inventory.head_sha must match source_pr.head_sha');
    }
    const byTypePropertyArgs: ExternalPropertyArgs = {
      record: inventory,
      key: 'by_type',
    };
    const byTypeProperty = externalProperty(byTypePropertyArgs);
    if (
      byTypeProperty.presence === ExternalPropertyPresence.Absent ||
      !isRecord(byTypeProperty.value)
    ) {
      errors.push('test_inventory.by_type must be a mapping');
    } else {
      const byType = byTypeProperty.value;
      let sum = 0;
      for (const key of ['rust', 'preflight', 'web_unit', 'e2e'] as const) {
        const propertyArgs2: ExternalPropertyArgs = {
          record: byType,
          key: key,
        };
        const property = externalProperty(propertyArgs2);
        if (
          property.presence === ExternalPropertyPresence.Absent ||
          !isNonNegativeInt(property.value)
        ) {
          errors.push(
            `test_inventory.by_type.${key} must be a non-negative integer`,
          );
        } else if (typeof property.value === 'number') {
          sum += property.value;
        }
      }
      const totalPropertyArgs: ExternalPropertyArgs = {
        record: inventory,
        key: 'total',
      };
      const totalProperty = externalProperty(totalPropertyArgs);
      if (
        totalProperty.presence === ExternalPropertyPresence.Present &&
        isNonNegativeInt(totalProperty.value) &&
        totalProperty.value !== sum
      ) {
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
    const propertyArgs: ExternalPropertyArgs = { record: parsed, key: key };
    const property = externalProperty(propertyArgs);
    if (
      property.presence === ExternalPropertyPresence.Absent ||
      !Array.isArray(property.value)
    ) {
      errors.push(`${key} must be a list`);
    }
  }

  const comparisonArgs: ExternalPropertyArgs = {
    record: parsed,
    key: 'comparison',
  };
  const comparison = externalProperty(comparisonArgs);
  if (
    comparison.presence === ExternalPropertyPresence.Absent ||
    !isRecord(comparison.value)
  ) {
    errors.push('comparison must be a mapping');
  }
  const wasteAssessmentArgs: ExternalPropertyArgs = {
    record: parsed,
    key: 'waste_assessment',
  };
  const wasteAssessment = externalProperty(wasteAssessmentArgs);
  if (
    wasteAssessment.presence === ExternalPropertyPresence.Absent ||
    !isRecord(wasteAssessment.value)
  ) {
    errors.push('waste_assessment must be a mapping');
  }
  const cacheTelemetryArgs: ExternalPropertyArgs = {
    record: parsed,
    key: 'cache_telemetry',
  };
  const cacheTelemetry = externalProperty(cacheTelemetryArgs);
  if (
    cacheTelemetry.presence === ExternalPropertyPresence.Absent ||
    !isRecord(cacheTelemetry.value)
  ) {
    errors.push('cache_telemetry must be a mapping');
  }

  const localExecutionsArgs: ExternalPropertyArgs = {
    record: parsed,
    key: 'local_executions',
  };
  const localExecutions = externalProperty(localExecutionsArgs);
  if (
    summaryProperty.presence === ExternalPropertyPresence.Present &&
    isRecord(summaryProperty.value) &&
    localExecutions.presence === ExternalPropertyPresence.Present &&
    Array.isArray(localExecutions.value)
  ) {
    const countArgs4: ExternalPropertyArgs = {
      record: summary,
      key: 'local_execution_count',
    };
    const count = externalProperty(countArgs4);
    if (
      count.presence === ExternalPropertyPresence.Present &&
      count.value !== localExecutions.value.length
    ) {
      errors.push(
        'summary.local_execution_count must match local_executions length',
      );
    }
  }
  const githubActionsRunsArgs: ExternalPropertyArgs = {
    record: parsed,
    key: 'github_actions_runs',
  };
  const githubActionsRuns = externalProperty(githubActionsRunsArgs);
  if (
    summaryProperty.presence === ExternalPropertyPresence.Present &&
    isRecord(summaryProperty.value) &&
    githubActionsRuns.presence === ExternalPropertyPresence.Present &&
    Array.isArray(githubActionsRuns.value)
  ) {
    const countArgs3: ExternalPropertyArgs = {
      record: summary,
      key: 'github_actions_run_count',
    };
    const count = externalProperty(countArgs3);
    if (
      count.presence === ExternalPropertyPresence.Present &&
      count.value !== githubActionsRuns.value.length
    ) {
      errors.push(
        'summary.github_actions_run_count must match github_actions_runs length',
      );
    }
  }
  const mergeAttemptsArgs: ExternalPropertyArgs = {
    record: parsed,
    key: 'merge_attempts',
  };
  const mergeAttempts = externalProperty(mergeAttemptsArgs);
  if (
    summaryProperty.presence === ExternalPropertyPresence.Present &&
    isRecord(summaryProperty.value) &&
    mergeAttempts.presence === ExternalPropertyPresence.Present &&
    Array.isArray(mergeAttempts.value)
  ) {
    const countArgs2: ExternalPropertyArgs = {
      record: summary,
      key: 'merge_attempt_count',
    };
    const count = externalProperty(countArgs2);
    if (
      count.presence === ExternalPropertyPresence.Present &&
      count.value !== mergeAttempts.value.length
    ) {
      errors.push(
        'summary.merge_attempt_count must match merge_attempts length',
      );
    }
  }
  const prRetriggersArgs: ExternalPropertyArgs = {
    record: parsed,
    key: 'pr_retriggers',
  };
  const prRetriggers = externalProperty(prRetriggersArgs);
  if (
    summaryProperty.presence === ExternalPropertyPresence.Present &&
    isRecord(summaryProperty.value) &&
    prRetriggers.presence === ExternalPropertyPresence.Present &&
    Array.isArray(prRetriggers.value)
  ) {
    const countArgs: ExternalPropertyArgs = {
      record: summary,
      key: 'pr_retrigger_count',
    };
    const count = externalProperty(countArgs);
    if (
      count.presence === ExternalPropertyPresence.Present &&
      count.value !== prRetriggers.value.length
    ) {
      errors.push('summary.pr_retrigger_count must match pr_retriggers length');
    }
  }

  return { ok: errors.length === 0, errors };
}

function emptyObject(): ExternalObject {
  return {};
}

function isNonNegativeInt(value: ExternalValue): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
