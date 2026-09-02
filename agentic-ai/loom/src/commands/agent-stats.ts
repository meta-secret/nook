import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AgentStatsAssembleRequest,
  AgentStatsFileRequest,
} from '../codec/args/agent-stats.ts';
import { AgentStatsOperation, RequestFamily } from '../codec/enums.ts';
import { resolveAgentTempPath } from '../lib/agent-temp-path.ts';
import { assembleAgentStats } from '../lib/agent-stats-assemble.ts';
import { validateAgentStatsYaml } from '../lib/agent-stats-schema.ts';
import { findRepoRoot } from '../lib/repo.ts';
import { runCommand } from '../lib/run.ts';
import {
  UntrustedYamlPropertyPresence,
  asUntrustedYamlNode,
  isRecord,
  untrustedYamlProperty,
  type UntrustedYamlNode,
} from '../lib/guards.ts';
import {
  LoomFailureCode,
  loomFailure,
  loomFailureDetail,
} from '../loom-failure.ts';

import type { RunCommandArgs } from '../lib/run.ts';
import type { ResolveAgentTempPathRequest } from '../lib/agent-temp-path.ts';
import type { ValidateAgentStatsYamlArgs } from '../lib/agent-stats-schema.ts';
import type { LoomFailureDetailArgs } from '../loom-failure.ts';
export type AgentStatsReport = {
  readonly family: RequestFamily.AgentStats;
  readonly operation: AgentStatsOperation;
  readonly messages: string[];
  readonly outputPath: string;
};

export enum AgentStatsSourcePrField {
  State = 'state',
  MergedAt = 'mergedAt',
}

export enum GitHubPullRequestState {
  Merged = 'MERGED',
}

export type VerifyMergedAgentStatsSourcePrRequest = {
  readonly repoRoot: string;
  readonly prNumber: number;
};

export async function runAgentStatsAssemble(
  request: AgentStatsAssembleRequest,
): Promise<AgentStatsReport> {
  const repoRoot = findRepoRoot();
  const scratchPathRequest: ResolveAgentTempPathRequest = {
    repoRoot,
    authoredPath: request.scratchPath,
  };
  const outputPathRequest: ResolveAgentTempPathRequest = {
    repoRoot,
    authoredPath: request.outputPath,
  };
  const scratchPath = resolveAgentTempPath(scratchPathRequest);
  const outPath = resolveAgentTempPath(outputPathRequest);
  const assembledArgs = {
    repoRoot,
    prNumber: request.prNumber,
    scratchPath,
    includeInventory: request.includeTestInventory,
  };
  const assembled = await assembleAgentStats(assembledArgs);

  const directoryOptions: { readonly recursive: true } = { recursive: true };
  mkdirSync(path.dirname(outPath), directoryOptions);
  writeFileSync(outPath, assembled.yaml, 'utf8');

  const validationArgs3: ValidateAgentStatsYamlArgs = {
    content: assembled.yaml,
    expectedPrNumber: request.prNumber,
  };
  const validation = validateAgentStatsYaml(validationArgs3);
  if (!validation.ok) {
    const loomFailureDetailArgs4: LoomFailureDetailArgs = {
      code: LoomFailureCode.ValidationFailed,
      text: `Assembled YAML failed validation:\n${validation.errors.join('\n')}`,
    };
    loomFailureDetail(loomFailureDetailArgs4);
  }

  return {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Assemble,
    outputPath: outPath,
    messages: [
      `wrote ${outPath}`,
      'schema validation passed',
      'fill comparison and waste_assessment in the scratch log before publish when placeholders remain',
    ],
  };
}

export async function runAgentStatsValidate(
  request: AgentStatsFileRequest,
): Promise<AgentStatsReport> {
  const repoRoot = findRepoRoot();
  const statsPathRequest: ResolveAgentTempPathRequest = {
    repoRoot,
    authoredPath: request.statsFile,
  };
  const validateFileArgs: ValidateFileArgs = {
    operation: AgentStatsOperation.Validate,
    file: resolveAgentTempPath(statsPathRequest),
  };
  return validateFile(validateFileArgs);
}

export async function runAgentStatsPublish(
  request: AgentStatsFileRequest,
): Promise<AgentStatsReport> {
  const repoRoot = findRepoRoot();
  const statsPathRequest: ResolveAgentTempPathRequest = {
    repoRoot,
    authoredPath: request.statsFile,
  };
  const absolute = resolveAgentTempPath(statsPathRequest);
  const prFromName = path.basename(absolute).replace(/\.ya?ml$/, '');
  const prNumber = Number.parseInt(prFromName, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    loomFailure(LoomFailureCode.StatsFilenameInvalid);
  }

  const content = readFileSync(absolute, 'utf8');
  const validationArgs2: ValidateAgentStatsYamlArgs = {
    content,
    expectedPrNumber: prNumber,
  };
  const validation = validateAgentStatsYaml(validationArgs2);
  if (!validation.ok) {
    const loomFailureDetailArgs3: LoomFailureDetailArgs = {
      code: LoomFailureCode.ValidationFailed,
      text: validation.errors.join('\n'),
    };
    loomFailureDetail(loomFailureDetailArgs3);
  }

  verifyMergedAgentStatsSourcePr({ repoRoot, prNumber });

  const remotePath = `stats/ai-agent/${prNumber}.yaml`;
  const publishedArgs: RunCommandArgs = {
    command: 'node',
    args: [
      '.github/scripts/workbench-publish.cjs',
      absolute,
      remotePath,
      `stats: record Nook PR ${prNumber}`,
    ],
    cwd: repoRoot,
  };
  const published = runCommand(publishedArgs);
  if (published.exitCode !== 0) {
    const loomFailureDetailArgs2: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `workbench-publish failed: ${published.stderr || published.stdout}`,
    };
    loomFailureDetail(loomFailureDetailArgs2);
  }

  return {
    family: RequestFamily.AgentStats,
    operation: AgentStatsOperation.Publish,
    outputPath: absolute,
    messages: [`published ${remotePath}`, (published.stdout || 'ok').trim()],
  };
}

export function verifyMergedAgentStatsSourcePr(
  request: VerifyMergedAgentStatsSourcePrRequest,
): void {
  const viewArgs: RunCommandArgs = {
    command: 'gh',
    args: [
      'pr',
      'view',
      String(request.prNumber),
      '--json',
      `${AgentStatsSourcePrField.State},${AgentStatsSourcePrField.MergedAt}`,
    ],
    cwd: request.repoRoot,
  };
  const view = runCommand(viewArgs);
  if (view.exitCode !== 0) {
    const failure: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `gh pr view failed before stats publication: ${view.stderr || view.stdout}`,
    };
    loomFailureDetail(failure);
  }
  assertMergedAgentStatsSourcePr(view.stdout);
}

export function assertMergedAgentStatsSourcePr(serialized: string): void {
  let parsed: UntrustedYamlNode;
  try {
    parsed = asUntrustedYamlNode(JSON.parse(serialized) as UntrustedYamlNode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure: LoomFailureDetailArgs = {
      code: LoomFailureCode.PrMetadataInvalid,
      text: `Failed to parse source PR merge state: ${message}`,
    };
    loomFailureDetail(failure);
  }
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).length !== 2 ||
    Object.keys(parsed).some(
      (key) =>
        key !== AgentStatsSourcePrField.State &&
        key !== AgentStatsSourcePrField.MergedAt,
    )
  ) {
    const failure: LoomFailureDetailArgs = {
      code: LoomFailureCode.PrMetadataInvalid,
      text: 'Source PR merge state must contain exactly state and mergedAt',
    };
    loomFailureDetail(failure);
  }
  const state = untrustedYamlProperty({
    record: parsed,
    key: AgentStatsSourcePrField.State,
  });
  const mergedAt = untrustedYamlProperty({
    record: parsed,
    key: AgentStatsSourcePrField.MergedAt,
  });
  if (
    state.presence === UntrustedYamlPropertyPresence.Absent ||
    state.value !== GitHubPullRequestState.Merged ||
    mergedAt.presence === UntrustedYamlPropertyPresence.Absent ||
    typeof mergedAt.value !== 'string' ||
    mergedAt.value === '' ||
    Number.isNaN(Date.parse(mergedAt.value))
  ) {
    const failure: LoomFailureDetailArgs = {
      code: LoomFailureCode.PrMetadataInvalid,
      text: 'AI-agent stats publication requires a currently merged source PR',
    };
    loomFailureDetail(failure);
  }
}

type ValidateFileArgs = {
  readonly operation: AgentStatsOperation.Validate;
  readonly file: string;
};

function validateFile(args: ValidateFileArgs): AgentStatsReport {
  const { operation, file } = args;

  const prFromName = path.basename(file).replace(/\.ya?ml$/, '');
  const prNumber = Number.parseInt(prFromName, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    loomFailure(LoomFailureCode.StatsFilenameInvalid);
  }
  const content = readFileSync(file, 'utf8');
  const validationArgs: ValidateAgentStatsYamlArgs = {
    content,
    expectedPrNumber: prNumber,
  };
  const validation = validateAgentStatsYaml(validationArgs);
  if (!validation.ok) {
    const loomFailureDetailArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.ValidationFailed,
      text: validation.errors.join('\n'),
    };
    loomFailureDetail(loomFailureDetailArgs);
  }
  return {
    family: RequestFamily.AgentStats,
    operation,
    outputPath: path.resolve(file),
    messages: ['schema validation passed'],
  };
}
