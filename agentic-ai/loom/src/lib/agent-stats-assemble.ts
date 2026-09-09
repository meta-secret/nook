import { readFileSync } from 'node:fs';

import path from 'node:path';

import {
  UntrustedYamlPropertyPresence,
  type UntrustedYamlMap,
  type UntrustedYamlMapBuilder,
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from './guards.ts';

import { HostCommand } from './run.ts';

import {
  type AgentStatsGitHubEvidenceRequest,
  GithubAgentEvidence,
} from './agent-stats-github.ts';

import { ValidationCycleHistory } from './agent-stats-validation-cycles.ts';

import { LoomFailureCode, LoomFailure } from '../loom-failure.ts';

import type { UntrustedYamlPropertyArgs } from './guards.ts';

import type { RunCommandArgs } from './run.ts';

import type { LoomFailureDetailArgs } from '../loom-failure.ts';

export class AgentStatisticsAssembly {
  private constructor(private readonly request: AssembleOptions) {}

  static loadScratchEventLog(scratchPath: string): ScratchEventLog {
    let parsed: UntrustedYamlNode;
    try {
      parsed = UntrustedYamlBoundary.fromHost(
        JSON.parse(readFileSync(scratchPath, 'utf8')) as UntrustedYamlNode,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const loomFailureDetailArgs14: LoomFailureDetailArgs = {
        code: LoomFailureCode.ScratchLogInvalid,
        text: `Failed to read scratch event log: ${message}`,
      };
      LoomFailure.detail(loomFailureDetailArgs14);
    }
    if (!UntrustedYamlBoundary.isRecord(parsed)) {
      const loomFailureDetailArgs13: LoomFailureDetailArgs = {
        code: LoomFailureCode.ScratchLogInvalid,
        text: 'Scratch event log must be a JSON object',
      };
      LoomFailure.detail(loomFailureDetailArgs13);
    }
    const startedAtArgs = {
      record: parsed,
      key: 'started_at',
      failure: 'scratch.started_at must be a non-empty string',
    };
    const startedAt =
      AgentStatisticsAssembly.requireExternalString(startedAtArgs);
    const changeSurfaceArgs = {
      record: parsed,
      key: 'change_surface',
      failure: 'scratch.change_surface must be a non-empty string',
    };
    const changeSurface =
      AgentStatisticsAssembly.requireExternalString(changeSurfaceArgs);
    const localExecutionsArgs = {
      record: parsed,
      key: 'local_executions',
      failure: 'scratch.local_executions must be an array',
    };
    const localExecutions =
      AgentStatisticsAssembly.requireExternalArray(localExecutionsArgs);
    const prRetriggersArgs = {
      record: parsed,
      key: 'pr_retriggers',
      failure: 'scratch.pr_retriggers must be an array',
    };
    const prRetriggers =
      AgentStatisticsAssembly.requireExternalArray(prRetriggersArgs);
    const mergeAttemptsArgs = {
      record: parsed,
      key: 'merge_attempts',
      failure: 'scratch.merge_attempts must be an array',
    };
    const mergeAttempts =
      AgentStatisticsAssembly.requireExternalArray(mergeAttemptsArgs);
    const comparisonArgs = {
      record: parsed,
      key: 'comparison',
      failure: 'scratch.comparison must be an object',
    };
    const comparison =
      AgentStatisticsAssembly.requireUntrustedYamlMap(comparisonArgs);
    const wasteAssessmentArgs = {
      record: parsed,
      key: 'waste_assessment',
      failure: 'scratch.waste_assessment must be an object',
    };
    const wasteAssessment =
      AgentStatisticsAssembly.requireUntrustedYamlMap(wasteAssessmentArgs);
    const cacheTelemetryPropertyArgs: UntrustedYamlPropertyArgs = {
      record: parsed,
      key: 'cache_telemetry',
    };
    const cacheTelemetryProperty = UntrustedYamlBoundary.property(
      cacheTelemetryPropertyArgs,
    );
    const testInventoryPropertyArgs: UntrustedYamlPropertyArgs = {
      record: parsed,
      key: 'test_inventory',
    };
    const testInventoryProperty = UntrustedYamlBoundary.property(
      testInventoryPropertyArgs,
    );

    return {
      started_at: startedAt,
      change_surface: changeSurface,
      local_executions: localExecutions.filter(UntrustedYamlBoundary.isRecord),
      pr_retriggers: prRetriggers.filter(UntrustedYamlBoundary.isRecord),
      merge_attempts: mergeAttempts.filter(UntrustedYamlBoundary.isRecord),
      comparison,
      waste_assessment: wasteAssessment,
      cache_telemetry:
        cacheTelemetryProperty.presence ===
          UntrustedYamlPropertyPresence.Present &&
        UntrustedYamlBoundary.isRecord(cacheTelemetryProperty.value)
          ? {
              kind: OptionalRecordKind.Present,
              value: cacheTelemetryProperty.value,
            }
          : { kind: OptionalRecordKind.Missing },
      test_inventory:
        testInventoryProperty.presence ===
          UntrustedYamlPropertyPresence.Present &&
        UntrustedYamlBoundary.isRecord(testInventoryProperty.value)
          ? {
              kind: OptionalRecordKind.Present,
              value: testInventoryProperty.value,
            }
          : { kind: OptionalRecordKind.Missing },
    };
  }

  static assembleAgentStats(options: AssembleOptions): Promise<AssembledStats> {
    return new AgentStatisticsAssembly(options).execute();
  }

  private async execute(): Promise<AssembledStats> {
    const options = this.request;
    const scratch = AgentStatisticsAssembly.loadScratchEventLog(
      options.scratchPath,
    );

    const prJsonArgs: RunCommandArgs = {
      command: 'gh',
      args: [
        'pr',
        'view',
        String(options.prNumber),
        '--json',
        'number,url,title,mergedAt,createdAt,mergeCommit,headRefName,headRefOid,baseRefName,state',
      ],
      cwd: options.repoRoot,
    };
    const prJson = HostCommand.run(prJsonArgs);
    if (prJson.exitCode !== 0) {
      const loomFailureDetailArgs12: LoomFailureDetailArgs = {
        code: LoomFailureCode.CommandFailed,
        text: `gh pr view failed: ${prJson.stderr || prJson.stdout}`,
      };
      LoomFailure.detail(loomFailureDetailArgs12);
    }

    let pr: UntrustedYamlMap;
    try {
      const parsed = UntrustedYamlBoundary.fromHost(
        JSON.parse(prJson.stdout) as UntrustedYamlNode,
      );
      if (!UntrustedYamlBoundary.isRecord(parsed)) {
        const loomFailureDetailArgs11: LoomFailureDetailArgs = {
          code: LoomFailureCode.PrMetadataInvalid,
          text: 'gh pr view returned a non-object',
        };
        LoomFailure.detail(loomFailureDetailArgs11);
      }
      pr = parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const loomFailureDetailArgs10: LoomFailureDetailArgs = {
        code: LoomFailureCode.PrMetadataInvalid,
        text: `Failed to parse gh pr view JSON: ${message}`,
      };
      LoomFailure.detail(loomFailureDetailArgs10);
    }

    const statePropertyArgs: UntrustedYamlPropertyArgs = {
      record: pr,
      key: 'state',
    };
    const stateProperty = UntrustedYamlBoundary.property(statePropertyArgs);
    if (
      stateProperty.presence === UntrustedYamlPropertyPresence.Absent ||
      stateProperty.value !== 'MERGED'
    ) {
      const loomFailureDetailArgs9: LoomFailureDetailArgs = {
        code: LoomFailureCode.PrMetadataInvalid,
        text: 'AI-agent stats require a merged source PR',
      };
      LoomFailure.detail(loomFailureDetailArgs9);
    }
    const mergedAtArgs = {
      record: pr,
      key: 'mergedAt',
      failure: 'Merged PR is missing mergedAt',
      code: LoomFailureCode.PrMetadataInvalid,
    };
    const mergedAt =
      AgentStatisticsAssembly.requireExternalString(mergedAtArgs);
    const headShaArgs = { record: pr, key: 'headRefOid' };
    const headSha = AgentStatisticsAssembly.optionalExternalString(headShaArgs);
    if (!/^[0-9a-f]{40}$/.test(headSha)) {
      const loomFailureDetailArgs8: LoomFailureDetailArgs = {
        code: LoomFailureCode.PrMetadataInvalid,
        text: 'Merged PR is missing headRefOid',
      };
      LoomFailure.detail(loomFailureDetailArgs8);
    }

    const mergeCommitPropertyArgs: UntrustedYamlPropertyArgs = {
      record: pr,
      key: 'mergeCommit',
    };
    const mergeCommitProperty = UntrustedYamlBoundary.property(
      mergeCommitPropertyArgs,
    );
    const mergeCommit =
      mergeCommitProperty.presence === UntrustedYamlPropertyPresence.Present &&
      UntrustedYamlBoundary.isRecord(mergeCommitProperty.value)
        ? mergeCommitProperty.value
        : {};
    const mergeShaArgs = { record: mergeCommit, key: 'oid' };
    const mergeSha =
      AgentStatisticsAssembly.optionalExternalString(mergeShaArgs);
    if (!/^[0-9a-f]{40}$/.test(mergeSha)) {
      const mergeShaFailure: LoomFailureDetailArgs = {
        code: LoomFailureCode.PrMetadataInvalid,
        text: 'Merged PR is missing mergeCommit.oid',
      };
      LoomFailure.detail(mergeShaFailure);
    }

    let inventory: UntrustedYamlMap;
    if (scratch.test_inventory.kind === OptionalRecordKind.Present) {
      inventory = scratch.test_inventory.value;
    } else if (options.includeInventory) {
      const inventoryArgs = { repoRoot: options.repoRoot, headSha };
      inventory = AgentStatisticsAssembly.countTestInventory(inventoryArgs);
    } else {
      inventory = {
        measured_at: new Date().toISOString(),
        head_sha: headSha,
        by_type: { rust: 0, preflight: 0, web_unit: 0, e2e: 0 },
        total: 0,
      };
    }

    const cacheTelemetry =
      scratch.cache_telemetry.kind === OptionalRecordKind.Present
        ? scratch.cache_telemetry.value
        : {
            totals: {
              job_count: 0,
              remote_backend_job_count: 0,
              direct_compile_job_count: 0,
              sccache_compile_requests: 0,
              sccache_cache_hits: 0,
              sccache_cache_misses: 0,
              buildkit_completed_steps: 0,
              buildkit_cached_steps: 0,
            },
            jobs: [],
          };

    const createdAtPropertyArgs: UntrustedYamlPropertyArgs = {
      record: pr,
      key: 'createdAt',
    };
    const createdAtProperty = UntrustedYamlBoundary.property(
      createdAtPropertyArgs,
    );
    const openedAt =
      createdAtProperty.presence === UntrustedYamlPropertyPresence.Present &&
      typeof createdAtProperty.value === 'string'
        ? createdAtProperty.value
        : scratch.started_at;
    const branchArgs = { record: pr, key: 'headRefName' };
    const branch = AgentStatisticsAssembly.optionalExternalString(branchArgs);
    if (branch.length === 0) {
      const branchFailure: LoomFailureDetailArgs = {
        code: LoomFailureCode.PrMetadataInvalid,
        text: 'Merged PR is missing headRefName',
      };
      LoomFailure.detail(branchFailure);
    }
    const evidenceRequest: AgentStatsGitHubEvidenceRequest = {
      repoRoot: options.repoRoot,
      prNumber: options.prNumber,
      branch,
      startedAt: scratch.started_at,
      openedAt,
      mergedAt,
      finalHeadSha: headSha,
    };
    const evidence =
      GithubAgentEvidence.collectAgentStatsGitHubEvidence(evidenceRequest);
    const runs = evidence.githubActionsRuns;
    const localExecutions = scratch.local_executions;
    const localSeconds =
      AgentStatisticsAssembly.sumDurationSeconds(localExecutions);
    const actionsSeconds = AgentStatisticsAssembly.sumDurationSeconds(runs);
    const startedMs = Date.parse(scratch.started_at);
    const openedMs = Date.parse(openedAt);
    const mergedMs = Date.parse(mergedAt);
    if (
      Number.isNaN(startedMs) ||
      Number.isNaN(openedMs) ||
      Number.isNaN(mergedMs)
    ) {
      const loomFailureDetailArgs7: LoomFailureDetailArgs = {
        code: LoomFailureCode.PrMetadataInvalid,
        text: 'Could not parse started_at / opened_at / merged_at timestamps',
      };
      LoomFailure.detail(loomFailureDetailArgs7);
    }

    const urlArgs = { record: pr, key: 'url' };
    const url = AgentStatisticsAssembly.optionalExternalString(urlArgs);
    const titleArgs = { record: pr, key: 'title' };
    const title = AgentStatisticsAssembly.optionalExternalString(titleArgs);
    const countByCategoryArgs = {
      items: localExecutions,
      category: 'combined',
    };
    const countByCategoryArgs2 = {
      items: localExecutions,
      category: 'test',
    };
    const countByCategoryArgs3 = {
      items: localExecutions,
      category: 'check',
    };
    const sealUntrustedYamlMapArgs2 = {
      local_execution_count: localExecutions.length,
      local_check_count:
        AgentStatisticsAssembly.countByCategory(countByCategoryArgs3),
      local_test_count:
        AgentStatisticsAssembly.countByCategory(countByCategoryArgs2),
      local_combined_count:
        AgentStatisticsAssembly.countByCategory(countByCategoryArgs),
      local_execution_seconds: localSeconds,
      github_actions_run_count: runs.length,
      github_actions_seconds: actionsSeconds,
      delivery_head_count: evidence.deliveryHeads.length,
      review_request_count: evidence.reviewRequestCount,
      review_finding_batch_count: evidence.reviewFindingBatchCount,
      review_finding_count: evidence.reviewFindingCount,
      validation_cycle_count: evidence.validationCycles.length,
      obsolete_validation_seconds: evidence.obsoleteValidationSeconds,
      obsolete_validation_count: evidence.obsoleteValidationCount,
      cancelled_validation_seconds: evidence.cancelledValidationSeconds,
      cancelled_validation_count: evidence.cancelledValidationCount,
      pr_retrigger_count: ValidationCycleHistory.countRetriggers(
        evidence.validationCycles,
      ),
      agent_requested_rerun_count: scratch.pr_retriggers.filter((item) => {
        const kindArgs: UntrustedYamlPropertyArgs = {
          record: item,
          key: 'kind',
        };
        const kind = UntrustedYamlBoundary.property(kindArgs);
        const triggerArgs: UntrustedYamlPropertyArgs = {
          record: item,
          key: 'trigger',
        };
        const trigger = UntrustedYamlBoundary.property(triggerArgs);
        return (
          (kind.presence === UntrustedYamlPropertyPresence.Present &&
            kind.value === 'agent_requested') ||
          (trigger.presence === UntrustedYamlPropertyPresence.Present &&
            trigger.value === 'manual_rerun')
        );
      }).length,
      merge_attempt_count: scratch.merge_attempts.length,
    };
    const sealUntrustedYamlMapArgs3 = {
      number: options.prNumber,
      url,
      title,
      change_surface: scratch.change_surface,
      head_sha: headSha,
      merge_sha: mergeSha,
      started_at: scratch.started_at,
      opened_at: openedAt,
      merged_at: mergedAt,
      elapsed_seconds: Math.max(0, Math.round((mergedMs - startedMs) / 1000)),
      open_to_merge_seconds: Math.max(
        0,
        Math.round((mergedMs - openedMs) / 1000),
      ),
    };
    const recordBuilder: UntrustedYamlMapBuilder = {
      schema_version: 4,
      source_pr: UntrustedYamlBoundary.seal(sealUntrustedYamlMapArgs3),
      summary: UntrustedYamlBoundary.seal(sealUntrustedYamlMapArgs2),
      test_inventory: inventory,
      local_executions: localExecutions,
      github_actions_runs: runs,
      delivery_heads: evidence.deliveryHeads,
      review_events: evidence.reviewEvents,
      validation_cycles: evidence.validationCycles,
      cache_telemetry: cacheTelemetry,
      pr_retriggers: scratch.pr_retriggers,
      merge_attempts: scratch.merge_attempts,
      comparison: scratch.comparison,
      waste_assessment: scratch.waste_assessment,
    };
    const record = UntrustedYamlBoundary.seal(recordBuilder);

    return {
      yaml: Bun.YAML.stringify(record),
      record,
    };
  }

  private static countTestInventory(
    args: CountTestInventoryArgs,
  ): UntrustedYamlMap {
    const { repoRoot, headSha } = args;

    const measuredAt = new Date().toISOString();
    const rustArgs = {
      repoRoot,
      filter:
        'package(nook-app-common) + package(nook-core) + package(nook-auth2) + package(nook-replication) + package(nook-event-log)',
    };
    const rust = AgentStatisticsAssembly.countNextest(rustArgs);
    const preflightArgs = { repoRoot, filter: 'package(preflight)' };
    const preflight = AgentStatisticsAssembly.countNextest(preflightArgs);
    const webUnit = AgentStatisticsAssembly.countVitest(repoRoot);
    const e2e = AgentStatisticsAssembly.countPlaywright(repoRoot);
    const byType = {
      rust,
      preflight,
      web_unit: webUnit,
      e2e,
    };
    return {
      measured_at: measuredAt,
      head_sha: headSha,
      by_type: byType,
      total: byType.rust + byType.preflight + byType.web_unit + byType.e2e,
    };
  }

  private static countNextest(args: CountNextestArgs): number {
    const { repoRoot, filter } = args;

    const listedArgs3: RunCommandArgs = {
      command: 'cargo',
      args: ['nextest', 'list', '-E', filter, '--lib', '--tests'],
      cwd: path.join(repoRoot, 'nook-app'),
    };
    const listed = HostCommand.run(listedArgs3);
    if (listed.exitCode !== 0) {
      return 0;
    }
    const matches = listed.stdout.match(/^[^\s].*:/gm);
    if (!matches) {
      return 0;
    }
    return matches.length;
  }

  private static countVitest(repoRoot: string): number {
    const appRoot = path.join(repoRoot, 'nook-app', 'nook-web', 'nook-web-app');
    const listedArgs2: RunCommandArgs = {
      command: 'bunx',
      args: ['vitest', 'list'],
      cwd: appRoot,
    };
    const listed = HostCommand.run(listedArgs2);
    if (listed.exitCode !== 0) {
      return 0;
    }
    const lines = listed.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines.length;
  }

  private static countPlaywright(repoRoot: string): number {
    const appRoot = path.join(repoRoot, 'nook-app', 'nook-web', 'nook-web-app');
    const listedArgs: RunCommandArgs = {
      command: 'bunx',
      args: ['playwright', 'test', '--list'],
      cwd: appRoot,
    };
    const listed = HostCommand.run(listedArgs);
    if (listed.exitCode !== 0) {
      return 0;
    }
    const matches = listed.stdout.match(/^\s+\d+/gm);
    if (!matches) {
      return 0;
    }
    return matches.length;
  }

  private static sumDurationSeconds(
    items: AgentStatisticsDurationEntries,
  ): number {
    let total = 0;
    for (const item of items) {
      const durationArgs: UntrustedYamlPropertyArgs = {
        record: item,
        key: 'duration_seconds',
      };
      const duration = UntrustedYamlBoundary.property(durationArgs);
      if (
        duration.presence === UntrustedYamlPropertyPresence.Present &&
        typeof duration.value === 'number'
      ) {
        total += duration.value;
      }
    }
    return total;
  }

  private static countByCategory(args: CountByCategoryArgs): number {
    const { items, category } = args;

    return items.filter((item) => {
      const propertyArgs4: UntrustedYamlPropertyArgs = {
        record: item,
        key: 'category',
      };
      const property = UntrustedYamlBoundary.property(propertyArgs4);
      return (
        property.presence === UntrustedYamlPropertyPresence.Present &&
        property.value === category
      );
    }).length;
  }

  private static requireExternalString(
    args: RequireExternalStringArgs,
  ): string {
    const propertyArgs3: UntrustedYamlPropertyArgs = {
      record: args.record,
      key: args.key,
    };
    const property = UntrustedYamlBoundary.property(propertyArgs3);
    if (
      property.presence === UntrustedYamlPropertyPresence.Absent ||
      typeof property.value !== 'string' ||
      property.value.length === 0
    ) {
      const [defaulted1 = LoomFailureCode.ScratchLogInvalid] = [args.code];
      const loomFailureDetailArgs3: LoomFailureDetailArgs = {
        code: defaulted1,
        text: args.failure,
      };
      LoomFailure.detail(loomFailureDetailArgs3);
    }
    return property.value;
  }

  private static requireExternalArray(
    args: RequireExternalArrayArgs,
  ): readonly UntrustedYamlNode[] {
    const propertyArgs2: UntrustedYamlPropertyArgs = {
      record: args.record,
      key: args.key,
    };
    const property = UntrustedYamlBoundary.property(propertyArgs2);
    if (
      property.presence === UntrustedYamlPropertyPresence.Absent ||
      !Array.isArray(property.value)
    ) {
      const loomFailureDetailArgs2: LoomFailureDetailArgs = {
        code: LoomFailureCode.ScratchLogInvalid,
        text: args.failure,
      };
      LoomFailure.detail(loomFailureDetailArgs2);
    }
    return property.value;
  }

  private static requireUntrustedYamlMap(
    args: RequireUntrustedYamlMapArgs,
  ): UntrustedYamlMap {
    const propertyArgs: UntrustedYamlPropertyArgs = {
      record: args.record,
      key: args.key,
    };
    const property = UntrustedYamlBoundary.property(propertyArgs);
    if (
      property.presence === UntrustedYamlPropertyPresence.Absent ||
      !UntrustedYamlBoundary.isRecord(property.value)
    ) {
      const loomFailureDetailArgs: LoomFailureDetailArgs = {
        code: LoomFailureCode.ScratchLogInvalid,
        text: args.failure,
      };
      LoomFailure.detail(loomFailureDetailArgs);
    }
    return property.value;
  }

  private static optionalExternalString(
    args: OptionalExternalFieldArgs,
  ): string {
    const property = UntrustedYamlBoundary.property(args);
    if (
      property.presence === UntrustedYamlPropertyPresence.Present &&
      typeof property.value === 'string'
    ) {
      return property.value;
    }
    return '';
  }
}

export type ScratchEventLog = {
  readonly started_at: string;
  readonly change_surface: string;
  readonly local_executions: UntrustedYamlMap[];
  readonly pr_retriggers: UntrustedYamlMap[];
  readonly merge_attempts: UntrustedYamlMap[];
  readonly comparison: UntrustedYamlMap;
  readonly waste_assessment: UntrustedYamlMap;
  readonly cache_telemetry: OptionalRecord;
  readonly test_inventory: OptionalRecord;
};

export enum OptionalRecordKind {
  Present = 'present',
  Missing = 'missing',
}

type OptionalRecord =
  | {
      readonly kind: OptionalRecordKind.Present;
      readonly value: UntrustedYamlMap;
    }
  | { readonly kind: OptionalRecordKind.Missing };

export type AssembleOptions = {
  readonly repoRoot: string;
  readonly prNumber: number;
  readonly scratchPath: string;
  readonly includeInventory: boolean;
};

export type AssembledStats = {
  readonly yaml: string;
  readonly record: UntrustedYamlMap;
};

type CountTestInventoryArgs = {
  readonly repoRoot: string;
  readonly headSha: string;
};

type CountNextestArgs = {
  readonly repoRoot: string;
  readonly filter: string;
};

type AgentStatisticsDurationEntries = UntrustedYamlMap[];

type CountByCategoryArgs = {
  readonly items: UntrustedYamlMap[];
  readonly category: string;
};

type RequireExternalStringArgs = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
  readonly failure: string;
  readonly code?: LoomFailureCode;
};

type RequireExternalArrayArgs = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
  readonly failure: string;
};

type RequireUntrustedYamlMapArgs = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
  readonly failure: string;
};

type OptionalExternalFieldArgs = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
};
