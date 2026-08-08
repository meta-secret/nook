import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AgentStatsAssembleRequest,
  AgentStatsFileRequest,
} from '../codec/args/agent-stats.ts';
import { AgentStatsOperation, RequestFamily } from '../codec/enums.ts';
import { assembleAgentStats } from '../lib/agent-stats-assemble.ts';
import { validateAgentStatsYaml } from '../lib/agent-stats-schema.ts';
import { findRepoRoot } from '../lib/repo.ts';
import { runCommand } from '../lib/run.ts';
import {
  LoomFailureCode,
  loomFailure,
  loomFailureDetail,
} from '../loom-failure.ts';

import type { RunCommandArgs } from '../lib/run.ts';
import type { ValidateAgentStatsYamlArgs } from '../lib/agent-stats-schema.ts';
import type { LoomFailureDetailArgs } from '../loom-failure.ts';
export type AgentStatsReport = {
  readonly family: RequestFamily.AgentStats;
  readonly operation: AgentStatsOperation;
  readonly messages: string[];
  readonly outputPath: string;
};

export async function runAgentStatsAssemble(
  request: AgentStatsAssembleRequest,
): Promise<AgentStatsReport> {
  const repoRoot = findRepoRoot();
  const assembledArgs = {
    repoRoot,
    prNumber: request.prNumber,
    scratchPath: request.scratchPath,
    includeInventory: request.includeTestInventory,
  };
  const assembled = await assembleAgentStats(assembledArgs);

  const outPath = path.resolve(request.outputPath);
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
  const validateFileArgs: ValidateFileArgs = {
    operation: AgentStatsOperation.Validate,
    file: request.statsFile,
  };
  return validateFile(validateFileArgs);
}

export async function runAgentStatsPublish(
  request: AgentStatsFileRequest,
): Promise<AgentStatsReport> {
  const repoRoot = findRepoRoot();
  const absolute = path.resolve(request.statsFile);
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
