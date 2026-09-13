import { DevCli } from './dev-cli.ts';
import { DevLandCommand } from './dev-land.ts';

if (import.meta.main) {
  const packet = DevCli.requiredDevLandPacket();
  process.exitCode = packet.isErr()
    ? DevCli.report(packet.map(() => ({ message: '' })))
    : DevCli.report(
        new DevLandCommand(DevCli.workspace()).execute(packet.value),
      );
}
