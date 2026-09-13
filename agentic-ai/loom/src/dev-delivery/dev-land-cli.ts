import { DevCli } from './dev-cli.ts';
import { DevLandCommand } from './dev-land.ts';

if (import.meta.main) {
  const expectedFeatureSha = DevCli.requiredCommitSha('EXPECTED_FEATURE_SHA');
  process.exitCode = expectedFeatureSha.isErr()
    ? DevCli.report(expectedFeatureSha.map(() => ({ message: '' })))
    : DevCli.report(
        new DevLandCommand(DevCli.workspace()).execute({
          expectedFeatureSha: expectedFeatureSha.value,
        }),
      );
}
