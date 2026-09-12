import { lstatSync, readdirSync, type Stats } from 'node:fs';
import path from 'node:path';
import { err, ok, type Result } from 'neverthrow';

export type CortexSessionCleanReport = { readonly sessionClean: true };
export type InspectCortexSessionRequest = { readonly repoRoot: string };
export type CortexSessionInspection =
  | { readonly sessionClean: true }
  | { readonly sessionClean: false; readonly activeEntry: string };

export enum CortexSessionFailureKind {
  Read = 'read',
  ActiveMemory = 'activeMemory',
}
export type CortexSessionFailure = {
  readonly kind: CortexSessionFailureKind;
  readonly message: string;
};

/** Owns inspection and admission of the repository's temporary session tree. */
export class CortexSessionDirectory {
  constructor(private readonly request: InspectCortexSessionRequest) {}

  inspect(): Result<CortexSessionInspection, CortexSessionFailure> {
    const sessionRoot = path.join(this.request.repoRoot, '.cortex', '.session');
    const status = new CortexSessionEntry(sessionRoot).status();
    if (status.isErr()) return err(status.error);
    if (!status.value) return ok({ sessionClean: true });
    if (!status.value.isDirectory()) {
      return ok({
        sessionClean: false,
        activeEntry: path.relative(this.request.repoRoot, sessionRoot),
      });
    }
    return this.firstNonDirectoryEntry(sessionRoot).map((entry) =>
      entry === false
        ? { sessionClean: true }
        : {
            sessionClean: false,
            activeEntry: path.relative(this.request.repoRoot, entry),
          },
    );
  }

  clean(): Result<CortexSessionCleanReport, CortexSessionFailure> {
    return this.inspect().andThen((inspection) => {
      if (inspection.sessionClean) {
        const report: CortexSessionCleanReport = { sessionClean: true };
        return ok(report);
      }
      return err({
        kind: CortexSessionFailureKind.ActiveMemory,
        message: `PR readiness requires removing temporary Cortex session memory: ${inspection.activeEntry}`,
      });
    });
  }

  private firstNonDirectoryEntry(
    root: string,
  ): Result<string | false, CortexSessionFailure> {
    const entries = new CortexSessionEntry(root).children();
    if (entries.isErr()) return err(entries.error);
    for (const entry of entries.value) {
      const entryPath = path.join(root, entry);
      const status = new CortexSessionEntry(entryPath).status();
      if (status.isErr()) return err(status.error);
      // Traversal must observe a consistent entry before declaring the tree clean.
      if (!status.value)
        return err({
          kind: CortexSessionFailureKind.Read,
          message: `Cortex session entry disappeared during inspection: ${entryPath}`,
        });
      if (!status.value.isDirectory()) return ok(entryPath);
      const nested = this.firstNonDirectoryEntry(entryPath);
      if (nested.isErr()) return err(nested.error);
      if (nested.value !== false) return ok(nested.value);
    }
    return ok(false);
  }
}

/** Native filesystem failures enter the session contract at these reads. */
class CortexSessionEntry {
  constructor(private readonly absolutePath: string) {}
  status(): Result<Stats | false, CortexSessionFailure> {
    try {
      return ok(
        lstatSync(this.absolutePath, { throwIfNoEntry: false }) || false,
      );
    } catch {
      return err({
        kind: CortexSessionFailureKind.Read,
        message: `Cannot inspect Cortex session entry: ${this.absolutePath}`,
      });
    }
  }
  children(): Result<readonly string[], CortexSessionFailure> {
    try {
      return ok(readdirSync(this.absolutePath).sort());
    } catch {
      return err({
        kind: CortexSessionFailureKind.Read,
        message: `Cannot read Cortex session directory: ${this.absolutePath}`,
      });
    }
  }
}
