import { DevCli } from './dev-cli.ts';
import { DevPrManagerCommand } from './dev-pr-manager.ts';
import { CommitSha } from './dev-types.ts';

if (import.meta.main) {
  const rawExpectedSha = process.env.EXPECTED_SHA;
  const expectedSha =
    typeof rawExpectedSha === 'string'
      ? CommitSha.parse(rawExpectedSha)
      : DevCli.missingEnvironment('EXPECTED_SHA');
  process.exitCode = expectedSha.isErr()
    ? DevCli.report(expectedSha.map(() => ({ message: '' })))
    : DevCli.report(
        new DevPrManagerCommand({
          workspace: DevCli.workspace(),
          expectedSha: expectedSha.value,
        }).execute(),
      );
}
