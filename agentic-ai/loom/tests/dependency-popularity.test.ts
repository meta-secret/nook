import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

interface PackageManifestFixture {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

interface WriteManifestArgs {
  readonly root: string;
  readonly relativePath: string;
  readonly manifest: PackageManifestFixture;
}

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    const removalOptions: RmOptions = { force: true, recursive: true };
    rmSync(root, removalOptions);
  }
});

function writeManifest({
  root,
  relativePath,
  manifest,
}: WriteManifestArgs): void {
  const absolutePath = path.join(root, relativePath);
  const directoryOptions: MakeDirectoryOptions = { recursive: true };
  mkdirSync(path.dirname(absolutePath), directoryOptions);
  writeFileSync(absolutePath, JSON.stringify(manifest));
}

const thresholds = {
  minNpmWeeklyDownloads: 10_000,
  minGitHubStars: 100,
  minCratesIoDownloads: 50_000,
  minCratesIoRecentDownloads: 1_000,
};

describe('scanRepositoryNpmPackages', () => {
  test('reads Loom and executable-application dependencies', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nook-dependency-scan-'));
    temporaryRoots.push(root);
    const loomManifest: PackageManifestFixture = {
      dependencies: { alpha: '1.0.0', shared: '1.0.0' },
      devDependencies: { '@types/ignored': '1.0.0' },
    };
    const loomWrite: WriteManifestArgs = {
      root,
      relativePath: 'agentic-ai/loom/package.json',
      manifest: loomManifest,
    };
    writeManifest(loomWrite);
    const skillsWrite: WriteManifestArgs = {
      root,
      relativePath: 'agentic-ai/skills/package.json',
      manifest: { dependencies: { beta: '2.0.0', shared: '1.0.0' } },
    };
    writeManifest(skillsWrite);

    expect(scanRepositoryNpmPackages(root)).toEqual([
      'alpha',
      'shared',
      'beta',
    ]);
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
