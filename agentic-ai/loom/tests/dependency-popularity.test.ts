import { describe, expect, test } from 'bun:test';
import { evaluatePopularity } from '../src/lib/dependency-popularity/evaluate.ts';
import {
  DependencyEcosystem,
  GitHubStarsPresence,
  PopularityVerdict,
} from '../src/lib/dependency-popularity/types.ts';

import type { EvaluatePopularityArgs } from '../src/lib/dependency-popularity/evaluate.ts';
const thresholds = {
  minNpmWeeklyDownloads: 10_000,
  minGitHubStars: 100,
  minCratesIoDownloads: 50_000,
  minCratesIoRecentDownloads: 1_000,
};

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
