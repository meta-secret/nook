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
    loomFailureDetail({
      code: LoomFailureCode.ScratchLogInvalid,
      text: `Failed to read scratch event log: ${message}`,
    });
  }
  if (!isRecord(parsed)) {
    loomFailureDetail({
      code: LoomFailureCode.ScratchLogInvalid,
      text: 'Scratch event log must be a JSON object',
    });
  }
  const startedAt = requireExternalString({
    record: parsed,
    key: 'started_at',
    failure: 'scratch.started_at must be a non-empty string',
  });
  const changeSurface = requireExternalString({
    record: parsed,
    key: 'change_surface',
    failure: 'scratch.change_surface must be a non-empty string',
  });
  const localExecutions = requireExternalArray({
    record: parsed,
    key: 'local_executions',
    failure: 'scratch.local_executions must be an array',
  });
  const prRetriggers = requireExternalArray({
    record: parsed,
    key: 'pr_retriggers',
    failure: 'scratch.pr_retriggers must be an array',
  });
  const mergeAttempts = requireExternalArray({
    record: parsed,
    key: 'merge_attempts',
    failure: 'scratch.merge_attempts must be an array',
  });
  const comparison = requireExternalObject({
    record: parsed,
    key: 'comparison',
    failure: 'scratch.comparison must be an object',
  });
  const wasteAssessment = requireExternalObject({
    record: parsed,
    key: 'waste_assessment',
    failure: 'scratch.waste_assessment must be an object',
  });
  const cacheTelemetryProperty = externalProperty({
    record: parsed,
    key: 'cache_telemetry',
  });
  const testInventoryProperty = externalProperty({
    record: parsed,
    key: 'test_inventory',
  });

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

  const prJson = runCommand({
    command: 'gh',
    args: [
      'pr',
      'view',
      String(options.prNumber),
      '--json',
      'number,url,title,mergedAt,createdAt,mergeCommit,baseRefName,state',
    ],
    cwd: options.repoRoot,
  });
  if (prJson.exitCode !== 0) {
    loomFailureDetail({
      code: LoomFailureCode.CommandFailed,
      text: `gh pr view failed: ${prJson.stderr || prJson.stdout}`,
    });
  }

  let pr: ExternalObject;
  try {
    const parsed = asExternalValue(JSON.parse(prJson.stdout) as ExternalValue);
    if (!isRecord(parsed)) {
      loomFailureDetail({
        code: LoomFailureCode.PrMetadataInvalid,
        text: 'gh pr view returned a non-object',
      });
    }
    pr = parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loomFailureDetail({
      code: LoomFailureCode.PrMetadataInvalid,
      text: `Failed to parse gh pr view JSON: ${message}`,
    });
  }

  const stateProperty = externalProperty({ record: pr, key: 'state' });
  if (
    stateProperty.presence === ExternalPropertyPresence.Absent ||
    stateProperty.value !== 'MERGED'
  ) {
    loomFailureDetail({
      code: LoomFailureCode.PrMetadataInvalid,
      text: 'AI-agent stats require a merged source PR',
    });
  }
  const mergedAt = requireExternalString({
    record: pr,
    key: 'mergedAt',
    failure: 'Merged PR is missing mergedAt',
    code: LoomFailureCode.PrMetadataInvalid,
  });
  const mergeCommitProperty = externalProperty({
    record: pr,
    key: 'mergeCommit',
  });
  const mergeCommit =
    mergeCommitProperty.presence === ExternalPropertyPresence.Present &&
    isRecord(mergeCommitProperty.value)
      ? mergeCommitProperty.value
      : {};
  const oidProperty = externalProperty({ record: mergeCommit, key: 'oid' });
  const headSha =
    oidProperty.presence === ExternalPropertyPresence.Present &&
    typeof oidProperty.value === 'string'
      ? oidProperty.value
      : '';
  if (!/^[0-9a-f]{40}$/.test(headSha)) {
    loomFailureDetail({
      code: LoomFailureCode.PrMetadataInvalid,
      text: 'Merged PR is missing mergeCommit.oid',
    });
  }

  const runs = collectGithubActionsRuns({
    repoRoot: options.repoRoot,
    prNumber: options.prNumber,
    headSha,
  });

  const localExecutions = scratch.local_executions;
  const localSeconds = sumDurationSeconds(localExecutions);
  const actionsSeconds = sumDurationSeconds(runs);

  let inventory: ExternalObject;
  if (scratch.test_inventory.kind === OptionalRecordKind.Present) {
    inventory = scratch.test_inventory.value;
  } else if (options.includeInventory) {
    inventory = countTestInventory({ repoRoot: options.repoRoot, headSha });
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

  const createdAtProperty = externalProperty({ record: pr, key: 'createdAt' });
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
    loomFailureDetail({
      code: LoomFailureCode.PrMetadataInvalid,
      text: 'Could not parse started_at / opened_at / merged_at timestamps',
    });
  }

  const url = optionalExternalString({ record: pr, key: 'url' });
  const title = optionalExternalString({ record: pr, key: 'title' });
  const recordBuilder: ExternalObjectBuilder = {
    schema_version: 3,
    source_pr: sealExternalObject({
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
    }),
    summary: sealExternalObject({
      local_execution_count: localExecutions.length,
      local_check_count: countByCategory({
        items: localExecutions,
        category: 'check',
      }),
      local_test_count: countByCategory({
        items: localExecutions,
        category: 'test',
      }),
      local_combined_count: countByCategory({
        items: localExecutions,
        category: 'combined',
      }),
      local_execution_seconds: localSeconds,
      github_actions_run_count: runs.length,
      github_actions_seconds: actionsSeconds,
      pr_retrigger_count: scratch.pr_retriggers.length,
      agent_requested_rerun_count: scratch.pr_retriggers.filter((item) => {
        const kind = externalProperty({ record: item, key: 'kind' });
        const trigger = externalProperty({ record: item, key: 'trigger' });
        return (
          (kind.presence === ExternalPropertyPresence.Present &&
            kind.value === 'agent_requested') ||
          (trigger.presence === ExternalPropertyPresence.Present &&
            trigger.value === 'manual_rerun')
        );
      }).length,
      merge_attempt_count: scratch.merge_attempts.length,
    }),
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

  const listed = runCommand({
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
  });
  if (listed.exitCode !== 0) {
    loomFailureDetail({
      code: LoomFailureCode.CommandFailed,
      text: `gh run list failed: ${listed.stderr || listed.stdout}`,
    });
  }

  let runs: ExternalValue;
  try {
    runs = asExternalValue(JSON.parse(listed.stdout) as ExternalValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loomFailureDetail({
      code: LoomFailureCode.CommandFailed,
      text: `Failed to parse gh run list JSON: ${message}`,
    });
  }
  if (!Array.isArray(runs)) {
    loomFailureDetail({
      code: LoomFailureCode.CommandFailed,
      text: 'gh run list returned a non-array',
    });
  }

  const out: ExternalObject[] = [];
  for (const run of runs) {
    if (!isRecord(run)) {
      continue;
    }
    const headShaProperty = externalProperty({ record: run, key: 'headSha' });
    if (
      headShaProperty.presence === ExternalPropertyPresence.Absent ||
      headShaProperty.value !== headSha
    ) {
      continue;
    }
    const createdAt = optionalExternalString({ record: run, key: 'createdAt' });
    const updatedAtProperty = externalProperty({
      record: run,
      key: 'updatedAt',
    });
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
    const attemptProperty = externalProperty({ record: run, key: 'attempt' });
    const conclusionProperty = externalProperty({
      record: run,
      key: 'conclusion',
    });
    const statusProperty = externalProperty({ record: run, key: 'status' });
    out.push(
      sealExternalObject({
        workflow: optionalExternalValue({ record: run, key: 'workflowName' }),
        run_id: optionalExternalValue({ record: run, key: 'databaseId' }),
        run_attempt:
          attemptProperty.presence === ExternalPropertyPresence.Present &&
          typeof attemptProperty.value === 'number'
            ? attemptProperty.value
            : 1,
        head_sha: headSha,
        trigger: optionalExternalValue({ record: run, key: 'event' }),
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
      }),
    );
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
  const rust = countNextest({
    repoRoot,
    filter:
      'package(nook-app-common) + package(nook-core) + package(nook-auth2) + package(nook-replication) + package(nook-event-log)',
  });
  const preflight = countNextest({ repoRoot, filter: 'package(preflight)' });
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

  const listed = runCommand({
    command: 'cargo',
    args: ['nextest', 'list', '-E', filter, '--lib', '--tests'],
    cwd: path.join(repoRoot, 'nook-app'),
  });
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
  const listed = runCommand({
    command: 'bunx',
    args: ['vitest', 'list'],
    cwd: appRoot,
  });
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
  const listed = runCommand({
    command: 'bunx',
    args: ['playwright', 'test', '--list'],
    cwd: appRoot,
  });
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
    const duration = externalProperty({
      record: item,
      key: 'duration_seconds',
    });
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
    const property = externalProperty({ record: item, key: 'category' });
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
  const property = externalProperty({ record: args.record, key: args.key });
  if (
    property.presence === ExternalPropertyPresence.Absent ||
    typeof property.value !== 'string' ||
    property.value.length === 0
  ) {
    loomFailureDetail({
      code: args.code ?? LoomFailureCode.ScratchLogInvalid,
      text: args.failure,
    });
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
  const property = externalProperty({ record: args.record, key: args.key });
  if (
    property.presence === ExternalPropertyPresence.Absent ||
    !Array.isArray(property.value)
  ) {
    loomFailureDetail({
      code: LoomFailureCode.ScratchLogInvalid,
      text: args.failure,
    });
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
  const property = externalProperty({ record: args.record, key: args.key });
  if (
    property.presence === ExternalPropertyPresence.Absent ||
    !isRecord(property.value)
  ) {
    loomFailureDetail({
      code: LoomFailureCode.ScratchLogInvalid,
      text: args.failure,
    });
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
