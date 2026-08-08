import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentStatsArgs } from '../codec/args/agent-stats.ts';
import { assembleAgentStats } from '../lib/agent-stats-assemble.ts';
import { validateAgentStatsYaml } from '../lib/agent-stats-schema.ts';
import { findRepoRoot } from '../lib/repo.ts';
import { runCommand } from '../lib/run.ts';
import { ResultKind, err, ok, type Result } from '../result.ts';

export type AgentStatsReport = {
  readonly action: string;
  readonly messages: string[];
  readonly outputPath: string;
};

export async function runAgentStats(
  args: AgentStatsArgs,
): Promise<Result<AgentStatsReport>> {
  switch (args.action) {
    case 'assemble':
      return assemble(args);
    case 'validate':
      return validate(args.file);
    case 'publish':
      return publish(args.file);
  }
}

async function assemble(
  args: Extract<AgentStatsArgs, { action: 'assemble' }>,
): Promise<Result<AgentStatsReport>> {
  const repo = findRepoRoot();
  if (repo.kind === ResultKind.Err) {
    return repo;
  }

  const assembled = await assembleAgentStats({
    repoRoot: repo.value,
    prNumber: args.pr,
    scratchPath: args.scratch,
    includeInventory: args.inventory,
  });
  if (assembled.kind === ResultKind.Err) {
    return assembled;
  }

  const outPath = path.resolve(args.out);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, assembled.value.yaml, 'utf8');

  const validation = validateAgentStatsYaml(assembled.value.yaml, args.pr);
  if (validation.kind === ResultKind.Err) {
    return validation;
  }
  if (!validation.value.ok) {
    return err(
      `Assembled YAML failed validation:\n${validation.value.errors.join('\n')}`,
    );
  }

  return ok({
    action: 'assemble',
    outputPath: outPath,
    messages: [
      `wrote ${outPath}`,
      'schema validation passed',
      'fill comparison and waste_assessment in the scratch log before publish when placeholders remain',
    ],
  });
}

async function validate(file: string): Promise<Result<AgentStatsReport>> {
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
    action: 'validate',
    outputPath: path.resolve(file),
    messages: ['schema validation passed'],
  });
}

async function publish(file: string): Promise<Result<AgentStatsReport>> {
  const repo = findRepoRoot();
  if (repo.kind === ResultKind.Err) {
    return repo;
  }
  const absolute = path.resolve(file);
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
    action: 'publish',
    outputPath: absolute,
    messages: [
      `published ${remotePath}`,
      (published.value.stdout || 'ok').trim(),
    ],
  });
}
