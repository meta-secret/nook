import {
  ExecutableSkillRepository,
  ExecutableSkillCheckout,
} from './repository.ts';

const repoRoot = process.argv.at(2);
if (typeof repoRoot !== 'string') {
  process.stderr.write('Repository root is required.\n');
  process.exitCode = 1;
} else {
  const tracked = new ExecutableSkillCheckout(repoRoot).readTrackedFiles();
  if (tracked.isErr()) {
    process.stderr.write(`${tracked.error.message}\n`);
    process.exitCode = 1;
  } else {
    const findings = new ExecutableSkillRepository({
      repoRoot,
      tracked: tracked.value,
    }).findings();
    if (findings.length > 0) {
      process.stderr.write(`${JSON.stringify({ findings })}\n`);
      process.exitCode = 1;
    }
  }
}
