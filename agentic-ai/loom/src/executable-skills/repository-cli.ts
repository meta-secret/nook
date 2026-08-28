import {
  auditExecutableSkillPackageFiles,
  readTrackedRepositoryFiles,
} from './repository.ts';

const repoRoot = process.argv.at(2);
if (typeof repoRoot !== 'string')
  throw new Error('Repository root is required.');
const tracked = readTrackedRepositoryFiles(repoRoot);
const auditRequest = { repoRoot, tracked };
const findings = auditExecutableSkillPackageFiles(auditRequest);
if (findings.length > 0) {
  const diagnostic = { findings };
  process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
  process.exitCode = 1;
}
