import {
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { err, ok, type Result } from "neverthrow";

import { DevFailureKind, type DevFailure } from "./dev-types.ts";

export enum DevLockName {
  LocalLanding = "nook-dev-local-landing.lock",
  Publication = "nook-dev-publication.lock",
}

enum DevLockLeaseState {
  Held = "held",
  Released = "released",
}

/** Owns one atomic common-directory lock and releases only its own lease. */
export class DevLock {
  constructor(
    private readonly request: {
      readonly commonDirectory: string;
      readonly name: DevLockName;
    },
  ) {}

  acquire(): Result<DevLockLease, DevFailure> {
    const lockPath = join(this.request.commonDirectory, this.request.name);
    try {
      mkdirSync(lockPath);
    } catch {
      return err({
        kind: DevFailureKind.Lock,
        message: `Unable to acquire ${this.request.name}; an active or stale lock may exist. Do not remove it automatically: ${lockPath}`,
      });
    }

    const token = randomUUID();
    const ownerPath = join(lockPath, "owner");
    try {
      writeFileSync(ownerPath, token, { encoding: "utf8", flag: "wx" });
    } catch {
      try {
        rmdirSync(lockPath);
      } catch {
        // The exact newly-created lock is retained if cleanup is unavailable.
      }
      return err({
        kind: DevFailureKind.Lock,
        message: `Unable to record ownership for ${this.request.name}: ${lockPath}`,
      });
    }
    return ok(new DevLockLease(lockPath, ownerPath, token));
  }
}

export class DevLockLease {
  private state = DevLockLeaseState.Held;

  constructor(
    private readonly lockPath: string,
    private readonly ownerPath: string,
    private readonly token: string,
  ) {}

  release(): Result<void, DevFailure> {
    if (this.state === DevLockLeaseState.Released) return ok();
    let owner: string;
    try {
      owner = readFileSync(this.ownerPath, "utf8");
    } catch {
      return err({
        kind: DevFailureKind.Lock,
        message: `Cannot verify ownership before releasing lock: ${this.lockPath}`,
      });
    }
    if (owner !== this.token) {
      return err({
        kind: DevFailureKind.Lock,
        message: `Refusing to release a lock no longer owned by this manager: ${this.lockPath}`,
      });
    }
    try {
      unlinkSync(this.ownerPath);
      rmdirSync(this.lockPath);
      this.state = DevLockLeaseState.Released;
      return ok();
    } catch {
      return err({
        kind: DevFailureKind.Lock,
        message: `Unable to release owned lock; inspect it before retrying: ${this.lockPath}`,
      });
    }
  }
}
