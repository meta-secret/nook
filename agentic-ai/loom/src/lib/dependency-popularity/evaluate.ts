import {
  DependencyEcosystem,
  GitHubStarsPresence,
  PopularityVerdict,
  type DependencyMetrics,
  type PopularityFinding,
  type PopularityThresholds,
} from './types.ts';

export type EvaluatePopularityArgs = {
  readonly metrics: DependencyMetrics;
  readonly thresholds: PopularityThresholds;
};

export function evaluatePopularity(
  args: EvaluatePopularityArgs,
): PopularityFinding {
  const { metrics, thresholds } = args;

  const reasons: string[] = [];
  if (metrics.ecosystem === DependencyEcosystem.Npm) {
    if (metrics.weeklyDownloads < thresholds.minNpmWeeklyDownloads) {
      reasons.push(
        `weekly downloads ${metrics.weeklyDownloads} < ${thresholds.minNpmWeeklyDownloads}`,
      );
    }
    if (
      metrics.githubStars.presence === GitHubStarsPresence.Reported &&
      metrics.githubStars.stars < thresholds.minGitHubStars
    ) {
      reasons.push(
        `GitHub stars ${metrics.githubStars.stars} < ${thresholds.minGitHubStars}`,
      );
    }
  } else {
    if (metrics.downloads < thresholds.minCratesIoDownloads) {
      reasons.push(
        `crates.io downloads ${metrics.downloads} < ${thresholds.minCratesIoDownloads}`,
      );
    }
    if (metrics.recentDownloads < thresholds.minCratesIoRecentDownloads) {
      reasons.push(
        `crates.io recent downloads ${metrics.recentDownloads} < ${thresholds.minCratesIoRecentDownloads}`,
      );
    }
    if (
      metrics.githubStars.presence === GitHubStarsPresence.Reported &&
      metrics.githubStars.stars < thresholds.minGitHubStars
    ) {
      reasons.push(
        `GitHub stars ${metrics.githubStars.stars} < ${thresholds.minGitHubStars}`,
      );
    }
  }
  return {
    metrics,
    verdict:
      reasons.length === 0 ? PopularityVerdict.Pass : PopularityVerdict.Fail,
    reasons,
  };
}
