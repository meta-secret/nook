import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { err, ok, type Result } from 'neverthrow';

import { DevManagerGizmoCommand } from '../src/dev-delivery/dev-manager-gizmo.ts';
import { DevLockLease } from '../src/dev-delivery/dev-lock.ts';
import { DevDeliveryWorkspace } from '../src/dev-delivery/dev-workspace.ts';
import {
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
  DevFailureKind,
  type DevFailure,
} from '../src/dev-delivery/dev-types.ts';

class FailingRunner implements CommandRunner {
  run(_request: CommandRequest): Result<CommandOutput, DevFailure> {
    return err({ kind: DevFailureKind.Git, message: 'inspection failed' });
  }
}

class RecordingLease extends DevLockLease {
  releaseCount = 0;

  constructor(private readonly releaseResult: Result<void, DevFailure>) {
    super({ lockPath: '/unused', ownerPath: '/unused/owner', token: 'unused' });
  }

  override release(): Result<void, DevFailure> {
    this.releaseCount += 1;
    return this.releaseResult;
  }
}

class LeaseWorkspace extends DevDeliveryWorkspace {
  private readonly publication: DevLockLease;
  private readonly local: DevLockLease;

  constructor(request: {
    readonly root: string;
    readonly publication: DevLockLease;
    readonly local: DevLockLease;
  }) {
    super({ root: request.root, runner: new FailingRunner() });
    this.publication = request.publication;
    this.local = request.local;
  }

  override publicationLock() {
    return ok(this.publication);
  }

  override localLock() {
    return ok(this.local);
  }
}

test('manager attempts publication release when local release fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'nook-manager-lock-'));
  try {
    const localFailure: DevFailure = {
      kind: DevFailureKind.Lock,
      message: 'local release failed',
    };
    const local = new RecordingLease(err(localFailure));
    const publication = new RecordingLease(ok());
    const result = new DevManagerGizmoCommand(
      new LeaseWorkspace({ root, publication, local }),
    ).execute();

    expect(local.releaseCount).toBe(1);
    expect(publication.releaseCount).toBe(1);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toEqual(localFailure);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
