import { DevCli } from './dev-cli.ts';
import { DevManagerGizmoCommand } from './dev-manager-gizmo.ts';

if (import.meta.main) {
  process.exitCode = DevCli.report(
    new DevManagerGizmoCommand(DevCli.workspace()).execute(),
  );
}
