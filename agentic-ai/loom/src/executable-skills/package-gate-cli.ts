import {
  EXECUTABLE_SKILL_GATE_ACTIONS,
  type ExecutableSkillGateAction,
  ExecutableSkillPackageGate,
} from './package-gate.ts';

const actionArgument = process.argv.at(2);
const repoRoot = process.argv.at(3);
const action = EXECUTABLE_SKILL_GATE_ACTIONS.find(
  (candidate) => candidate === actionArgument,
);

if (!action || typeof repoRoot !== 'string') {
  process.stderr.write(
    `Usage: package-gate-cli.ts <${EXECUTABLE_SKILL_GATE_ACTIONS.join('|')}> <repository-root>\n`,
  );
  process.exitCode = 1;
} else {
  const execution = new ExecutableSkillPackageGate({
    action: action satisfies ExecutableSkillGateAction,
    repoRoot,
  }).execute();
  if (execution.isErr()) {
    process.stderr.write(`${execution.error.message}\n`);
    process.exitCode = 1;
  }
}
