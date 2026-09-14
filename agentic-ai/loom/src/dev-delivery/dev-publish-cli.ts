import { DevCli } from './dev-cli.ts';
import { DevPublishCommand } from './dev-publish.ts';

if (import.meta.main) {
  const expectedSha = DevCli.requiredCommitSha('EXPECTED_SHA');
  process.exitCode = expectedSha.isErr()
    ? DevCli.report(expectedSha.map(() => ({ message: '' })))
    : DevCli.report(
        new DevPublishCommand(DevCli.workspace()).execute({
          expectedSha: expectedSha.value,
        }),
      );
}
