import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isRecord, type UnknownRecord } from './guards.ts';
import { runCommand } from './run.ts';
import {
  LoomFailureCode,
  loomFailure,
  loomFailureDetail,
} from '../loom-failure.ts';

export type ScratchEventLog = {
  readonly started_at: string;
  readonly change_surface: string;
  readonly local_executions: UnknownRecord[];
  readonly pr_retriggers: UnknownRecord[];
  readonly merge_attempts: UnknownRecord[];
  readonly comparison: UnknownRecord;
  readonly waste_assessment: UnknownRecord;
  readonly cache_telemetry: OptionalRecord;
  readonly test_inventory: OptionalRecord;
};

export enum OptionalRecordKind {
  Present = 'present',
  Missing = 'missing',
}

type OptionalRecord =
  | { readonly kind: OptionalRecordKind.Present; readonly value: UnknownRecord }
  | { readonly kind: OptionalRecordKind.Missing };

export type AssembleOptions = {
  readonly repoRoot: string;
  readonly prNumber: number;
  readonly scratchPath: string;
  readonly includeInventory: boolean;
};

export type AssembledStats = {
  readonly yaml: string;
  readonly record: UnknownRecord;
};

export function loadScratchEventLog(scratchPath: string): ScratchEventLog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(scratchPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loomFailureDetail(
      LoomFailureCode.ScratchLogInvalid,
      `Failed to read scratch event log: ${message}`,
    );
  }
  if (!isRecord(parsed)) {
    loomFailureDetail(
      LoomFailureCode.ScratchLogInvalid,
      'Scratch event log must be a JSON object',
    );
  }
  if (typeof parsed.started_at !== 'string' || parsed.started_at.length === 0) {
    loomFailureDetail(
      LoomFailureCode.ScratchLogInvalid,
      'scratch.started_at must be a non-empty string',
    );
  }
  if (
    typeof parsed.change_surface !== 'string' ||
    parsed.change_surface.length === 0
  ) {
    loomFailureDetail(
      LoomFailureCode.ScratchLogInvalid,
      'scratch.change_surface must be a non-empty string',
    );
  }
  if (!Array.isArray(parsed.local_executions)) {
    loomFailureDetail(
      LoomFailureCode.ScratchLogInvalid,
      'scratch.local_executions must be an array',
    );
  }
  if (!Array.isArray(parsed.pr_retriggers)) {
    loomFailureDetail(
      LoomFailureCode.ScratchLogInvalid,
      'scratch.pr_retriggers must be an array',
    );
  }
  if (!Array.isArray(parsed.merge_attempts)) {
    loomFailureDetail(
      LoomFailureCode.ScratchLogInvalid,
      'scratch.merge_attempts must be an array',
    );
  }
  if (!isRecord(parsed.comparison)) {
    loomFailureDetail(
      LoomFailureCode.ScratchLogInvalid,
      'scratch.comparison must be an object',
    );
  }
  if (!isRecord(parsed.waste_assessment)) {
    loomFailureDetail(
      LoomFailureCode.ScratchLogInvalid,
      'scratch.waste_assessment must be an object',
    );
  }

  return {
    started_at: parsed.started_at,
    change_surface: parsed.change_surface,
    local_executions: parsed.local_executions.filter(isRecord),
    pr_retriggers: parsed.pr_retriggers.filter(isRecord),
    merge_attempts: parsed.merge_attempts.filter(isRecord),
    comparison: parsed.comparison,
    waste_assessment: parsed.waste_assessment,
    cache_telemetry: isRecord(parsed.cache_telemetry)
      ? { kind: OptionalRecordKind.Present, value: parsed.cache_telemetry }
      : { kind: OptionalRecordKind.Missing },
    test_inventory: isRecord(parsed.test_inventory)
      ? { kind: OptionalRecordKind.Present, value: parsed.test_inventory }
      : { kind: OptionalRecordKind.Missing },
  };
}

export async function assembleAgentStats(
  options: AssembleOptions,
): Promise<AssembledStats> {
  const scratch = loadScratchEventLog(options.scratchPath);

  const prJson = runCommand(
    'gh',
    [
      'pr',
      'view',
      String(options.prNumber),
      '--json',
      'number,url,title,mergedAt,createdAt,mergeCommit,baseRefName,state',
    ],
    options.repoRoot,
  );
  if (prJson.exitCode !== 0) {
    loomFailureDetail(
      LoomFailureCode.CommandFailed,
      `gh pr view failed: ${prJson.stderr || prJson.stdout}`,
    );
  }

  let pr: UnknownRecord;
  try {
    const parsed = JSON.parse(prJson.stdout) as unknown;
    if (!isRecord(parsed)) {
      loomFailureDetail(
        LoomFailureCode.PrMetadataInvalid,
        'gh pr view returned a non-object',
      );
    }
    pr = parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loomFailureDetail(
      LoomFailureCode.PrMetadataInvalid,
      `Failed to parse gh pr view JSON: ${message}`,
    );
  }

  if (pr.state !== 'MERGED') {
    loomFailureDetail(
      LoomFailureCode.PrMetadataInvalid,
      'AI-agent stats require a merged source PR',
    );
  }
  if (typeof pr.mergedAt !== 'string' || pr.mergedAt.length === 0) {
    loomFailureDetail(
      LoomFailureCode.PrMetadataInvalid,
      'Merged PR is missing mergedAt',
    );
  }
  const mergeCommit = isRecord(pr.mergeCommit) ? pr.mergeCommit : {};
  const headSha = typeof mergeCommit.oid === 'string' ? mergeCommit.oid : '';
  if (!/^[0-9a-f]{40}$/.test(headSha)) {
    loomFailureDetail(
      LoomFailureCode.PrMetadataInvalid,
      'Merged PR is missing mergeCommit.oid',
    );
  }

  const runs = collectGithubActionsRuns(
    options.repoRoot,
    options.prNumber,
    headSha,
  );

  const localExecutions = scratch.local_executions;
  const localSeconds = sumDurationSeconds(localExecutions);
  const actionsSeconds = sumDurationSeconds(runs);

  let inventory: UnknownRecord;
  if (scratch.test_inventory.kind === OptionalRecordKind.Present) {
    inventory = scratch.test_inventory.value;
  } else if (options.includeInventory) {
    inventory = countTestInventory(options.repoRoot, headSha);
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

  const openedAt =
    typeof pr.createdAt === 'string' ? pr.createdAt : scratch.started_at;
  const startedMs = Date.parse(scratch.started_at);
  const openedMs = Date.parse(openedAt);
  const mergedMs = Date.parse(pr.mergedAt);
  if (
    Number.isNaN(startedMs) ||
    Number.isNaN(openedMs) ||
    Number.isNaN(mergedMs)
  ) {
    loomFailureDetail(
      LoomFailureCode.PrMetadataInvalid,
      'Could not parse started_at / opened_at / merged_at timestamps',
    );
  }

  const record: UnknownRecord = {
    schema_version: 3,
    source_pr: {
      number: options.prNumber,
      url: pr.url,
      title: pr.title,
      change_surface: scratch.change_surface,
      head_sha: headSha,
      started_at: scratch.started_at,
      opened_at: openedAt,
      merged_at: pr.mergedAt,
      elapsed_seconds: Math.max(0, Math.round((mergedMs - startedMs) / 1000)),
      open_to_merge_seconds: Math.max(
        0,
        Math.round((mergedMs - openedMs) / 1000),
      ),
    },
    summary: {
      local_execution_count: localExecutions.length,
      local_check_count: countByCategory(localExecutions, 'check'),
      local_test_count: countByCategory(localExecutions, 'test'),
      local_combined_count: countByCategory(localExecutions, 'combined'),
      local_execution_seconds: localSeconds,
      github_actions_run_count: runs.length,
      github_actions_seconds: actionsSeconds,
      pr_retrigger_count: scratch.pr_retriggers.length,
      agent_requested_rerun_count: scratch.pr_retriggers.filter(
        (item) =>
          item.kind === 'agent_requested' || item.trigger === 'manual_rerun',
      ).length,
      merge_attempt_count: scratch.merge_attempts.length,
    },
    test_inventory: inventory,
    local_executions: localExecutions,
    github_actions_runs: runs,
    cache_telemetry: cacheTelemetry,
    pr_retriggers: scratch.pr_retriggers,
    merge_attempts: scratch.merge_attempts,
    comparison: scratch.comparison,
    waste_assessment: scratch.waste_assessment,
  };

  return {
    yaml: Bun.YAML.stringify(record),
    record,
  };
}

function collectGithubActionsRuns(
  repoRoot: string,
  prNumber: number,
  headSha: string,
): UnknownRecord[] {
  const listed = runCommand(
    'gh',
    [
      'run',
      'list',
      '--limit',
      '50',
      '--json',
      'databaseId,workflowName,headSha,event,status,conclusion,createdAt,updatedAt,attempt',
    ],
    repoRoot,
  );
  if (listed.exitCode !== 0) {
    loomFailureDetail(
      LoomFailureCode.CommandFailed,
      `gh run list failed: ${listed.stderr || listed.stdout}`,
    );
  }

  let runs: unknown;
  try {
    runs = JSON.parse(listed.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loomFailureDetail(
      LoomFailureCode.CommandFailed,
      `Failed to parse gh run list JSON: ${message}`,
    );
  }
  if (!Array.isArray(runs)) {
    loomFailureDetail(
      LoomFailureCode.CommandFailed,
      'gh run list returned a non-array',
    );
  }

  const out: UnknownRecord[] = [];
  for (const run of runs) {
    if (!isRecord(run)) {
      continue;
    }
    if (run.headSha !== headSha) {
      continue;
    }
    const createdAt = typeof run.createdAt === 'string' ? run.createdAt : '';
    const updatedAt =
      typeof run.updatedAt === 'string' ? run.updatedAt : createdAt;
    const startedMs = Date.parse(createdAt);
    const finishedMs = Date.parse(updatedAt);
    const durationSeconds =
      Number.isNaN(startedMs) || Number.isNaN(finishedMs)
        ? 0
        : Math.max(0, Math.round((finishedMs - startedMs) / 1000));
    out.push({
      workflow: run.workflowName,
      run_id: run.databaseId,
      run_attempt: typeof run.attempt === 'number' ? run.attempt : 1,
      head_sha: headSha,
      trigger: run.event,
      started_at: createdAt,
      finished_at: updatedAt,
      duration_seconds: durationSeconds,
      conclusion:
        typeof run.conclusion === 'string'
          ? run.conclusion
          : String(run.status),
      source_pr: prNumber,
    });
  }
  return out;
}

function countTestInventory(repoRoot: string, headSha: string): UnknownRecord {
  const measuredAt = new Date().toISOString();
  const rust = countNextest(
    repoRoot,
    'package(nook-app-common) + package(nook-core) + package(nook-auth2) + package(nook-replication) + package(nook-event-log)',
  );
  const preflight = countNextest(repoRoot, 'package(preflight)');
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

function countNextest(repoRoot: string, filter: string): number {
  const listed = runCommand(
    'cargo',
    ['nextest', 'list', '-E', filter, '--lib', '--tests'],
    path.join(repoRoot, 'nook-app'),
  );
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
  const listed = runCommand('bunx', ['vitest', 'list'], appRoot);
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
  const listed = runCommand('bunx', ['playwright', 'test', '--list'], appRoot);
  if (listed.exitCode !== 0) {
    return 0;
  }
  const matches = listed.stdout.match(/^\s+\d+/gm);
  if (!matches) {
    return 0;
  }
  return matches.length;
}

function sumDurationSeconds(items: UnknownRecord[]): number {
  let total = 0;
  for (const item of items) {
    if (typeof item.duration_seconds === 'number') {
      total += item.duration_seconds;
    }
  }
  return total;
}

function countByCategory(items: UnknownRecord[], category: string): number {
  return items.filter((item) => item.category === category).length;
}
