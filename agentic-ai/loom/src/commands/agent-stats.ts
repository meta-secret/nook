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
  const assembled = await assembleAgentStats({
    repoRoot,
    prNumber: request.prNumber,
    scratchPath: request.scratchPath,
    includeInventory: request.includeTestInventory,
  });

  const outPath = path.resolve(request.outputPath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, assembled.yaml, 'utf8');

  const validation = validateAgentStatsYaml({
    content: assembled.yaml,
    expectedPrNumber: request.prNumber,
  });
  if (!validation.ok) {
    loomFailureDetail({
      code: LoomFailureCode.ValidationFailed,
      text: `Assembled YAML failed validation:\n${validation.errors.join('\n')}`,
    });
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
  return validateFile({
    operation: AgentStatsOperation.Validate,
    file: request.statsFile,
  });
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
  const validation = validateAgentStatsYaml({
    content,
    expectedPrNumber: prNumber,
  });
  if (!validation.ok) {
    loomFailureDetail({
      code: LoomFailureCode.ValidationFailed,
      text: validation.errors.join('\n'),
    });
  }

  const remotePath = `stats/ai-agent/${prNumber}.yaml`;
  const published = runCommand({
    command: 'node',
    args: [
      '.github/scripts/workbench-publish.cjs',
      absolute,
      remotePath,
      `stats: record Nook PR ${prNumber}`,
    ],
    cwd: repoRoot,
  });
  if (published.exitCode !== 0) {
    loomFailureDetail({
      code: LoomFailureCode.CommandFailed,
      text: `workbench-publish failed: ${published.stderr || published.stdout}`,
    });
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
  const validation = validateAgentStatsYaml({
    content,
    expectedPrNumber: prNumber,
  });
  if (!validation.ok) {
    loomFailureDetail({
      code: LoomFailureCode.ValidationFailed,
      text: validation.errors.join('\n'),
    });
  }
  return {
    family: RequestFamily.AgentStats,
    operation,
    outputPath: path.resolve(file),
    messages: ['schema validation passed'],
  };
}
