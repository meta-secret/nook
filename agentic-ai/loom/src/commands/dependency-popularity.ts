import type { DependencyPopularityRequest } from '../codec/args/dependency-popularity.ts';
import { fetchCrateMetrics } from '../lib/dependency-popularity/crates.ts';
import { evaluatePopularity } from '../lib/dependency-popularity/evaluate.ts';
import { fetchNpmPackageMetrics } from '../lib/dependency-popularity/npm.ts';
import { scanRepositoryManifests } from '../lib/dependency-popularity/scan.ts';
import {
  PopularityVerdict,
  type PopularityFinding,
  type PopularityThresholds,
} from '../lib/dependency-popularity/types.ts';
import { findRepoRoot } from '../lib/repo.ts';

export type DependencyPopularityReport = {
  readonly ok: boolean;
  readonly thresholds: PopularityThresholds;
  readonly npmPackages: readonly string[];
  readonly rustCrates: readonly string[];
  readonly findings: readonly PopularityFinding[];
};

export async function runDependencyPopularity(
  request: DependencyPopularityRequest,
): Promise<DependencyPopularityReport> {
  const thresholds: PopularityThresholds = {
    minNpmWeeklyDownloads: request.minNpmWeeklyDownloads,
    minGitHubStars: request.minGitHubStars,
    minCratesIoDownloads: request.minCratesIoDownloads,
    minCratesIoRecentDownloads: request.minCratesIoRecentDownloads,
  };
  const npmPackages: string[] = [];
  const rustCrates: string[] = [];
  if (request.includeRepositoryManifests) {
    const scanned = scanRepositoryManifests(findRepoRoot());
    npmPackages.push(...scanned.npmPackages);
    rustCrates.push(...scanned.rustCrates);
  }

  const findings: PopularityFinding[] = [];
  for (const name of npmPackages) {
    const metrics = await fetchNpmPackageMetrics(name);
    findings.push(evaluatePopularity({ metrics, thresholds }));
  }
  for (const name of rustCrates) {
    const metrics = await fetchCrateMetrics(name);
    findings.push(evaluatePopularity({ metrics, thresholds }));
  }

  return {
    ok: findings.every((finding) => finding.verdict === PopularityVerdict.Pass),
    thresholds,
    npmPackages,
    rustCrates,
    findings,
  };
}
