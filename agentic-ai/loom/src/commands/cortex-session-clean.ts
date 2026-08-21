import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { CortexSessionCleanRequest } from '../codec/args/cortex-session-clean.ts';
import { findRepoRoot } from '../lib/repo.ts';
import {
  LoomFailureCode,
  loomFailureDetail,
  type LoomFailureDetailArgs,
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

const noThrowStatOptions = { throwIfNoEntry: false } as const;

export function inspectCortexSession(
  request: InspectCortexSessionRequest,
): CortexSessionInspection {
  const sessionRoot = path.join(request.repoRoot, '.cortex', '.session');
  const sessionRootStat = lstatSync(sessionRoot, noThrowStatOptions);
  if (!sessionRootStat) {
    return { sessionClean: true };
  }

  if (!sessionRootStat.isDirectory()) {
    return {
      sessionClean: false,
      activeEntry: path.relative(request.repoRoot, sessionRoot),
    };
  }

  const activeEntry = firstNonDirectoryEntry(sessionRoot);
  if (activeEntry === false) {
    return { sessionClean: true };
  }
  return {
    sessionClean: false,
    activeEntry: path.relative(request.repoRoot, activeEntry),
  };
}

export async function runCortexSessionClean(
  _request: CortexSessionCleanRequest,
): Promise<CortexSessionCleanReport> {
  const inspectRequest: InspectCortexSessionRequest = {
    repoRoot: findRepoRoot(),
  };
  const inspection = inspectCortexSession(inspectRequest);
  if (!inspection.sessionClean) {
    const failureArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.ValidationFailed,
      text: `PR readiness requires removing temporary Cortex session memory: ${inspection.activeEntry}`,
    };
    loomFailureDetail(failureArgs);
  }
  return { sessionClean: true };
}

function firstNonDirectoryEntry(root: string): string | false {
  const entries = readdirSync(root).sort();
  for (const entry of entries) {
    const entryPath = path.join(root, entry);
    if (!lstatSync(entryPath).isDirectory()) {
      return entryPath;
    }
    const nestedEntry = firstNonDirectoryEntry(entryPath);
    if (nestedEntry !== false) {
      return nestedEntry;
    }
  }
  return false;
}
