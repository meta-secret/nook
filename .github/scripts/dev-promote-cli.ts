import { DevCli } from "./dev-cli.ts";
import { DevPromoteCommand } from "./dev-promote.ts";
import { CommitSha } from "./dev-types.ts";

if (import.meta.main) {
  const rawExpectedSha = process.env.EXPECTED_SHA;
  const expectedSha =
    typeof rawExpectedSha === "string"
      ? CommitSha.parse(rawExpectedSha)
      : DevCli.missingEnvironment("EXPECTED_SHA");
  process.exitCode = expectedSha.isErr()
    ? DevCli.report(expectedSha)
    : DevCli.report(
        new DevPromoteCommand({
          workspace: DevCli.workspace(),
          expectedSha: expectedSha.value,
        }).execute(),
      );
}
