import type { DependencyPopularityRequest } from '../codec/args/dependency-popularity.ts';

import { CrateRegistryMetrics } from '../lib/dependency-popularity/crates.ts';

import { DependencyPopularityPolicy } from '../lib/dependency-popularity/evaluate.ts';

import { NpmRegistryMetrics } from '../lib/dependency-popularity/npm.ts';

import { RepositoryDependencyInventory } from '../lib/dependency-popularity/scan.ts';

import {
  PopularityVerdict,
  type PopularityFinding,
  type PopularityThresholds,
} from '../lib/dependency-popularity/types.ts';

import { RepositoryRoot } from '../lib/repo.ts';

import type { EvaluatePopularityArgs } from '../lib/dependency-popularity/evaluate.ts';

export class DependencyPopularityCommand {
  private constructor(private readonly request: DependencyPopularityRequest) {}
  static run(
    request: DependencyPopularityRequest,
  ): Promise<DependencyPopularityReport> {
    return new DependencyPopularityCommand(request).execute();
  }
  private async execute(): Promise<DependencyPopularityReport> {
    const request = this.request;
    const thresholds: PopularityThresholds = {
      minNpmWeeklyDownloads: request.minNpmWeeklyDownloads,
      minGitHubStars: request.minGitHubStars,
      minCratesIoDownloads: request.minCratesIoDownloads,
      minCratesIoRecentDownloads: request.minCratesIoRecentDownloads,
    };
    const npmPackages: string[] = [];
    const rustCrates: string[] = [];
    if (request.includeRepositoryManifests) {
      const scanned = RepositoryDependencyInventory.scanRepositoryManifests(
        RepositoryRoot.find(),
      );
      npmPackages.push(...scanned.npmPackages);
      rustCrates.push(...scanned.rustCrates);
    }

    const findings: PopularityFinding[] = [];
    for (const name of npmPackages) {
      const metrics = await NpmRegistryMetrics.fetch(name);
      const evaluatePopularityArgs2: EvaluatePopularityArgs = {
        metrics,
        thresholds,
      };
      findings.push(
        DependencyPopularityPolicy.evaluate(evaluatePopularityArgs2),
      );
    }
    for (const name of rustCrates) {
      const metrics = await CrateRegistryMetrics.fetch(name);
      const evaluatePopularityArgs: EvaluatePopularityArgs = {
        metrics,
        thresholds,
      };
      findings.push(
        DependencyPopularityPolicy.evaluate(evaluatePopularityArgs),
      );
    }

    return {
      ok: findings.every(
        (finding) => finding.verdict === PopularityVerdict.Pass,
      ),
      thresholds,
      npmPackages,
      rustCrates,
      findings,
    };
  }
}

export type DependencyPopularityReport = {
  readonly ok: boolean;
  readonly thresholds: PopularityThresholds;
  readonly npmPackages: readonly string[];
  readonly rustCrates: readonly string[];
  readonly findings: readonly PopularityFinding[];
};
