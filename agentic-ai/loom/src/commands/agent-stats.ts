import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AgentStatsAssembleRequest,
  AgentStatsFileRequest,
} from '../codec/args/agent-stats.ts';
import { RequestKind } from '../codec/enums.ts';
import { assembleAgentStats } from '../lib/agent-stats-assemble.ts';
import { validateAgentStatsYaml } from '../lib/agent-stats-schema.ts';
import { findRepoRoot } from '../lib/repo.ts';
import { runCommand } from '../lib/run.ts';
import { ResultKind, err, ok, type Result } from '../result.ts';

export type AgentStatsReport = {
  readonly requestKind:
    | RequestKind.AgentStatsAssemble
    | RequestKind.AgentStatsValidate
    | RequestKind.AgentStatsPublish;
  readonly messages: string[];
  readonly outputPath: string;
};

export async function runAgentStatsAssemble(
  request: AgentStatsAssembleRequest,
): Promise<Result<AgentStatsReport>> {
  const repo = findRepoRoot();
  if (repo.kind === ResultKind.Err) {
    return repo;
  }

  const assembled = await assembleAgentStats({
    repoRoot: repo.value,
    prNumber: request.prNumber,
    scratchPath: request.scratchPath,
    includeInventory: request.includeTestInventory,
  });
  if (assembled.kind === ResultKind.Err) {
    return assembled;
  }

  const outPath = path.resolve(request.outputPath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, assembled.value.yaml, 'utf8');

  const validation = validateAgentStatsYaml(
    assembled.value.yaml,
    request.prNumber,
  );
  if (validation.kind === ResultKind.Err) {
    return validation;
  }
  if (!validation.value.ok) {
    return err(
      `Assembled YAML failed validation:\n${validation.value.errors.join('\n')}`,
    );
  }

  return ok({
    requestKind: RequestKind.AgentStatsAssemble,
    outputPath: outPath,
    messages: [
      `wrote ${outPath}`,
      'schema validation passed',
      'fill comparison and waste_assessment in the scratch log before publish when placeholders remain',
    ],
  });
}

export async function runAgentStatsValidate(
  request: AgentStatsFileRequest,
): Promise<Result<AgentStatsReport>> {
  return validateFile(RequestKind.AgentStatsValidate, request.statsFile);
}

export async function runAgentStatsPublish(
  request: AgentStatsFileRequest,
): Promise<Result<AgentStatsReport>> {
  const repo = findRepoRoot();
  if (repo.kind === ResultKind.Err) {
    return repo;
  }
  const absolute = path.resolve(request.statsFile);
  const prFromName = path.basename(absolute).replace(/\.ya?ml$/, '');
  const prNumber = Number.parseInt(prFromName, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return err('Stats filename must be <pr-number>.yaml');
  }

  const content = readFileSync(absolute, 'utf8');
  const validation = validateAgentStatsYaml(content, prNumber);
  if (validation.kind === ResultKind.Err) {
    return validation;
  }
  if (!validation.value.ok) {
    return err(validation.value.errors.join('\n'));
  }

  const remotePath = `stats/ai-agent/${prNumber}.yaml`;
  const published = runCommand(
    'node',
    [
      '.github/scripts/workbench-publish.cjs',
      absolute,
      remotePath,
      `stats: record Nook PR ${prNumber}`,
    ],
    repo.value,
  );
  if (published.kind === ResultKind.Err) {
    return published;
  }
  if (published.value.exitCode !== 0) {
    return err(
      `workbench-publish failed: ${published.value.stderr || published.value.stdout}`,
    );
  }

  return ok({
    requestKind: RequestKind.AgentStatsPublish,
    outputPath: absolute,
    messages: [
      `published ${remotePath}`,
      (published.value.stdout || 'ok').trim(),
    ],
  });
}

async function validateFile(
  requestKind: RequestKind.AgentStatsValidate,
  file: string,
): Promise<Result<AgentStatsReport>> {
  const prFromName = path.basename(file).replace(/\.ya?ml$/, '');
  const prNumber = Number.parseInt(prFromName, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return err('Stats filename must be <pr-number>.yaml');
  }
  const content = readFileSync(file, 'utf8');
  const validation = validateAgentStatsYaml(content, prNumber);
  if (validation.kind === ResultKind.Err) {
    return validation;
  }
  if (!validation.value.ok) {
    return err(validation.value.errors.join('\n'));
  }
  return ok({
    requestKind,
    outputPath: path.resolve(file),
    messages: ['schema validation passed'],
  });
}
