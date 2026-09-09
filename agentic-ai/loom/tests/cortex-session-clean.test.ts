import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';

import type { MakeDirectoryOptions, RmDirOptions } from 'node:fs';

import { tmpdir } from 'node:os';

import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  type CortexSessionInspection,
  type InspectCortexSessionRequest,
  CortexSessionDirectory,
} from '../src/commands/cortex-session-clean.ts';

export class CortexSessionCleanScenario {
  private constructor(private readonly request: RepositoryRootVisitor) {}

  static withRepositoryRoot(visitor: RepositoryRootVisitor): void {
    return new CortexSessionCleanScenario(visitor).execute();
  }

  private execute(): void {
    const visitor = this.request;
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'cortex-session-clean-'));
    try {
      visitor(repoRoot);
    } finally {
      rmSync(repoRoot, recursiveRemoveOptions);
    }
  }
}

const recursiveDirectoryOptions: MakeDirectoryOptions = { recursive: true };

const recursiveRemoveOptions: RmDirOptions = {
  recursive: true,
  force: true,
};

describe('inspectCortexSession', () => {
  test('accepts a missing session directory', () => {
    CortexSessionCleanScenario.withRepositoryRoot((repoRoot) => {
      const request: InspectCortexSessionRequest = { repoRoot };
      const expected: CortexSessionInspection = { sessionClean: true };
      expect(CortexSessionDirectory.inspectCortexSession(request)).toEqual(
        expected,
      );
    });
  });

  test('accepts empty nested session directories', () => {
    CortexSessionCleanScenario.withRepositoryRoot((repoRoot) => {
      const nested = path.join(repoRoot, '.cortex', '.session', 'nested');
      mkdirSync(nested, recursiveDirectoryOptions);
      const request: InspectCortexSessionRequest = { repoRoot };
      const expected: CortexSessionInspection = { sessionClean: true };
      expect(CortexSessionDirectory.inspectCortexSession(request)).toEqual(
        expected,
      );
    });
  });

  test('reports the first nested session file', () => {
    CortexSessionCleanScenario.withRepositoryRoot((repoRoot) => {
      const nested = path.join(repoRoot, '.cortex', '.session', 'nested');
      mkdirSync(nested, recursiveDirectoryOptions);
      writeFileSync(path.join(nested, 'active.md'), '# Active\n');
      const request: InspectCortexSessionRequest = { repoRoot };
      const expected: CortexSessionInspection = {
        sessionClean: false,
        activeEntry: path.join('.cortex', '.session', 'nested', 'active.md'),
      };
      expect(CortexSessionDirectory.inspectCortexSession(request)).toEqual(
        expected,
      );
    });
  });

  test('treats a symlink as active session memory', () => {
    CortexSessionCleanScenario.withRepositoryRoot((repoRoot) => {
      const sessionRoot = path.join(repoRoot, '.cortex', '.session');
      mkdirSync(sessionRoot, recursiveDirectoryOptions);
      symlinkSync(repoRoot, path.join(sessionRoot, 'linked'));
      const request: InspectCortexSessionRequest = { repoRoot };
      const expected: CortexSessionInspection = {
        sessionClean: false,
        activeEntry: path.join('.cortex', '.session', 'linked'),
      };
      expect(CortexSessionDirectory.inspectCortexSession(request)).toEqual(
        expected,
      );
    });
  });

  test('treats the session root symlink as active memory', () => {
    CortexSessionCleanScenario.withRepositoryRoot((repoRoot) => {
      const cortexRoot = path.join(repoRoot, '.cortex');
      mkdirSync(cortexRoot, recursiveDirectoryOptions);
      symlinkSync(repoRoot, path.join(cortexRoot, '.session'));
      const request: InspectCortexSessionRequest = { repoRoot };
      const expected: CortexSessionInspection = {
        sessionClean: false,
        activeEntry: path.join('.cortex', '.session'),
      };
      expect(CortexSessionDirectory.inspectCortexSession(request)).toEqual(
        expected,
      );
    });
  });

  test('treats a dangling session root symlink as active memory', () => {
    CortexSessionCleanScenario.withRepositoryRoot((repoRoot) => {
      const cortexRoot = path.join(repoRoot, '.cortex');
      mkdirSync(cortexRoot, recursiveDirectoryOptions);
      symlinkSync(
        path.join(repoRoot, 'missing-session-target'),
        path.join(cortexRoot, '.session'),
      );
      const request: InspectCortexSessionRequest = { repoRoot };
      const expected: CortexSessionInspection = {
        sessionClean: false,
        activeEntry: path.join('.cortex', '.session'),
      };
      expect(CortexSessionDirectory.inspectCortexSession(request)).toEqual(
        expected,
      );
    });
  });
});

type RepositoryRootVisitor = (repoRoot: string) => void;
