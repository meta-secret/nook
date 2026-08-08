import { describe, expect, test } from 'bun:test';
import { evaluatePopularity } from '../src/lib/dependency-popularity/evaluate.ts';
import {
  DependencyEcosystem,
  GitHubStarsPresence,
  PopularityVerdict,
} from '../src/lib/dependency-popularity/types.ts';

const thresholds = {
  minNpmWeeklyDownloads: 10_000,
  minGitHubStars: 100,
  minCratesIoDownloads: 50_000,
  minCratesIoRecentDownloads: 1_000,
};

describe('evaluatePopularity', () => {
  test('passes a popular npm package', () => {
    const finding = evaluatePopularity(
      {
        ecosystem: DependencyEcosystem.Npm,
        name: 'diff',
        weeklyDownloads: 135_000_000,
        githubStars: {
          presence: GitHubStarsPresence.Reported,
          stars: 9_000,
        },
      },
      thresholds,
    );
    expect(finding.verdict).toBe(PopularityVerdict.Pass);
    expect(finding.reasons).toHaveLength(0);
  });

  test('fails a low-download npm package', () => {
    const finding = evaluatePopularity(
      {
        ecosystem: DependencyEcosystem.Npm,
        name: 'obscure-lib',
        weeklyDownloads: 12,
        githubStars: {
          presence: GitHubStarsPresence.Reported,
          stars: 3,
        },
      },
      thresholds,
    );
    expect(finding.verdict).toBe(PopularityVerdict.Fail);
    expect(finding.reasons.length).toBeGreaterThan(0);
  });

  test('fails crates below recent-download threshold', () => {
    const finding = evaluatePopularity(
      {
        ecosystem: DependencyEcosystem.CratesIo,
        name: 'tiny-crate',
        downloads: 1_000_000,
        recentDownloads: 5,
        githubStars: { presence: GitHubStarsPresence.Unavailable },
      },
      thresholds,
    );
    expect(finding.verdict).toBe(PopularityVerdict.Fail);
  });
});
