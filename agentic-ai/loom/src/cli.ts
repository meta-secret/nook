#!/usr/bin/env bun
import { runAgentStats } from './commands/agent-stats.ts';
import { runCortexAudit } from './commands/cortex-audit.ts';
import { runPrLand } from './commands/pr-land.ts';
import { runPrePush } from './commands/pre-push.ts';
import { runSkillScaffold } from './commands/skill-scaffold.ts';
import { requireBun } from './lib/repo.ts';
import { ResultKind, type Result } from './result.ts';

const HELP = `Loom — mechanical cortex rites as Bun CLIs

Usage:
  loom <command> [args]

Commands:
  pre-push                 Host task format + UI demo contract
  cortex-audit [--density] Audit .cortex links and skill index
  skill-scaffold <slug>    Create a dynamic-skill card [--wrappers]
  agent-stats <action>     assemble|validate|publish AI-agent stats YAML
  pr-land <action>         status|validate|ready|merge-check
  help                     Show this help

Task wrappers (from repo root):
  task loom:pre-push
  task loom:cortex-audit
  task loom:skill-scaffold SLUG=<slug>
  task loom:agent-stats ARGS='...'
  task loom:pr-land ARGS='...'
`;

async function main(): Promise<number> {
  const bun = requireBun();
  if (bun.kind === ResultKind.Err) {
    console.error(bun.message);
    return 2;
  }

  const argv = process.argv.slice(2);
  const command = argv[0];
  const args = argv.slice(1);

  if (
    typeof command !== 'string' ||
    command === 'help' ||
    command === '--help'
  ) {
    console.log(HELP);
    return typeof command === 'string' ? 0 : 2;
  }

  let result: Result<unknown>;
  switch (command) {
    case 'pre-push':
      result = await runPrePush(args);
      break;
    case 'cortex-audit':
      result = await runCortexAudit(args);
      break;
    case 'skill-scaffold':
      result = await runSkillScaffold(args);
      break;
    case 'agent-stats':
      result = await runAgentStats(args);
      break;
    case 'pr-land':
      result = await runPrLand(args);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      return 2;
  }

  if (result.kind === ResultKind.Err) {
    console.error(result.message);
    return 1;
  }

  console.log(stringifyReport(result.value));

  if (
    command === 'cortex-audit' &&
    typeof result.value === 'object' &&
    result.value instanceof Object &&
    'ok' in result.value &&
    result.value.ok === false
  ) {
    return 1;
  }

  return 0;
}

function stringifyReport(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry, 2);
}

const exitCode = await main();
process.exit(exitCode);
