import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { CortexSessionCleanRequest } from '../codec/args/cortex-session-clean.ts';
import { RepositoryRoot } from '../lib/repo.ts';
import {
  LoomFailureCode,
  type LoomFailureDetailArgs,
  LoomFailure,
} from '../loom-failure.ts';

export type CortexSessionCleanReport = {
  readonly sessionClean: true;
};

export type InspectCortexSessionRequest = {
  readonly repoRoot: string;
};

export type CortexSessionInspection =
  | { readonly sessionClean: true }
  | { readonly sessionClean: false; readonly activeEntry: string };

/** Owns the cortex session directory registry and its capability transitions. */
export class CortexSessionDirectory {
  private constructor() {}
  private static readonly noThrowStatOptions = {
    throwIfNoEntry: false,
  } as const;

  static inspectCortexSession(
    request: InspectCortexSessionRequest,
  ): CortexSessionInspection {
    const sessionRoot = path.join(request.repoRoot, '.cortex', '.session');
    const sessionRootStat = lstatSync(
      sessionRoot,
      CortexSessionDirectory.noThrowStatOptions,
    );
    if (!sessionRootStat) {
      return { sessionClean: true };
    }

    if (!sessionRootStat.isDirectory()) {
      return {
        sessionClean: false,
        activeEntry: path.relative(request.repoRoot, sessionRoot),
      };
    }

    const activeEntry =
      CortexSessionDirectory.firstNonDirectoryEntry(sessionRoot);
    if (activeEntry === false) {
      return { sessionClean: true };
    }
    return {
      sessionClean: false,
      activeEntry: path.relative(request.repoRoot, activeEntry),
    };
  }

  static async runCortexSessionClean(
    _request: CortexSessionCleanRequest,
  ): Promise<CortexSessionCleanReport> {
    const inspectRequest: InspectCortexSessionRequest = {
      repoRoot: RepositoryRoot.find(),
    };
    const inspection =
      CortexSessionDirectory.inspectCortexSession(inspectRequest);
    if (!inspection.sessionClean) {
      const failureArgs: LoomFailureDetailArgs = {
        code: LoomFailureCode.ValidationFailed,
        text: `PR readiness requires removing temporary Cortex session memory: ${inspection.activeEntry}`,
      };
      LoomFailure.detail(failureArgs);
    }
    return { sessionClean: true };
  }

  private static firstNonDirectoryEntry(root: string): string | false {
    const entries = readdirSync(root).sort();
    for (const entry of entries) {
      const entryPath = path.join(root, entry);
      if (!lstatSync(entryPath).isDirectory()) {
        return entryPath;
      }
      const nestedEntry =
        CortexSessionDirectory.firstNonDirectoryEntry(entryPath);
      if (nestedEntry !== false) {
        return nestedEntry;
      }
    }
    return false;
  }
}
