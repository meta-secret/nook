import { DevCli } from './dev-cli.ts';
import { DevPrManagerCommand } from './dev-pr-manager.ts';

if (import.meta.main) {
  process.exitCode = DevCli.report(
    new DevPrManagerCommand(DevCli.workspace()).execute(),
  );
}
