import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ExternalPropertyPresence,
  asExternalValue,
  externalProperty,
  isRecord,
  type ExternalObject,
  type ExternalObjectBuilder,
  type ExternalValue,
} from './guards.ts';
import { sealExternalObject } from './guards.ts';
import { runCommand } from './run.ts';
import {
  LoomFailureCode,
  loomFailure,
  loomFailureDetail,
} from '../loom-failure.ts';

import type { ExternalPropertyArgs } from './guards.ts';
import type { RunCommandArgs } from './run.ts';
import type { LoomFailureDetailArgs } from '../loom-failure.ts';
export type ScratchEventLog = {
  readonly started_at: string;
  readonly change_surface: string;
  readonly local_executions: ExternalObject[];
  readonly pr_retriggers: ExternalObject[];
  readonly merge_attempts: ExternalObject[];
  readonly comparison: ExternalObject;
  readonly waste_assessment: ExternalObject;
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
      readonly value: ExternalObject;
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
  readonly record: ExternalObject;
};

export function loadScratchEventLog(scratchPath: string): ScratchEventLog {
  let parsed: ExternalValue;
  try {
    parsed = asExternalValue(
      JSON.parse(readFileSync(scratchPath, 'utf8')) as ExternalValue,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const loomFailureDetailArgs14: LoomFailureDetailArgs = {
      code: LoomFailureCode.ScratchLogInvalid,
      text: `Failed to read scratch event log: ${message}`,
    };
    loomFailureDetail(loomFailureDetailArgs14);
  }
  if (!isRecord(parsed)) {
    const loomFailureDetailArgs13: LoomFailureDetailArgs = {
      code: LoomFailureCode.ScratchLogInvalid,
      text: 'Scratch event log must be a JSON object',
    };
    loomFailureDetail(loomFailureDetailArgs13);
  }
  const startedAtArgs = {
    record: parsed,
    key: 'started_at',
    failure: 'scratch.started_at must be a non-empty string',
  };
  const startedAt = requireExternalString(startedAtArgs);
  const changeSurfaceArgs = {
    record: parsed,
    key: 'change_surface',
    failure: 'scratch.change_surface must be a non-empty string',
  };
  const changeSurface = requireExternalString(changeSurfaceArgs);
  const localExecutionsArgs = {
    record: parsed,
    key: 'local_executions',
    failure: 'scratch.local_executions must be an array',
  };
  const localExecutions = requireExternalArray(localExecutionsArgs);
  const prRetriggersArgs = {
    record: parsed,
    key: 'pr_retriggers',
    failure: 'scratch.pr_retriggers must be an array',
  };
  const prRetriggers = requireExternalArray(prRetriggersArgs);
  const mergeAttemptsArgs = {
    record: parsed,
    key: 'merge_attempts',
    failure: 'scratch.merge_attempts must be an array',
  };
  const mergeAttempts = requireExternalArray(mergeAttemptsArgs);
  const comparisonArgs = {
    record: parsed,
    key: 'comparison',
    failure: 'scratch.comparison must be an object',
  };
  const comparison = requireExternalObject(comparisonArgs);
  const wasteAssessmentArgs = {
    record: parsed,
    key: 'waste_assessment',
    failure: 'scratch.waste_assessment must be an object',
  };
  const wasteAssessment = requireExternalObject(wasteAssessmentArgs);
  const cacheTelemetryPropertyArgs: ExternalPropertyArgs = {
    record: parsed,
    key: 'cache_telemetry',
  };
  const cacheTelemetryProperty = externalProperty(cacheTelemetryPropertyArgs);
  const testInventoryPropertyArgs: ExternalPropertyArgs = {
    record: parsed,
    key: 'test_inventory',
  };
  const testInventoryProperty = externalProperty(testInventoryPropertyArgs);

  return {
    started_at: startedAt,
    change_surface: changeSurface,
    local_executions: localExecutions.filter(isRecord),
    pr_retriggers: prRetriggers.filter(isRecord),
    merge_attempts: mergeAttempts.filter(isRecord),
    comparison,
    waste_assessment: wasteAssessment,
    cache_telemetry:
      cacheTelemetryProperty.presence === ExternalPropertyPresence.Present &&
      isRecord(cacheTelemetryProperty.value)
        ? {
            kind: OptionalRecordKind.Present,
            value: cacheTelemetryProperty.value,
          }
        : { kind: OptionalRecordKind.Missing },
    test_inventory:
      testInventoryProperty.presence === ExternalPropertyPresence.Present &&
      isRecord(testInventoryProperty.value)
        ? {
            kind: OptionalRecordKind.Present,
            value: testInventoryProperty.value,
          }
        : { kind: OptionalRecordKind.Missing },
  };
}

export async function assembleAgentStats(
  options: AssembleOptions,
): Promise<AssembledStats> {
  const scratch = loadScratchEventLog(options.scratchPath);

  const prJsonArgs: RunCommandArgs = {
    command: 'gh',
    args: [
      'pr',
      'view',
      String(options.prNumber),
      '--json',
      'number,url,title,mergedAt,createdAt,mergeCommit,baseRefName,state',
    ],
    cwd: options.repoRoot,
  };
  const prJson = runCommand(prJsonArgs);
  if (prJson.exitCode !== 0) {
    const loomFailureDetailArgs12: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `gh pr view failed: ${prJson.stderr || prJson.stdout}`,
    };
    loomFailureDetail(loomFailureDetailArgs12);
  }

  let pr: ExternalObject;
  try {
    const parsed = asExternalValue(JSON.parse(prJson.stdout) as ExternalValue);
    if (!isRecord(parsed)) {
      const loomFailureDetailArgs11: LoomFailureDetailArgs = {
        code: LoomFailureCode.PrMetadataInvalid,
        text: 'gh pr view returned a non-object',
      };
      loomFailureDetail(loomFailureDetailArgs11);
    }
    pr = parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const loomFailureDetailArgs10: LoomFailureDetailArgs = {
      code: LoomFailureCode.PrMetadataInvalid,
      text: `Failed to parse gh pr view JSON: ${message}`,
    };
    loomFailureDetail(loomFailureDetailArgs10);
  }

  const statePropertyArgs: ExternalPropertyArgs = { record: pr, key: 'state' };
  const stateProperty = externalProperty(statePropertyArgs);
  if (
    stateProperty.presence === ExternalPropertyPresence.Absent ||
    stateProperty.value !== 'MERGED'
  ) {
    const loomFailureDetailArgs9: LoomFailureDetailArgs = {
      code: LoomFailureCode.PrMetadataInvalid,
      text: 'AI-agent stats require a merged source PR',
    };
    loomFailureDetail(loomFailureDetailArgs9);
  }
  const mergedAtArgs = {
    record: pr,
    key: 'mergedAt',
    failure: 'Merged PR is missing mergedAt',
    code: LoomFailureCode.PrMetadataInvalid,
  };
  const mergedAt = requireExternalString(mergedAtArgs);
  const mergeCommitPropertyArgs: ExternalPropertyArgs = {
    record: pr,
    key: 'mergeCommit',
  };
  const mergeCommitProperty = externalProperty(mergeCommitPropertyArgs);
  const mergeCommit =
    mergeCommitProperty.presence === ExternalPropertyPresence.Present &&
    isRecord(mergeCommitProperty.value)
      ? mergeCommitProperty.value
      : {};
  const oidPropertyArgs: ExternalPropertyArgs = {
    record: mergeCommit,
    key: 'oid',
  };
  const oidProperty = externalProperty(oidPropertyArgs);
  const headSha =
    oidProperty.presence === ExternalPropertyPresence.Present &&
    typeof oidProperty.value === 'string'
      ? oidProperty.value
      : '';
  if (!/^[0-9a-f]{40}$/.test(headSha)) {
    const loomFailureDetailArgs8: LoomFailureDetailArgs = {
      code: LoomFailureCode.PrMetadataInvalid,
      text: 'Merged PR is missing mergeCommit.oid',
    };
    loomFailureDetail(loomFailureDetailArgs8);
  }

  const runsArgs = {
    repoRoot: options.repoRoot,
    prNumber: options.prNumber,
    headSha,
  };
  const runs = collectGithubActionsRuns(runsArgs);

  const localExecutions = scratch.local_executions;
  const localSeconds = sumDurationSeconds(localExecutions);
  const actionsSeconds = sumDurationSeconds(runs);

  let inventory: ExternalObject;
  if (scratch.test_inventory.kind === OptionalRecordKind.Present) {
    inventory = scratch.test_inventory.value;
  } else if (options.includeInventory) {
    const inventoryArgs = { repoRoot: options.repoRoot, headSha };
    inventory = countTestInventory(inventoryArgs);
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

  const createdAtPropertyArgs: ExternalPropertyArgs = {
    record: pr,
    key: 'createdAt',
  };
  const createdAtProperty = externalProperty(createdAtPropertyArgs);
  const openedAt =
    createdAtProperty.presence === ExternalPropertyPresence.Present &&
    typeof createdAtProperty.value === 'string'
      ? createdAtProperty.value
      : scratch.started_at;
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
    loomFailureDetail(loomFailureDetailArgs7);
  }

  const urlArgs = { record: pr, key: 'url' };
  const url = optionalExternalString(urlArgs);
  const titleArgs = { record: pr, key: 'title' };
  const title = optionalExternalString(titleArgs);
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
  const sealExternalObjectArgs2 = {
    local_execution_count: localExecutions.length,
    local_check_count: countByCategory(countByCategoryArgs3),
    local_test_count: countByCategory(countByCategoryArgs2),
    local_combined_count: countByCategory(countByCategoryArgs),
    local_execution_seconds: localSeconds,
    github_actions_run_count: runs.length,
    github_actions_seconds: actionsSeconds,
    pr_retrigger_count: scratch.pr_retriggers.length,
    agent_requested_rerun_count: scratch.pr_retriggers.filter((item) => {
      const kindArgs: ExternalPropertyArgs = { record: item, key: 'kind' };
      const kind = externalProperty(kindArgs);
      const triggerArgs: ExternalPropertyArgs = {
        record: item,
        key: 'trigger',
      };
      const trigger = externalProperty(triggerArgs);
      return (
        (kind.presence === ExternalPropertyPresence.Present &&
          kind.value === 'agent_requested') ||
        (trigger.presence === ExternalPropertyPresence.Present &&
          trigger.value === 'manual_rerun')
      );
    }).length,
    merge_attempt_count: scratch.merge_attempts.length,
  };
  const sealExternalObjectArgs3 = {
    number: options.prNumber,
    url,
    title,
    change_surface: scratch.change_surface,
    head_sha: headSha,
    started_at: scratch.started_at,
    opened_at: openedAt,
    merged_at: mergedAt,
    elapsed_seconds: Math.max(0, Math.round((mergedMs - startedMs) / 1000)),
    open_to_merge_seconds: Math.max(
      0,
      Math.round((mergedMs - openedMs) / 1000),
    ),
  };
  const recordBuilder: ExternalObjectBuilder = {
    schema_version: 3,
    source_pr: sealExternalObject(sealExternalObjectArgs3),
    summary: sealExternalObject(sealExternalObjectArgs2),
    test_inventory: inventory,
    local_executions: localExecutions,
    github_actions_runs: runs,
    cache_telemetry: cacheTelemetry,
    pr_retriggers: scratch.pr_retriggers,
    merge_attempts: scratch.merge_attempts,
    comparison: scratch.comparison,
    waste_assessment: scratch.waste_assessment,
  };
  const record = sealExternalObject(recordBuilder);

  return {
    yaml: Bun.YAML.stringify(record),
    record,
  };
}

type CollectGithubActionsRunsArgs = {
  readonly repoRoot: string;
  readonly prNumber: number;
  readonly headSha: string;
};

function collectGithubActionsRuns(
  args: CollectGithubActionsRunsArgs,
): ExternalObject[] {
  const { repoRoot, prNumber, headSha } = args;

  const listedArgs4: RunCommandArgs = {
    command: 'gh',
    args: [
      'run',
      'list',
      '--limit',
      '50',
      '--json',
      'databaseId,workflowName,headSha,event,status,conclusion,createdAt,updatedAt,attempt',
    ],
    cwd: repoRoot,
  };
  const listed = runCommand(listedArgs4);
  if (listed.exitCode !== 0) {
    const loomFailureDetailArgs6: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `gh run list failed: ${listed.stderr || listed.stdout}`,
    };
    loomFailureDetail(loomFailureDetailArgs6);
  }

  let runs: ExternalValue;
  try {
    runs = asExternalValue(JSON.parse(listed.stdout) as ExternalValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const loomFailureDetailArgs5: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `Failed to parse gh run list JSON: ${message}`,
    };
    loomFailureDetail(loomFailureDetailArgs5);
  }
  if (!Array.isArray(runs)) {
    const loomFailureDetailArgs4: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: 'gh run list returned a non-array',
    };
    loomFailureDetail(loomFailureDetailArgs4);
  }

  const out: ExternalObject[] = [];
  for (const run of runs) {
    if (!isRecord(run)) {
      continue;
    }
    const headShaPropertyArgs: ExternalPropertyArgs = {
      record: run,
      key: 'headSha',
    };
    const headShaProperty = externalProperty(headShaPropertyArgs);
    if (
      headShaProperty.presence === ExternalPropertyPresence.Absent ||
      headShaProperty.value !== headSha
    ) {
      continue;
    }
    const createdAtArgs = { record: run, key: 'createdAt' };
    const createdAt = optionalExternalString(createdAtArgs);
    const updatedAtPropertyArgs: ExternalPropertyArgs = {
      record: run,
      key: 'updatedAt',
    };
    const updatedAtProperty = externalProperty(updatedAtPropertyArgs);
    const updatedAt =
      updatedAtProperty.presence === ExternalPropertyPresence.Present &&
      typeof updatedAtProperty.value === 'string'
        ? updatedAtProperty.value
        : createdAt;
    const startedMs = Date.parse(createdAt);
    const finishedMs = Date.parse(updatedAt);
    const durationSeconds =
      Number.isNaN(startedMs) || Number.isNaN(finishedMs)
        ? 0
        : Math.max(0, Math.round((finishedMs - startedMs) / 1000));
    const attemptPropertyArgs: ExternalPropertyArgs = {
      record: run,
      key: 'attempt',
    };
    const attemptProperty = externalProperty(attemptPropertyArgs);
    const conclusionPropertyArgs: ExternalPropertyArgs = {
      record: run,
      key: 'conclusion',
    };
    const conclusionProperty = externalProperty(conclusionPropertyArgs);
    const statusPropertyArgs: ExternalPropertyArgs = {
      record: run,
      key: 'status',
    };
    const statusProperty = externalProperty(statusPropertyArgs);
    const optionalExternalValueArgs = { record: run, key: 'event' };
    const optionalExternalValueArgs2 = { record: run, key: 'databaseId' };
    const optionalExternalValueArgs3 = { record: run, key: 'workflowName' };
    const sealExternalObjectArgs = {
      workflow: optionalExternalValue(optionalExternalValueArgs3),
      run_id: optionalExternalValue(optionalExternalValueArgs2),
      run_attempt:
        attemptProperty.presence === ExternalPropertyPresence.Present &&
        typeof attemptProperty.value === 'number'
          ? attemptProperty.value
          : 1,
      head_sha: headSha,
      trigger: optionalExternalValue(optionalExternalValueArgs),
      started_at: createdAt,
      finished_at: updatedAt,
      duration_seconds: durationSeconds,
      conclusion:
        conclusionProperty.presence === ExternalPropertyPresence.Present &&
        typeof conclusionProperty.value === 'string'
          ? conclusionProperty.value
          : statusProperty.presence === ExternalPropertyPresence.Present
            ? String(statusProperty.value)
            : '',
      source_pr: prNumber,
    };
    out.push(sealExternalObject(sealExternalObjectArgs));
  }
  return out;
}

type CountTestInventoryArgs = {
  readonly repoRoot: string;
  readonly headSha: string;
};

function countTestInventory(args: CountTestInventoryArgs): ExternalObject {
  const { repoRoot, headSha } = args;

  const measuredAt = new Date().toISOString();
  const rustArgs = {
    repoRoot,
    filter:
      'package(nook-app-common) + package(nook-core) + package(nook-auth2) + package(nook-replication) + package(nook-event-log)',
  };
  const rust = countNextest(rustArgs);
  const preflightArgs = { repoRoot, filter: 'package(preflight)' };
  const preflight = countNextest(preflightArgs);
  const webUnit = countVitest(repoRoot);
  const e2e = countPlaywright(repoRoot);
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

type CountNextestArgs = {
  readonly repoRoot: string;
  readonly filter: string;
};

function countNextest(args: CountNextestArgs): number {
  const { repoRoot, filter } = args;

  const listedArgs3: RunCommandArgs = {
    command: 'cargo',
    args: ['nextest', 'list', '-E', filter, '--lib', '--tests'],
    cwd: path.join(repoRoot, 'nook-app'),
  };
  const listed = runCommand(listedArgs3);
  if (listed.exitCode !== 0) {
    return 0;
  }
  const matches = listed.stdout.match(/^[^\s].*:/gm);
  if (!matches) {
    return 0;
  }
  return matches.length;
}

function countVitest(repoRoot: string): number {
  const appRoot = path.join(repoRoot, 'nook-app', 'nook-web', 'nook-web-app');
  const listedArgs2: RunCommandArgs = {
    command: 'bunx',
    args: ['vitest', 'list'],
    cwd: appRoot,
  };
  const listed = runCommand(listedArgs2);
  if (listed.exitCode !== 0) {
    return 0;
  }
  const lines = listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length;
}

function countPlaywright(repoRoot: string): number {
  const appRoot = path.join(repoRoot, 'nook-app', 'nook-web', 'nook-web-app');
  const listedArgs: RunCommandArgs = {
    command: 'bunx',
    args: ['playwright', 'test', '--list'],
    cwd: appRoot,
  };
  const listed = runCommand(listedArgs);
  if (listed.exitCode !== 0) {
    return 0;
  }
  const matches = listed.stdout.match(/^\s+\d+/gm);
  if (!matches) {
    return 0;
  }
  return matches.length;
}

function sumDurationSeconds(items: ExternalObject[]): number {
  let total = 0;
  for (const item of items) {
    const durationArgs: ExternalPropertyArgs = {
      record: item,
      key: 'duration_seconds',
    };
    const duration = externalProperty(durationArgs);
    if (
      duration.presence === ExternalPropertyPresence.Present &&
      typeof duration.value === 'number'
    ) {
      total += duration.value;
    }
  }
  return total;
}

type CountByCategoryArgs = {
  readonly items: ExternalObject[];
  readonly category: string;
};

function countByCategory(args: CountByCategoryArgs): number {
  const { items, category } = args;

  return items.filter((item) => {
    const propertyArgs4: ExternalPropertyArgs = {
      record: item,
      key: 'category',
    };
    const property = externalProperty(propertyArgs4);
    return (
      property.presence === ExternalPropertyPresence.Present &&
      property.value === category
    );
  }).length;
}

type RequireExternalStringArgs = {
  readonly record: ExternalObject;
  readonly key: string;
  readonly failure: string;
  readonly code?: LoomFailureCode;
};

function requireExternalString(args: RequireExternalStringArgs): string {
  const propertyArgs3: ExternalPropertyArgs = {
    record: args.record,
    key: args.key,
  };
  const property = externalProperty(propertyArgs3);
  if (
    property.presence === ExternalPropertyPresence.Absent ||
    typeof property.value !== 'string' ||
    property.value.length === 0
  ) {
    const loomFailureDetailArgs3: LoomFailureDetailArgs = {
      code: args.code ?? LoomFailureCode.ScratchLogInvalid,
      text: args.failure,
    };
    loomFailureDetail(loomFailureDetailArgs3);
  }
  return property.value;
}

type RequireExternalArrayArgs = {
  readonly record: ExternalObject;
  readonly key: string;
  readonly failure: string;
};

function requireExternalArray(
  args: RequireExternalArrayArgs,
): readonly ExternalValue[] {
  const propertyArgs2: ExternalPropertyArgs = {
    record: args.record,
    key: args.key,
  };
  const property = externalProperty(propertyArgs2);
  if (
    property.presence === ExternalPropertyPresence.Absent ||
    !Array.isArray(property.value)
  ) {
    const loomFailureDetailArgs2: LoomFailureDetailArgs = {
      code: LoomFailureCode.ScratchLogInvalid,
      text: args.failure,
    };
    loomFailureDetail(loomFailureDetailArgs2);
  }
  return property.value;
}

type RequireExternalObjectArgs = {
  readonly record: ExternalObject;
  readonly key: string;
  readonly failure: string;
};

function requireExternalObject(
  args: RequireExternalObjectArgs,
): ExternalObject {
  const propertyArgs: ExternalPropertyArgs = {
    record: args.record,
    key: args.key,
  };
  const property = externalProperty(propertyArgs);
  if (
    property.presence === ExternalPropertyPresence.Absent ||
    !isRecord(property.value)
  ) {
    const loomFailureDetailArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.ScratchLogInvalid,
      text: args.failure,
    };
    loomFailureDetail(loomFailureDetailArgs);
  }
  return property.value;
}

type OptionalExternalFieldArgs = {
  readonly record: ExternalObject;
  readonly key: string;
};

function optionalExternalString(args: OptionalExternalFieldArgs): string {
  const property = externalProperty(args);
  if (
    property.presence === ExternalPropertyPresence.Present &&
    typeof property.value === 'string'
  ) {
    return property.value;
  }
  return '';
}

function optionalExternalValue(args: OptionalExternalFieldArgs): ExternalValue {
  const property = externalProperty(args);
  if (property.presence === ExternalPropertyPresence.Present) {
    return property.value;
  }
  return '';
}
