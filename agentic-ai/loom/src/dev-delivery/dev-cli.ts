import { resolve } from 'node:path';
import { err, type Result } from 'neverthrow';

import { ProcessCommandRunner } from './dev-command.ts';
import { DevDeliveryWorkspace } from './dev-workspace.ts';
import { DevFailureKind, type DevFailure } from './dev-types.ts';

export interface DevCliMessage {
  readonly message: string;
}

/** Provides the manual task boundary and a single human-readable failure format. */
export class DevCli {
  static repositoryRoot(): string {
    const configured = process.env.REPO_ROOT;
    return typeof configured === 'string' && configured.length > 0
      ? resolve(configured)
      : resolve(process.cwd());
  }

  static workspace(): DevDeliveryWorkspace {
    return new DevDeliveryWorkspace(
      DevCli.repositoryRoot(),
      new ProcessCommandRunner(),
    );
  }

  static report(result: Result<DevCliMessage, DevFailure>): number {
    if (result.isErr()) {
      process.stderr.write(`[${result.error.kind}] ${result.error.message}\n`);
      return 1;
    }
    process.stdout.write(`${result.value.message}\n`);
    return 0;
  }

  static missingEnvironment(name: string): Result<never, DevFailure> {
    return err({
      kind: DevFailureKind.Configuration,
      message: `${name} is required for this manual dev-manager task`,
    });
  }
}
