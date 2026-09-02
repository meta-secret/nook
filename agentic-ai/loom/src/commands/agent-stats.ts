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
import { stringProperty } from '../lib/agent-stats-github-api.ts';
import { findRepoRoot } from '../lib/repo.ts';
import { runCommand } from '../lib/run.ts';
import {
  UntrustedYamlPropertyPresence,
  asUntrustedYamlNode,
  isRecord,
  untrustedYamlProperty,
  type UntrustedYamlMap,
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

export enum GitHubPullRequestState {
  Merged = 'MERGED',
}

export type AgentStatsSourceIdentity = {
  readonly headSha: string;
  readonly mergeSha: string;
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

  verifyMergedAgentStatsSourcePr({
    repoRoot,
    prNumber,
    sourceIdentity: agentStatsSourceIdentity(content),
  });

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

export function verifyMergedAgentStatsSourcePr(request: {
  readonly repoRoot: string;
  readonly prNumber: number;
  readonly sourceIdentity: AgentStatsSourceIdentity;
}): void {
  const viewArgs: RunCommandArgs = {
    command: 'gh',
    args: [
      'pr',
      'view',
      String(request.prNumber),
      '--json',
      'state,mergedAt,headRefOid,mergeCommit',
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
  assertMergedAgentStatsSourcePr(view.stdout, request.sourceIdentity);
}

export function assertMergedAgentStatsSourcePr(
  serialized: string,
  expected: AgentStatsSourceIdentity,
): void {
  let parsed: UntrustedYamlNode;
  try {
    parsed = asUntrustedYamlNode(JSON.parse(serialized) as UntrustedYamlNode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failPrMetadata(`Failed to parse source PR merge state: ${message}`);
  }
  if (!isRecord(parsed) || Object.keys(parsed).length !== 4) {
    failPrMetadata('Source PR metadata has an invalid field set');
  }
  const mergeCommit = recordProperty(parsed, 'mergeCommit');
  if (Object.keys(mergeCommit).length !== 1) {
    failPrMetadata('Source PR mergeCommit has an invalid field set');
  }
  const state = stringProperty({ record: parsed, key: 'state' });
  const mergedAt = stringProperty({ record: parsed, key: 'mergedAt' });
  const headSha = stringProperty({ record: parsed, key: 'headRefOid' });
  const mergeSha = stringProperty({ record: mergeCommit, key: 'oid' });
  if (
    state !== GitHubPullRequestState.Merged ||
    mergedAt === '' ||
    Number.isNaN(Date.parse(mergedAt))
  ) {
    failPrMetadata(
      'AI-agent stats publication requires a currently merged source PR',
    );
  }
  if (headSha !== expected.headSha || mergeSha !== expected.mergeSha) {
    failPrMetadata(
      'AI-agent stats source PR commit identity does not match GitHub',
    );
  }
}

function agentStatsSourceIdentity(content: string): AgentStatsSourceIdentity {
  const parsed = asUntrustedYamlNode(
    Bun.YAML.parse(content) as UntrustedYamlNode,
  );
  if (!isRecord(parsed)) failPrMetadata('Agent stats root must be a mapping');
  const sourcePr = recordProperty(parsed, 'source_pr');
  return {
    headSha: stringProperty({ record: sourcePr, key: 'head_sha' }),
    mergeSha: stringProperty({ record: sourcePr, key: 'merge_sha' }),
  };
}

function recordProperty(
  record: UntrustedYamlMap,
  key: string,
): UntrustedYamlMap {
  const property = untrustedYamlProperty({ record, key });
  if (
    property.presence === UntrustedYamlPropertyPresence.Absent ||
    !isRecord(property.value)
  ) {
    failPrMetadata(`Agent stats metadata field ${key} must be a mapping`);
  }
  return property.value;
}

function failPrMetadata(text: string): never {
  loomFailureDetail({ code: LoomFailureCode.PrMetadataInvalid, text });
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
