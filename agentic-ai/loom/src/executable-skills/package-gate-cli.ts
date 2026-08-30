import {
  EXECUTABLE_SKILL_GATE_ACTIONS,
  runExecutableSkillPackageGate,
  type ExecutableSkillGateAction,
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
  throw new Error(
    `Usage: package-gate-cli.ts <${EXECUTABLE_SKILL_GATE_ACTIONS.join('|')}> <repository-root>`,
  );
}

const request = {
  action: action as ExecutableSkillGateAction,
  repoRoot,
} as const;
runExecutableSkillPackageGate(request);
