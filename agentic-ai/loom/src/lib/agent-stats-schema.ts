import {
  UntrustedYamlPropertyPresence,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from './guards.ts';

import {
  type ValidateHeadActionTotalsRequest,
  HeadActionTotalsSchema,
} from './agent-stats-schema-actions.ts';

import {
  type ValidateReviewEventsRequest,
  ReviewEventSchema,
} from './agent-stats-schema-review.ts';

import { ValidationCycleHistory } from './agent-stats-validation-cycles.ts';

import type { UntrustedYamlPropertyArgs } from './guards.ts';

export class AgentStatisticsSchema {
  private constructor(private readonly request: ValidateAgentStatsYamlArgs) {}
  static validate(args: ValidateAgentStatsYamlArgs): AgentStatsValidation {
    return new AgentStatisticsSchema(args).execute();
  }
  private execute(): AgentStatsValidation {
    const args = this.request;
    const { content, expectedPrNumber } = args;

    let parsed: UntrustedYamlNode;
    try {
      parsed = UntrustedYamlBoundary.fromHost(
        Bun.YAML.parse(content) as UntrustedYamlNode,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, errors: [`YAML parse failed: ${message}`] };
    }

    if (!UntrustedYamlBoundary.isRecord(parsed)) {
      return { ok: false, errors: ['root must be a mapping'] };
    }

    const errors: string[] = [];
    const schemaVersionArgs: UntrustedYamlPropertyArgs = {
      record: parsed,
      key: 'schema_version',
    };
    const schemaVersion = UntrustedYamlBoundary.property(schemaVersionArgs);
    const isSchemaV4 =
      schemaVersion.presence === UntrustedYamlPropertyPresence.Present &&
      schemaVersion.value === 4;
    if (
      schemaVersion.presence === UntrustedYamlPropertyPresence.Absent ||
      (schemaVersion.value !== 3 && schemaVersion.value !== 4)
    ) {
      errors.push('schema_version must be 3 or 4');
    }

    const sourcePrPropertyArgs: UntrustedYamlPropertyArgs = {
      record: parsed,
      key: 'source_pr',
    };
    const sourcePrProperty =
      UntrustedYamlBoundary.property(sourcePrPropertyArgs);
    const sourcePr =
      sourcePrProperty.presence === UntrustedYamlPropertyPresence.Present &&
      UntrustedYamlBoundary.isRecord(sourcePrProperty.value)
        ? sourcePrProperty.value
        : this.emptyObject();
    if (
      sourcePrProperty.presence === UntrustedYamlPropertyPresence.Absent ||
      !UntrustedYamlBoundary.isRecord(sourcePrProperty.value)
    ) {
      errors.push('source_pr must be a mapping');
    } else {
      const numberPropertyArgs: UntrustedYamlPropertyArgs = {
        record: sourcePr,
        key: 'number',
      };
      const numberProperty = UntrustedYamlBoundary.property(numberPropertyArgs);
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
      const sourceStringKeys = [
        'url',
        'title',
        'change_surface',
        'head_sha',
        'started_at',
        'opened_at',
        'merged_at',
        ...(isSchemaV4 ? ['merge_sha'] : []),
      ];
      for (const key of sourceStringKeys) {
        const propertyArgs5: UntrustedYamlPropertyArgs = {
          record: sourcePr,
          key: key,
        };
        const property = UntrustedYamlBoundary.property(propertyArgs5);
        if (
          property.presence === UntrustedYamlPropertyPresence.Absent ||
          typeof property.value !== 'string' ||
          property.value === ''
        ) {
          errors.push(`source_pr.${key} must be a non-empty string`);
        }
      }
      if (isSchemaV4) {
        for (const key of ['head_sha', 'merge_sha'] as const) {
          const shaArgs: UntrustedYamlPropertyArgs = { record: sourcePr, key };
          const sha = UntrustedYamlBoundary.property(shaArgs);
          if (
            sha.presence === UntrustedYamlPropertyPresence.Present &&
            typeof sha.value === 'string' &&
            !/^[0-9a-f]{40}$/.test(sha.value)
          ) {
            errors.push(`source_pr.${key} must be a full SHA`);
          }
        }
        const headShaRequest: PropertyRequest = {
          record: sourcePr,
          key: 'head_sha',
        };
        const mergeShaRequest: PropertyRequest = {
          record: sourcePr,
          key: 'merge_sha',
        };
        const headSha = this.stringProperty(headShaRequest);
        const mergeSha = this.stringProperty(mergeShaRequest);
        if (headSha.length > 0 && headSha === mergeSha) {
          errors.push(
            'source_pr.head_sha must differ from source_pr.merge_sha',
          );
        }
      }
      for (const key of ['elapsed_seconds', 'open_to_merge_seconds'] as const) {
        const propertyArgs4: UntrustedYamlPropertyArgs = {
          record: sourcePr,
          key: key,
        };
        const property = UntrustedYamlBoundary.property(propertyArgs4);
        if (
          property.presence === UntrustedYamlPropertyPresence.Absent ||
          !this.isNonNegativeInt(property.value)
        ) {
          errors.push(`source_pr.${key} must be a non-negative integer`);
        }
      }
    }

    const summaryPropertyArgs: UntrustedYamlPropertyArgs = {
      record: parsed,
      key: 'summary',
    };
    const summaryProperty = UntrustedYamlBoundary.property(summaryPropertyArgs);
    const summary =
      summaryProperty.presence === UntrustedYamlPropertyPresence.Present &&
      UntrustedYamlBoundary.isRecord(summaryProperty.value)
        ? summaryProperty.value
        : this.emptyObject();
    if (
      summaryProperty.presence === UntrustedYamlPropertyPresence.Absent ||
      !UntrustedYamlBoundary.isRecord(summaryProperty.value)
    ) {
      errors.push('summary must be a mapping');
    } else {
      const summaryKeys = [
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
        ...(isSchemaV4
          ? [
              'delivery_head_count',
              'review_request_count',
              'review_finding_batch_count',
              'review_finding_count',
              'validation_cycle_count',
              'obsolete_validation_seconds',
              'obsolete_validation_count',
              'cancelled_validation_seconds',
              'cancelled_validation_count',
            ]
          : []),
      ];
      for (const key of summaryKeys) {
        const propertyArgs3: UntrustedYamlPropertyArgs = {
          record: summary,
          key: key,
        };
        const property = UntrustedYamlBoundary.property(propertyArgs3);
        if (
          property.presence === UntrustedYamlPropertyPresence.Absent ||
          !this.isNonNegativeInt(property.value)
        ) {
          errors.push(`summary.${key} must be a non-negative integer`);
        }
      }
    }

    const inventoryPropertyArgs: UntrustedYamlPropertyArgs = {
      record: parsed,
      key: 'test_inventory',
    };
    const inventoryProperty = UntrustedYamlBoundary.property(
      inventoryPropertyArgs,
    );
    const inventory =
      inventoryProperty.presence === UntrustedYamlPropertyPresence.Present &&
      UntrustedYamlBoundary.isRecord(inventoryProperty.value)
        ? inventoryProperty.value
        : this.emptyObject();
    if (
      inventoryProperty.presence === UntrustedYamlPropertyPresence.Absent ||
      !UntrustedYamlBoundary.isRecord(inventoryProperty.value)
    ) {
      errors.push('test_inventory must be a mapping');
    } else {
      const measuredAtArgs: UntrustedYamlPropertyArgs = {
        record: inventory,
        key: 'measured_at',
      };
      const measuredAt = UntrustedYamlBoundary.property(measuredAtArgs);
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
      const inventoryHeadSha =
        UntrustedYamlBoundary.property(inventoryHeadShaArgs);
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
      const sourceHeadSha = UntrustedYamlBoundary.property(sourceHeadShaArgs);
      if (
        sourcePrProperty.presence === UntrustedYamlPropertyPresence.Present &&
        UntrustedYamlBoundary.isRecord(sourcePrProperty.value) &&
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
      const byTypeProperty = UntrustedYamlBoundary.property(byTypePropertyArgs);
      if (
        byTypeProperty.presence === UntrustedYamlPropertyPresence.Absent ||
        !UntrustedYamlBoundary.isRecord(byTypeProperty.value)
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
          const property = UntrustedYamlBoundary.property(propertyArgs2);
          if (
            property.presence === UntrustedYamlPropertyPresence.Absent ||
            !this.isNonNegativeInt(property.value)
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
        const totalProperty = UntrustedYamlBoundary.property(totalPropertyArgs);
        if (
          totalProperty.presence === UntrustedYamlPropertyPresence.Present &&
          this.isNonNegativeInt(totalProperty.value) &&
          totalProperty.value !== sum
        ) {
          errors.push('test_inventory.total must equal the sum of by_type');
        }
      }
    }

    const detailListKeys = [
      'local_executions',
      'github_actions_runs',
      'pr_retriggers',
      'merge_attempts',
      ...(isSchemaV4
        ? ['delivery_heads', 'review_events', 'validation_cycles']
        : []),
    ];
    for (const key of detailListKeys) {
      const propertyArgs: UntrustedYamlPropertyArgs = {
        record: parsed,
        key: key,
      };
      const property = UntrustedYamlBoundary.property(propertyArgs);
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
    const comparison = UntrustedYamlBoundary.property(comparisonArgs);
    if (
      comparison.presence === UntrustedYamlPropertyPresence.Absent ||
      !UntrustedYamlBoundary.isRecord(comparison.value)
    ) {
      errors.push('comparison must be a mapping');
    }
    const wasteAssessmentArgs: UntrustedYamlPropertyArgs = {
      record: parsed,
      key: 'waste_assessment',
    };
    const wasteAssessment = UntrustedYamlBoundary.property(wasteAssessmentArgs);
    if (
      wasteAssessment.presence === UntrustedYamlPropertyPresence.Absent ||
      !UntrustedYamlBoundary.isRecord(wasteAssessment.value)
    ) {
      errors.push('waste_assessment must be a mapping');
    }
    const cacheTelemetryArgs: UntrustedYamlPropertyArgs = {
      record: parsed,
      key: 'cache_telemetry',
    };
    const cacheTelemetry = UntrustedYamlBoundary.property(cacheTelemetryArgs);
    if (
      cacheTelemetry.presence === UntrustedYamlPropertyPresence.Absent ||
      !UntrustedYamlBoundary.isRecord(cacheTelemetry.value)
    ) {
      errors.push('cache_telemetry must be a mapping');
    }

    const localExecutionsArgs: UntrustedYamlPropertyArgs = {
      record: parsed,
      key: 'local_executions',
    };
    const localExecutions = UntrustedYamlBoundary.property(localExecutionsArgs);
    if (
      summaryProperty.presence === UntrustedYamlPropertyPresence.Present &&
      UntrustedYamlBoundary.isRecord(summaryProperty.value) &&
      localExecutions.presence === UntrustedYamlPropertyPresence.Present &&
      Array.isArray(localExecutions.value)
    ) {
      const countArgs4: UntrustedYamlPropertyArgs = {
        record: summary,
        key: 'local_execution_count',
      };
      const count = UntrustedYamlBoundary.property(countArgs4);
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
    const githubActionsRuns = UntrustedYamlBoundary.property(
      githubActionsRunsArgs,
    );
    if (
      summaryProperty.presence === UntrustedYamlPropertyPresence.Present &&
      UntrustedYamlBoundary.isRecord(summaryProperty.value) &&
      githubActionsRuns.presence === UntrustedYamlPropertyPresence.Present &&
      Array.isArray(githubActionsRuns.value)
    ) {
      const countArgs3: UntrustedYamlPropertyArgs = {
        record: summary,
        key: 'github_actions_run_count',
      };
      const count = UntrustedYamlBoundary.property(countArgs3);
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
    const mergeAttempts = UntrustedYamlBoundary.property(mergeAttemptsArgs);
    if (
      summaryProperty.presence === UntrustedYamlPropertyPresence.Present &&
      UntrustedYamlBoundary.isRecord(summaryProperty.value) &&
      mergeAttempts.presence === UntrustedYamlPropertyPresence.Present &&
      Array.isArray(mergeAttempts.value)
    ) {
      const countArgs2: UntrustedYamlPropertyArgs = {
        record: summary,
        key: 'merge_attempt_count',
      };
      const count = UntrustedYamlBoundary.property(countArgs2);
      if (
        count.presence === UntrustedYamlPropertyPresence.Present &&
        count.value !== mergeAttempts.value.length
      ) {
        errors.push(
          'summary.merge_attempt_count must match merge_attempts length',
        );
      }
    }
    if (isSchemaV4) {
      const evidenceRequest: ValidateEvidenceEntriesArgs = {
        parsed,
        sourcePr,
        errors,
      };
      const derivedRequest: ValidateDerivedDeliveryEvidenceArgs = {
        parsed,
        summary,
        errors,
      };
      this.validateEvidenceEntries(evidenceRequest);
      this.validateDerivedDeliveryEvidence(derivedRequest);
    } else {
      const legacyRequest: ValidateLegacyRetriggerCountArgs = {
        parsed,
        summary,
        errors,
      };
      this.validateLegacyRetriggerCount(legacyRequest);
    }

    return { ok: errors.length === 0, errors };
  }

  private validateLegacyRetriggerCount(
    args: ValidateLegacyRetriggerCountArgs,
  ): void {
    const retriggerRequest: PropertyRequest = {
      record: args.parsed,
      key: 'pr_retriggers',
    };
    const countRequest: PropertyRequest = {
      record: args.summary,
      key: 'pr_retrigger_count',
    };
    const retriggers = this.listProperty(retriggerRequest);
    const actual = this.numberProperty(countRequest);
    if (actual !== retriggers.length) {
      args.errors.push(
        'summary.pr_retrigger_count must match pr_retriggers length',
      );
    }
  }

  private validateEvidenceEntries(args: ValidateEvidenceEntriesArgs): void {
    const sourceHeadArgs: PropertyRequest = {
      record: args.sourcePr,
      key: 'head_sha',
    };
    const sourceHeadSha = this.stringProperty(sourceHeadArgs);
    const headsArgs: PropertyRequest = {
      record: args.parsed,
      key: 'delivery_heads',
    };
    const heads = this.listProperty(headsArgs);
    const actionTotalsRequest: ValidateHeadActionTotalsRequest = {
      parsed: args.parsed,
      deliveryHeads: heads,
      errors: args.errors,
    };
    HeadActionTotalsSchema.validate(actionTotalsRequest);
    const knownHeads = new Set<string>();
    let finalHeadCount = 0;
    for (const [index, item] of heads.entries()) {
      if (!UntrustedYamlBoundary.isRecord(item)) {
        args.errors.push(`delivery_heads[${index}] must be a mapping`);
        continue;
      }
      const headShaArgs: EvidencePropertyArgs = {
        record: item,
        key: 'head_sha',
        path: `delivery_heads[${index}].head_sha`,
        errors: args.errors,
      };
      const headSha = this.evidenceString(headShaArgs);
      if (!/^[0-9a-f]{40}$/.test(headSha)) {
        args.errors.push(
          `delivery_heads[${index}].head_sha must be a full SHA`,
        );
      }
      if (knownHeads.has(headSha)) {
        args.errors.push(`delivery_heads[${index}].head_sha must be unique`);
      }
      knownHeads.add(headSha);
      const firstObservedArgs: EvidencePropertyArgs = {
        record: item,
        key: 'first_observed_at',
        path: `delivery_heads[${index}].first_observed_at`,
        errors: args.errors,
      };
      this.validateEvidenceTimestamp(firstObservedArgs);
      const lastObservedArgs: EvidencePropertyArgs = {
        record: item,
        key: 'last_observed_at',
        path: `delivery_heads[${index}].last_observed_at`,
        errors: args.errors,
      };
      this.validateEvidenceTimestamp(lastObservedArgs);
      const finalArgs: UntrustedYamlPropertyArgs = {
        record: item,
        key: 'final',
      };
      const finalProperty = UntrustedYamlBoundary.property(finalArgs);
      if (
        finalProperty.presence === UntrustedYamlPropertyPresence.Absent ||
        typeof finalProperty.value !== 'boolean'
      ) {
        args.errors.push(`delivery_heads[${index}].final must be a boolean`);
      } else if (finalProperty.value) {
        finalHeadCount += 1;
        if (headSha !== sourceHeadSha) {
          args.errors.push(
            'the final delivery head must match source_pr.head_sha',
          );
        }
      }
      for (const key of [
        'action_run_count',
        'action_seconds',
        'obsolete_action_seconds',
      ] as const) {
        const integerArgs: EvidencePropertyArgs = {
          record: item,
          key,
          path: `delivery_heads[${index}].${key}`,
          errors: args.errors,
        };
        this.validateEvidenceInteger(integerArgs);
      }
    }
    if (finalHeadCount !== 1) {
      args.errors.push('delivery_heads must contain exactly one final head');
    }

    const reviewEntriesArgs: ValidateReviewEventsRequest = {
      parsed: args.parsed,
      knownHeads,
      errors: args.errors,
    };
    ReviewEventSchema.validate(reviewEntriesArgs);
    const validationEntriesArgs: ValidateHeadLinkedEntriesArgs = {
      parsed: args.parsed,
      knownHeads,
      errors: args.errors,
    };
    this.validateValidationEntries(validationEntriesArgs);
  }

  private validateValidationEntries(args: ValidateHeadLinkedEntriesArgs): void {
    const listArgs: PropertyRequest = {
      record: args.parsed,
      key: 'validation_cycles',
    };
    const items = this.listProperty(listArgs);
    for (const [index, item] of items.entries()) {
      if (!UntrustedYamlBoundary.isRecord(item)) {
        args.errors.push(`validation_cycles[${index}] must be a mapping`);
        continue;
      }
      const linkedHeadArgs: ValidateLinkedHeadArgs = {
        record: item,
        path: `validation_cycles[${index}].head_sha`,
        knownHeads: args.knownHeads,
        errors: args.errors,
      };
      this.validateLinkedHead(linkedHeadArgs);
      for (const key of ['started_at', 'finished_at'] as const) {
        const timestampArgs: EvidencePropertyArgs = {
          record: item,
          key,
          path: `validation_cycles[${index}].${key}`,
          errors: args.errors,
        };
        this.validateEvidenceTimestamp(timestampArgs);
      }
      for (const key of [
        'run_id',
        'run_attempt',
        'duration_seconds',
        'obsolete_seconds',
      ] as const) {
        const integerArgs: EvidencePropertyArgs = {
          record: item,
          key,
          path: `validation_cycles[${index}].${key}`,
          errors: args.errors,
        };
        this.validateEvidenceInteger(integerArgs);
      }
      const conclusionArgs: EvidencePropertyArgs = {
        record: item,
        key: 'conclusion',
        path: `validation_cycles[${index}].conclusion`,
        errors: args.errors,
      };
      this.evidenceString(conclusionArgs);
      const workflowArgs: EvidencePropertyArgs = {
        record: item,
        key: 'workflow',
        path: `validation_cycles[${index}].workflow`,
        errors: args.errors,
      };
      this.evidenceString(workflowArgs);
    }
  }

  private evidenceString(args: EvidencePropertyArgs): string {
    const propertyArgs: UntrustedYamlPropertyArgs = {
      record: args.record,
      key: args.key,
    };
    const property = UntrustedYamlBoundary.property(propertyArgs);
    if (
      property.presence === UntrustedYamlPropertyPresence.Absent ||
      typeof property.value !== 'string' ||
      property.value.length === 0
    ) {
      args.errors.push(`${args.path} must be a non-empty string`);
      return '';
    }
    return property.value;
  }

  private validateEvidenceTimestamp(args: EvidencePropertyArgs): void {
    const value = this.evidenceString(args);
    if (value.length > 0 && Number.isNaN(Date.parse(value))) {
      args.errors.push(`${args.path} must be a timestamp`);
    }
  }

  private validateEvidenceInteger(args: EvidencePropertyArgs): void {
    const propertyArgs: UntrustedYamlPropertyArgs = {
      record: args.record,
      key: args.key,
    };
    const property = UntrustedYamlBoundary.property(propertyArgs);
    if (
      property.presence === UntrustedYamlPropertyPresence.Absent ||
      !this.isNonNegativeInt(property.value)
    ) {
      args.errors.push(`${args.path} must be a non-negative integer`);
    }
  }

  private validateLinkedHead(args: ValidateLinkedHeadArgs): void {
    const headArgs: EvidencePropertyArgs = {
      record: args.record,
      key: 'head_sha',
      path: args.path,
      errors: args.errors,
    };
    const headSha = this.evidenceString(headArgs);
    if (headSha.length > 0 && !args.knownHeads.has(headSha)) {
      args.errors.push(`${args.path} must reference a delivery head`);
    }
  }

  private validateDerivedDeliveryEvidence(
    args: ValidateDerivedDeliveryEvidenceArgs,
  ): void {
    const deliveryHeadsArgs: PropertyRequest = {
      record: args.parsed,
      key: 'delivery_heads',
    };
    const deliveryHeads = this.listProperty(deliveryHeadsArgs);
    const reviewEventsArgs: PropertyRequest = {
      record: args.parsed,
      key: 'review_events',
    };
    const reviewEvents = this.listProperty(reviewEventsArgs);
    const validationCyclesArgs: PropertyRequest = {
      record: args.parsed,
      key: 'validation_cycles',
    };
    const validationCycles = this.listProperty(validationCyclesArgs);
    const deliveryCountArgs: ValidateSummaryCountArgs = {
      summary: args.summary,
      key: 'delivery_head_count',
      expected: deliveryHeads.length,
      detailKey: 'delivery_heads',
      errors: args.errors,
    };
    this.validateSummaryCount(deliveryCountArgs);
    const validationCountArgs: ValidateSummaryCountArgs = {
      summary: args.summary,
      key: 'validation_cycle_count',
      expected: validationCycles.length,
      detailKey: 'validation_cycles',
      errors: args.errors,
    };
    this.validateSummaryCount(validationCountArgs);
    const retriggerCountArgs: ValidateSummaryCountArgs = {
      summary: args.summary,
      key: 'pr_retrigger_count',
      expected: ValidationCycleHistory.countRetriggers(
        validationCycles.filter(UntrustedYamlBoundary.isRecord),
      ),
      detailKey: 'validation_cycles repeated within each workflow',
      errors: args.errors,
    };
    this.validateSummaryCount(retriggerCountArgs);

    let findingBatchCount = 0;
    let findingCount = 0;
    let reviewRequestCount = 0;
    for (const item of reviewEvents) {
      if (!UntrustedYamlBoundary.isRecord(item)) continue;
      const requestedArgs: UntrustedYamlPropertyArgs = {
        record: item,
        key: 'requested',
      };
      const requested = UntrustedYamlBoundary.property(requestedArgs);
      if (
        requested.presence === UntrustedYamlPropertyPresence.Present &&
        requested.value === true
      ) {
        reviewRequestCount += 1;
      }
      const outcomeArgs: PropertyRequest = { record: item, key: 'outcome' };
      const outcome = this.stringProperty(outcomeArgs);
      if (outcome !== 'findings') continue;
      findingBatchCount += 1;
      const findingCountArgs: PropertyRequest = {
        record: item,
        key: 'finding_count',
      };
      findingCount += this.numberProperty(findingCountArgs);
    }
    const reviewRequestArgs: ValidateSummaryCountArgs = {
      summary: args.summary,
      key: 'review_request_count',
      expected: reviewRequestCount,
      detailKey: 'requested review_events',
      errors: args.errors,
    };
    this.validateSummaryCount(reviewRequestArgs);
    const findingBatchArgs: ValidateSummaryCountArgs = {
      summary: args.summary,
      key: 'review_finding_batch_count',
      expected: findingBatchCount,
      detailKey: 'review_events findings',
      errors: args.errors,
    };
    this.validateSummaryCount(findingBatchArgs);
    const findingCountSummaryArgs: ValidateSummaryCountArgs = {
      summary: args.summary,
      key: 'review_finding_count',
      expected: findingCount,
      detailKey: 'review_events finding_count sum',
      errors: args.errors,
    };
    this.validateSummaryCount(findingCountSummaryArgs);

    let obsoleteSeconds = 0;
    let obsoleteCount = 0;
    let cancelledSeconds = 0;
    let cancelledCount = 0;
    for (const item of validationCycles) {
      if (!UntrustedYamlBoundary.isRecord(item)) continue;
      const obsoleteArgs: PropertyRequest = {
        record: item,
        key: 'obsolete_seconds',
      };
      const cycleObsoleteSeconds = this.numberProperty(obsoleteArgs);
      obsoleteSeconds += cycleObsoleteSeconds;
      if (cycleObsoleteSeconds > 0) obsoleteCount += 1;
      const conclusionArgs: PropertyRequest = {
        record: item,
        key: 'conclusion',
      };
      const conclusion = this.stringProperty(conclusionArgs);
      if (conclusion === 'cancelled') {
        cancelledCount += 1;
        const durationArgs: PropertyRequest = {
          record: item,
          key: 'duration_seconds',
        };
        cancelledSeconds += this.numberProperty(durationArgs);
      }
    }
    const obsoleteSummaryArgs: ValidateSummaryCountArgs = {
      summary: args.summary,
      key: 'obsolete_validation_seconds',
      expected: obsoleteSeconds,
      detailKey: 'validation_cycles obsolete_seconds sum',
      errors: args.errors,
    };
    this.validateSummaryCount(obsoleteSummaryArgs);
    const obsoleteCountArgs: ValidateSummaryCountArgs = {
      summary: args.summary,
      key: 'obsolete_validation_count',
      expected: obsoleteCount,
      detailKey: 'validation_cycles with obsolete seconds',
      errors: args.errors,
    };
    this.validateSummaryCount(obsoleteCountArgs);
    const cancelledSummaryArgs: ValidateSummaryCountArgs = {
      summary: args.summary,
      key: 'cancelled_validation_seconds',
      expected: cancelledSeconds,
      detailKey: 'cancelled validation_cycles duration_seconds sum',
      errors: args.errors,
    };
    this.validateSummaryCount(cancelledSummaryArgs);
    const cancelledCountArgs: ValidateSummaryCountArgs = {
      summary: args.summary,
      key: 'cancelled_validation_count',
      expected: cancelledCount,
      detailKey: 'cancelled validation_cycles',
      errors: args.errors,
    };
    this.validateSummaryCount(cancelledCountArgs);
  }

  private listProperty(request: PropertyRequest): readonly UntrustedYamlNode[] {
    const propertyArgs: UntrustedYamlPropertyArgs = request;
    const property = UntrustedYamlBoundary.property(propertyArgs);
    return property.presence === UntrustedYamlPropertyPresence.Present &&
      Array.isArray(property.value)
      ? property.value
      : [];
  }

  private stringProperty(request: PropertyRequest): string {
    const propertyArgs: UntrustedYamlPropertyArgs = request;
    const property = UntrustedYamlBoundary.property(propertyArgs);
    return property.presence === UntrustedYamlPropertyPresence.Present &&
      typeof property.value === 'string'
      ? property.value
      : '';
  }

  private numberProperty(request: PropertyRequest): number {
    const propertyArgs: UntrustedYamlPropertyArgs = request;
    const property = UntrustedYamlBoundary.property(propertyArgs);
    return property.presence === UntrustedYamlPropertyPresence.Present &&
      typeof property.value === 'number'
      ? property.value
      : 0;
  }

  private validateSummaryCount(args: ValidateSummaryCountArgs): void {
    const propertyArgs: PropertyRequest = {
      record: args.summary,
      key: args.key,
    };
    const actual = this.numberProperty(propertyArgs);
    if (actual !== args.expected) {
      args.errors.push(
        `summary.${args.key} must match ${args.detailKey} (${args.expected})`,
      );
    }
  }

  private emptyObject(): UntrustedYamlMap {
    return {};
  }

  private isNonNegativeInt(value: UntrustedYamlNode): boolean {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
  }
}

export type AgentStatsValidation = {
  readonly ok: boolean;
  readonly errors: string[];
};

export type ValidateAgentStatsYamlArgs = {
  readonly content: string;
  readonly expectedPrNumber: number;
};

type ValidateLegacyRetriggerCountArgs = {
  readonly parsed: UntrustedYamlMap;
  readonly summary: UntrustedYamlMap;
  readonly errors: string[];
};

type ValidateEvidenceEntriesArgs = {
  readonly parsed: UntrustedYamlMap;
  readonly sourcePr: UntrustedYamlMap;
  readonly errors: string[];
};

type ValidateHeadLinkedEntriesArgs = {
  readonly parsed: UntrustedYamlMap;
  readonly knownHeads: ReadonlySet<string>;
  readonly errors: string[];
};

type EvidencePropertyArgs = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
  readonly path: string;
  readonly errors: string[];
};

type ValidateLinkedHeadArgs = {
  readonly record: UntrustedYamlMap;
  readonly path: string;
  readonly knownHeads: ReadonlySet<string>;
  readonly errors: string[];
};

type ValidateDerivedDeliveryEvidenceArgs = {
  readonly parsed: UntrustedYamlMap;
  readonly summary: UntrustedYamlMap;
  readonly errors: string[];
};

type PropertyRequest = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
};

type ValidateSummaryCountArgs = {
  readonly summary: UntrustedYamlMap;
  readonly key: string;
  readonly expected: number;
  readonly detailKey: string;
  readonly errors: string[];
};
