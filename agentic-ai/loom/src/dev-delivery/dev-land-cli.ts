import { DevCli } from './dev-cli.ts';
import { DevLandCommand } from './dev-land.ts';

if (import.meta.main) {
  const packet = DevCli.requiredDevLandPacket();
  if (packet.isErr()) {
    process.exitCode = DevCli.report(packet.map(() => ({ message: '' })));
  } else {
    const workspace = DevCli.workspace();
    const request = DevCli.observeDevLandRequest(workspace, packet.value);
    process.exitCode = request.isErr()
      ? DevCli.report(request.map(() => ({ message: '' })))
      : DevCli.report(new DevLandCommand(workspace).execute(request.value));
  }
}
