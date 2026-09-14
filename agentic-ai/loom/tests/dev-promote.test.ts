import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok } from 'neverthrow';
import { expect, test } from 'bun:test';

import { DevPromoteCommand } from '../src/dev-delivery/dev-promote.ts';
import { DevDeliveryWorkspace } from '../src/dev-delivery/dev-workspace.ts';
import {
  DevLock,
  DevLockName,
  type DevLockLease,
} from '../src/dev-delivery/dev-lock.ts';
import {
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
  CommitSha,
  DevFailureKind,
  type DevFailure,
} from '../src/dev-delivery/dev-types.ts';

const SHA = '1111111111111111111111111111111111111111';

class RefreshFailureRunner implements CommandRunner {
  constructor(private readonly failure: DevFailure) {}

  run(_request: CommandRequest) {
    return err<CommandOutput, DevFailure>(this.failure);
  }
}

class LeaseInjectingWorkspace extends DevDeliveryWorkspace {
  private readonly publication: DevLockLease;
  private readonly local: DevLockLease;

  constructor(request: {
    readonly root: string;
    readonly publication: DevLockLease;
    readonly local: DevLockLease;
    readonly failure: DevFailure;
  }) {
    super({
      root: request.root,
      runner: new RefreshFailureRunner(request.failure),
    });
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

test('promotion releases publication after local lock release fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'nook-dev-promote-lock-'));
  try {
    const publication = new DevLock({
      commonDirectory: root,
      name: DevLockName.Publication,
    }).acquire();
    const local = new DevLock({
      commonDirectory: root,
      name: DevLockName.LocalLanding,
    }).acquire();
    expect(publication.isOk()).toBe(true);
    expect(local.isOk()).toBe(true);
    if (publication.isErr() || local.isErr()) return;

    unlinkSync(join(root, DevLockName.LocalLanding, 'owner'));
    const failure: DevFailure = {
      kind: DevFailureKind.Git,
      message: 'refresh failed',
    };
    const workspace = new LeaseInjectingWorkspace({
      root,
      publication: publication.value,
      local: local.value,
      failure,
    });
    const expectedSha = CommitSha.parse(SHA);
    expect(expectedSha.isOk()).toBe(true);
    if (expectedSha.isErr()) return;

    const result = new DevPromoteCommand({
      workspace,
      expectedSha: expectedSha.value,
    }).execute();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Lock);
    expect(existsSync(join(root, DevLockName.Publication))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
