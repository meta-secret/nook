import { DevCli } from "./dev-cli.ts";
import { DevLandCommand } from "./dev-land.ts";

if (import.meta.main) {
  process.exitCode = DevCli.report(
    new DevLandCommand(DevCli.workspace()).execute(),
  );
}
