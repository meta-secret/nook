import { ExecutableSkillRepository } from './repository.ts';

const repoRoot = process.argv.at(2);
if (typeof repoRoot !== 'string') {
  process.stderr.write('Repository root is required.\n');
  process.exitCode = 1;
} else {
  const tracked = ExecutableSkillRepository.readTrackedFiles(repoRoot);
  if (tracked.isErr()) {
    process.stderr.write(`${tracked.error.message}\n`);
    process.exitCode = 1;
  } else {
    const findings = ExecutableSkillRepository.auditFiles({
      repoRoot,
      tracked: tracked.value,
    });
    if (findings.length > 0) {
      process.stderr.write(`${JSON.stringify({ findings })}\n`);
      process.exitCode = 1;
    }
  }
}
