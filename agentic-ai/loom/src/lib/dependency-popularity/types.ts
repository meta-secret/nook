export enum DependencyEcosystem {
  Npm = 'npm',
  CratesIo = 'cratesIo',
}

export enum GitHubStarsPresence {
  Reported = 'reported',
  Unavailable = 'unavailable',
}

export type GitHubStars =
  | {
      readonly presence: GitHubStarsPresence.Reported;
      readonly stars: number;
    }
  | { readonly presence: GitHubStarsPresence.Unavailable };

export type PopularityThresholds = {
  readonly minNpmWeeklyDownloads: number;
  readonly minGitHubStars: number;
  readonly minCratesIoDownloads: number;
  readonly minCratesIoRecentDownloads: number;
};

export type NpmPackageMetrics = {
  readonly ecosystem: DependencyEcosystem.Npm;
  readonly name: string;
  readonly weeklyDownloads: number;
  readonly githubStars: GitHubStars;
};

export type CrateMetrics = {
  readonly ecosystem: DependencyEcosystem.CratesIo;
  readonly name: string;
  readonly downloads: number;
  readonly recentDownloads: number;
  readonly githubStars: GitHubStars;
};

export type DependencyMetrics = NpmPackageMetrics | CrateMetrics;

export enum PopularityVerdict {
  Pass = 'pass',
  Fail = 'fail',
}

export type PopularityFinding = {
  readonly metrics: DependencyMetrics;
  readonly verdict: PopularityVerdict;
  readonly reasons: readonly string[];
};
