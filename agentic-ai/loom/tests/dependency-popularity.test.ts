import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluatePopularity } from '../src/lib/dependency-popularity/evaluate.ts';
import { scanRepositoryNpmPackages } from '../src/lib/dependency-popularity/scan.ts';
import {
  DependencyEcosystem,
  GitHubStarsPresence,
  PopularityVerdict,
} from '../src/lib/dependency-popularity/types.ts';

import type { EvaluatePopularityArgs } from '../src/lib/dependency-popularity/evaluate.ts';
import type { MakeDirectoryOptions, RmOptions } from 'node:fs';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    const removalOptions: RmOptions = { force: true, recursive: true };
    rmSync(root, removalOptions);
  }
});

const thresholds = {
  minNpmWeeklyDownloads: 10_000,
  minGitHubStars: 100,
  minCratesIoDownloads: 50_000,
  minCratesIoRecentDownloads: 1_000,
};

describe('scanRepositoryNpmPackages', () => {
  test('reads Loom and validated executable-application dependencies', () => {
    const repositoryRoot = path.join(import.meta.dir, '../../..');
    const names = scanRepositoryNpmPackages(repositoryRoot);
    expect(names).toContain('diff');
    expect(names).toContain('typescript');
    expect(names.some((name) => name.startsWith('@types/'))).toBe(false);
  });

  test('fails package audit before reading an unsafe manifest', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nook-dependency-scan-'));
    temporaryRoots.push(root);
    const packageRoot = path.join(
      root,
      '.cortex/teams/ai/dynamic-skills/example/scripts',
    );
    const directoryOptions: MakeDirectoryOptions = { recursive: true };
    mkdirSync(packageRoot, directoryOptions);
    symlinkSync('/dev/null', path.join(packageRoot, 'package.json'));
    const initOptions = { cmd: ['git', 'init', '-q'], cwd: root };
    const addOptions = { cmd: ['git', 'add', '--', '.cortex'], cwd: root };
    Bun.spawnSync(initOptions);
    Bun.spawnSync(addOptions);
    expect(() => scanRepositoryNpmPackages(root)).toThrow(
      'Executable-skill package audit failed',
    );
  });
});

describe('evaluatePopularity', () => {
  test('passes a popular npm package', () => {
    const findingArgs3: EvaluatePopularityArgs = {
      metrics: {
        ecosystem: DependencyEcosystem.Npm,
        name: 'diff',
        weeklyDownloads: 135_000_000,
        githubStars: {
          presence: GitHubStarsPresence.Reported,
          stars: 9_000,
        },
      },
      thresholds,
    };
    const finding = evaluatePopularity(findingArgs3);
    expect(finding.verdict).toBe(PopularityVerdict.Pass);
    expect(finding.reasons).toHaveLength(0);
  });

  test('fails a low-download npm package', () => {
    const findingArgs2: EvaluatePopularityArgs = {
      metrics: {
        ecosystem: DependencyEcosystem.Npm,
        name: 'obscure-lib',
        weeklyDownloads: 12,
        githubStars: {
          presence: GitHubStarsPresence.Reported,
          stars: 3,
        },
      },
      thresholds,
    };
    const finding = evaluatePopularity(findingArgs2);
    expect(finding.verdict).toBe(PopularityVerdict.Fail);
    expect(finding.reasons.length).toBeGreaterThan(0);
  });

  test('fails crates below recent-download threshold', () => {
    const findingArgs: EvaluatePopularityArgs = {
      metrics: {
        ecosystem: DependencyEcosystem.CratesIo,
        name: 'tiny-crate',
        downloads: 1_000_000,
        recentDownloads: 5,
        githubStars: { presence: GitHubStarsPresence.Unavailable },
      },
      thresholds,
    };
    const finding = evaluatePopularity(findingArgs);
    expect(finding.verdict).toBe(PopularityVerdict.Fail);
  });
});
