import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { flagPresent, positionalArgs, requireOption } from '../lib/args.ts'
import { assembleAgentStats } from '../lib/agent-stats-assemble.ts'
import { validateAgentStatsYaml } from '../lib/agent-stats-schema.ts'
import { findRepoRoot } from '../lib/repo.ts'
import { runCommand } from '../lib/run.ts'
import { ResultKind, err, ok, type Result } from '../result.ts'

export type AgentStatsReport = {
  readonly action: string
  readonly messages: string[]
  readonly outputPath: string
}

export async function runAgentStats(
  args: readonly string[],
): Promise<Result<AgentStatsReport>> {
  const action = positionalArgs(args)[0]
  if (typeof action !== 'string') {
    return err(
      'Usage: loom agent-stats <assemble|validate|publish> [options]',
    )
  }

  switch (action) {
    case 'assemble':
      return assemble(args)
    case 'validate':
      return validate(args)
    case 'publish':
      return publish(args)
    default:
      return err(`Unknown agent-stats action: ${action}`)
  }
}

async function assemble(
  args: readonly string[],
): Promise<Result<AgentStatsReport>> {
  const repo = findRepoRoot()
  if (repo.kind === ResultKind.Err) {
    return repo
  }
  const prRaw = requireOption(args, '--pr')
  if (prRaw.kind === ResultKind.Err) {
    return prRaw
  }
  const prNumber = Number.parseInt(prRaw.value, 10)
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return err('--pr must be a positive integer')
  }
  const scratch = requireOption(args, '--scratch')
  if (scratch.kind === ResultKind.Err) {
    return scratch
  }
  const out = requireOption(args, '--out')
  if (out.kind === ResultKind.Err) {
    return out
  }
  const includeInventory = flagPresent(args, '--inventory')

  const assembled = await assembleAgentStats({
    repoRoot: repo.value,
    prNumber,
    scratchPath: scratch.value,
    includeInventory,
  })
  if (assembled.kind === ResultKind.Err) {
    return assembled
  }

  const outPath = path.resolve(out.value)
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, assembled.value.yaml, 'utf8')

  const validation = validateAgentStatsYaml(assembled.value.yaml, prNumber)
  if (validation.kind === ResultKind.Err) {
    return validation
  }
  if (!validation.value.ok) {
    return err(
      `Assembled YAML failed validation:\n${validation.value.errors.join('\n')}`,
    )
  }

  return ok({
    action: 'assemble',
    outputPath: outPath,
    messages: [
      `wrote ${outPath}`,
      'schema validation passed',
      'fill comparison and waste_assessment in the scratch log before publish when placeholders remain',
    ],
  })
}

async function validate(
  args: readonly string[],
): Promise<Result<AgentStatsReport>> {
  const file = requireOption(args, '--file')
  if (file.kind === ResultKind.Err) {
    return file
  }
  const prFromName = path.basename(file.value).replace(/\.ya?ml$/, '')
  const prNumber = Number.parseInt(prFromName, 10)
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return err('Stats filename must be <pr-number>.yaml')
  }
  const content = readFileSync(file.value, 'utf8')
  const validation = validateAgentStatsYaml(content, prNumber)
  if (validation.kind === ResultKind.Err) {
    return validation
  }
  if (!validation.value.ok) {
    return err(validation.value.errors.join('\n'))
  }
  return ok({
    action: 'validate',
    outputPath: path.resolve(file.value),
    messages: ['schema validation passed'],
  })
}

async function publish(
  args: readonly string[],
): Promise<Result<AgentStatsReport>> {
  const repo = findRepoRoot()
  if (repo.kind === ResultKind.Err) {
    return repo
  }
  const file = requireOption(args, '--file')
  if (file.kind === ResultKind.Err) {
    return file
  }
  const absolute = path.resolve(file.value)
  const prFromName = path.basename(absolute).replace(/\.ya?ml$/, '')
  const prNumber = Number.parseInt(prFromName, 10)
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return err('Stats filename must be <pr-number>.yaml')
  }

  const content = readFileSync(absolute, 'utf8')
  const validation = validateAgentStatsYaml(content, prNumber)
  if (validation.kind === ResultKind.Err) {
    return validation
  }
  if (!validation.value.ok) {
    return err(validation.value.errors.join('\n'))
  }

  const remotePath = `stats/ai-agent/${prNumber}.yaml`
  const published = runCommand(
    'node',
    [
      '.github/scripts/workbench-publish.cjs',
      absolute,
      remotePath,
      `stats: record Nook PR ${prNumber}`,
    ],
    repo.value,
  )
  if (published.kind === ResultKind.Err) {
    return published
  }
  if (published.value.exitCode !== 0) {
    return err(
      `workbench-publish failed: ${published.value.stderr || published.value.stdout}`,
    )
  }

  return ok({
    action: 'publish',
    outputPath: absolute,
    messages: [
      `published ${remotePath}`,
      (published.value.stdout || 'ok').trim(),
    ],
  })
}
