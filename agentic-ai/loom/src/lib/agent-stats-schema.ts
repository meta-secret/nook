import {
  UntrustedYamlPropertyPresence,
  asUntrustedYamlNode,
  untrustedYamlProperty,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
  isRecord,
} from './guards.ts';

import type { UntrustedYamlPropertyArgs } from './guards.ts';
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

  let parsed: UntrustedYamlNode;
  try {
    parsed = asUntrustedYamlNode(Bun.YAML.parse(content) as UntrustedYamlNode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`YAML parse failed: ${message}`] };
  }

  if (!isRecord(parsed)) {
    return { ok: false, errors: ['root must be a mapping'] };
  }

  const errors: string[] = [];
  const schemaVersionArgs: UntrustedYamlPropertyArgs = {
    record: parsed,
    key: 'schema_version',
  };
  const schemaVersion = untrustedYamlProperty(schemaVersionArgs);
  if (
    schemaVersion.presence === UntrustedYamlPropertyPresence.Absent ||
    schemaVersion.value !== 3
  ) {
    errors.push('schema_version must be 3');
  }

  const sourcePrPropertyArgs: UntrustedYamlPropertyArgs = {
    record: parsed,
    key: 'source_pr',
  };
  const sourcePrProperty = untrustedYamlProperty(sourcePrPropertyArgs);
  const sourcePr =
    sourcePrProperty.presence === UntrustedYamlPropertyPresence.Present &&
    isRecord(sourcePrProperty.value)
      ? sourcePrProperty.value
      : emptyObject();
  if (
    sourcePrProperty.presence === UntrustedYamlPropertyPresence.Absent ||
    !isRecord(sourcePrProperty.value)
  ) {
    errors.push('source_pr must be a mapping');
  } else {
    const numberPropertyArgs: UntrustedYamlPropertyArgs = {
      record: sourcePr,
      key: 'number',
    };
    const numberProperty = untrustedYamlProperty(numberPropertyArgs);
    if (
      numberProperty.presence === UntrustedYamlPropertyPresence.Absent ||
      numberProperty.value !== expectedPrNumber
    ) {
      errors.push(
        `source_pr.number (${String(
          numberProperty.presence === UntrustedYamlPropertyPresence.Present
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
      const propertyArgs5: UntrustedYamlPropertyArgs = {
        record: sourcePr,
        key: key,
      };
      const property = untrustedYamlProperty(propertyArgs5);
      if (
        property.presence === UntrustedYamlPropertyPresence.Absent ||
        typeof property.value !== 'string' ||
        property.value === ''
      ) {
        errors.push(`source_pr.${key} must be a non-empty string`);
      }
    }
    for (const key of ['elapsed_seconds', 'open_to_merge_seconds'] as const) {
      const propertyArgs4: UntrustedYamlPropertyArgs = {
        record: sourcePr,
        key: key,
      };
      const property = untrustedYamlProperty(propertyArgs4);
      if (
        property.presence === UntrustedYamlPropertyPresence.Absent ||
        !isNonNegativeInt(property.value)
      ) {
        errors.push(`source_pr.${key} must be a non-negative integer`);
      }
    }
  }

  const summaryPropertyArgs: UntrustedYamlPropertyArgs = {
    record: parsed,
    key: 'summary',
  };
  const summaryProperty = untrustedYamlProperty(summaryPropertyArgs);
  const summary =
    summaryProperty.presence === UntrustedYamlPropertyPresence.Present &&
    isRecord(summaryProperty.value)
      ? summaryProperty.value
      : emptyObject();
  if (
    summaryProperty.presence === UntrustedYamlPropertyPresence.Absent ||
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
      const propertyArgs3: UntrustedYamlPropertyArgs = {
        record: summary,
        key: key,
      };
      const property = untrustedYamlProperty(propertyArgs3);
      if (
        property.presence === UntrustedYamlPropertyPresence.Absent ||
        !isNonNegativeInt(property.value)
      ) {
        errors.push(`summary.${key} must be a non-negative integer`);
      }
    }
  }

  const inventoryPropertyArgs: UntrustedYamlPropertyArgs = {
    record: parsed,
    key: 'test_inventory',
  };
  const inventoryProperty = untrustedYamlProperty(inventoryPropertyArgs);
  const inventory =
    inventoryProperty.presence === UntrustedYamlPropertyPresence.Present &&
    isRecord(inventoryProperty.value)
      ? inventoryProperty.value
      : emptyObject();
  if (
    inventoryProperty.presence === UntrustedYamlPropertyPresence.Absent ||
    !isRecord(inventoryProperty.value)
  ) {
    errors.push('test_inventory must be a mapping');
  } else {
    const measuredAtArgs: UntrustedYamlPropertyArgs = {
      record: inventory,
      key: 'measured_at',
    };
    const measuredAt = untrustedYamlProperty(measuredAtArgs);
    if (
      measuredAt.presence === UntrustedYamlPropertyPresence.Absent ||
      typeof measuredAt.value !== 'string'
    ) {
      errors.push('test_inventory.measured_at must be a string');
    }
    const inventoryHeadShaArgs: UntrustedYamlPropertyArgs = {
      record: inventory,
      key: 'head_sha',
    };
    const inventoryHeadSha = untrustedYamlProperty(inventoryHeadShaArgs);
    if (
      inventoryHeadSha.presence === UntrustedYamlPropertyPresence.Absent ||
      typeof inventoryHeadSha.value !== 'string'
    ) {
      errors.push('test_inventory.head_sha must be a string');
    }
    const sourceHeadShaArgs: UntrustedYamlPropertyArgs = {
      record: sourcePr,
      key: 'head_sha',
    };
    const sourceHeadSha = untrustedYamlProperty(sourceHeadShaArgs);
    if (
      sourcePrProperty.presence === UntrustedYamlPropertyPresence.Present &&
      isRecord(sourcePrProperty.value) &&
      sourceHeadSha.presence === UntrustedYamlPropertyPresence.Present &&
      typeof sourceHeadSha.value === 'string' &&
      inventoryHeadSha.presence === UntrustedYamlPropertyPresence.Present &&
      inventoryHeadSha.value !== sourceHeadSha.value
    ) {
      errors.push('test_inventory.head_sha must match source_pr.head_sha');
    }
    const byTypePropertyArgs: UntrustedYamlPropertyArgs = {
      record: inventory,
      key: 'by_type',
    };
    const byTypeProperty = untrustedYamlProperty(byTypePropertyArgs);
    if (
      byTypeProperty.presence === UntrustedYamlPropertyPresence.Absent ||
      !isRecord(byTypeProperty.value)
    ) {
      errors.push('test_inventory.by_type must be a mapping');
    } else {
      const byType = byTypeProperty.value;
      let sum = 0;
      for (const key of ['rust', 'preflight', 'web_unit', 'e2e'] as const) {
        const propertyArgs2: UntrustedYamlPropertyArgs = {
          record: byType,
          key: key,
        };
        const property = untrustedYamlProperty(propertyArgs2);
        if (
          property.presence === UntrustedYamlPropertyPresence.Absent ||
          !isNonNegativeInt(property.value)
        ) {
          errors.push(
            `test_inventory.by_type.${key} must be a non-negative integer`,
          );
        } else if (typeof property.value === 'number') {
          sum += property.value;
        }
      }
      const totalPropertyArgs: UntrustedYamlPropertyArgs = {
        record: inventory,
        key: 'total',
      };
      const totalProperty = untrustedYamlProperty(totalPropertyArgs);
      if (
        totalProperty.presence === UntrustedYamlPropertyPresence.Present &&
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
    const propertyArgs: UntrustedYamlPropertyArgs = {
      record: parsed,
      key: key,
    };
    const property = untrustedYamlProperty(propertyArgs);
    if (
      property.presence === UntrustedYamlPropertyPresence.Absent ||
      !Array.isArray(property.value)
    ) {
      errors.push(`${key} must be a list`);
    }
  }

  const comparisonArgs: UntrustedYamlPropertyArgs = {
    record: parsed,
    key: 'comparison',
  };
  const comparison = untrustedYamlProperty(comparisonArgs);
  if (
    comparison.presence === UntrustedYamlPropertyPresence.Absent ||
    !isRecord(comparison.value)
  ) {
    errors.push('comparison must be a mapping');
  }
  const wasteAssessmentArgs: UntrustedYamlPropertyArgs = {
    record: parsed,
    key: 'waste_assessment',
  };
  const wasteAssessment = untrustedYamlProperty(wasteAssessmentArgs);
  if (
    wasteAssessment.presence === UntrustedYamlPropertyPresence.Absent ||
    !isRecord(wasteAssessment.value)
  ) {
    errors.push('waste_assessment must be a mapping');
  }
  const cacheTelemetryArgs: UntrustedYamlPropertyArgs = {
    record: parsed,
    key: 'cache_telemetry',
  };
  const cacheTelemetry = untrustedYamlProperty(cacheTelemetryArgs);
  if (
    cacheTelemetry.presence === UntrustedYamlPropertyPresence.Absent ||
    !isRecord(cacheTelemetry.value)
  ) {
    errors.push('cache_telemetry must be a mapping');
  }

  const localExecutionsArgs: UntrustedYamlPropertyArgs = {
    record: parsed,
    key: 'local_executions',
  };
  const localExecutions = untrustedYamlProperty(localExecutionsArgs);
  if (
    summaryProperty.presence === UntrustedYamlPropertyPresence.Present &&
    isRecord(summaryProperty.value) &&
    localExecutions.presence === UntrustedYamlPropertyPresence.Present &&
    Array.isArray(localExecutions.value)
  ) {
    const countArgs4: UntrustedYamlPropertyArgs = {
      record: summary,
      key: 'local_execution_count',
    };
    const count = untrustedYamlProperty(countArgs4);
    if (
      count.presence === UntrustedYamlPropertyPresence.Present &&
      count.value !== localExecutions.value.length
    ) {
      errors.push(
        'summary.local_execution_count must match local_executions length',
      );
    }
  }
  const githubActionsRunsArgs: UntrustedYamlPropertyArgs = {
    record: parsed,
    key: 'github_actions_runs',
  };
  const githubActionsRuns = untrustedYamlProperty(githubActionsRunsArgs);
  if (
    summaryProperty.presence === UntrustedYamlPropertyPresence.Present &&
    isRecord(summaryProperty.value) &&
    githubActionsRuns.presence === UntrustedYamlPropertyPresence.Present &&
    Array.isArray(githubActionsRuns.value)
  ) {
    const countArgs3: UntrustedYamlPropertyArgs = {
      record: summary,
      key: 'github_actions_run_count',
    };
    const count = untrustedYamlProperty(countArgs3);
    if (
      count.presence === UntrustedYamlPropertyPresence.Present &&
      count.value !== githubActionsRuns.value.length
    ) {
      errors.push(
        'summary.github_actions_run_count must match github_actions_runs length',
      );
    }
  }
  const mergeAttemptsArgs: UntrustedYamlPropertyArgs = {
    record: parsed,
    key: 'merge_attempts',
  };
  const mergeAttempts = untrustedYamlProperty(mergeAttemptsArgs);
  if (
    summaryProperty.presence === UntrustedYamlPropertyPresence.Present &&
    isRecord(summaryProperty.value) &&
    mergeAttempts.presence === UntrustedYamlPropertyPresence.Present &&
    Array.isArray(mergeAttempts.value)
  ) {
    const countArgs2: UntrustedYamlPropertyArgs = {
      record: summary,
      key: 'merge_attempt_count',
    };
    const count = untrustedYamlProperty(countArgs2);
    if (
      count.presence === UntrustedYamlPropertyPresence.Present &&
      count.value !== mergeAttempts.value.length
    ) {
      errors.push(
        'summary.merge_attempt_count must match merge_attempts length',
      );
    }
  }
  const prRetriggersArgs: UntrustedYamlPropertyArgs = {
    record: parsed,
    key: 'pr_retriggers',
  };
  const prRetriggers = untrustedYamlProperty(prRetriggersArgs);
  if (
    summaryProperty.presence === UntrustedYamlPropertyPresence.Present &&
    isRecord(summaryProperty.value) &&
    prRetriggers.presence === UntrustedYamlPropertyPresence.Present &&
    Array.isArray(prRetriggers.value)
  ) {
    const countArgs: UntrustedYamlPropertyArgs = {
      record: summary,
      key: 'pr_retrigger_count',
    };
    const count = untrustedYamlProperty(countArgs);
    if (
      count.presence === UntrustedYamlPropertyPresence.Present &&
      count.value !== prRetriggers.value.length
    ) {
      errors.push('summary.pr_retrigger_count must match pr_retriggers length');
    }
  }

  return { ok: errors.length === 0, errors };
}

function emptyObject(): UntrustedYamlMap {
  return {};
}

function isNonNegativeInt(value: UntrustedYamlNode): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
