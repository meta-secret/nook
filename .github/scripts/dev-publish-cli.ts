import { DevCli } from "./dev-cli.ts";
import { DevPublishCommand } from "./dev-publish.ts";

if (import.meta.main) {
  process.exitCode = DevCli.report(
    new DevPublishCommand(DevCli.workspace()).execute(),
  );
}
