import {
  EXECUTABLE_SKILL_GATE_ACTIONS,
  type ExecutableSkillGateAction,
  ExecutableSkillPackageGate,
} from './package-gate.ts';

const action = process.argv.at(2);
const repoRoot = process.argv.at(3);

if (
  typeof action !== 'string' ||
  !EXECUTABLE_SKILL_GATE_ACTIONS.includes(
    action as ExecutableSkillGateAction,
  ) ||
  typeof repoRoot !== 'string'
) {
  process.stderr.write(
    `Usage: package-gate-cli.ts <${EXECUTABLE_SKILL_GATE_ACTIONS.join('|')}> <repository-root>\n`,
  );
  process.exitCode = 1;
} else {
  const execution = new ExecutableSkillPackageGate({
    action: action as ExecutableSkillGateAction,
    repoRoot,
  }).execute();
  if (execution.isErr()) {
    process.stderr.write(`${execution.error.message}\n`);
    process.exitCode = 1;
  }
}
