import { err, ok, type Result } from 'neverthrow';
import type { RegistryFailure } from '../lib/dependency-popularity/registry-response.ts';
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
  constructor(private readonly request: DependencyPopularityRequest) {}
  async execute(): Promise<
    Result<DependencyPopularityReport, RegistryFailure>
  > {
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
      const metrics = await new NpmRegistryMetrics(name).execute();
      if (metrics.isErr()) return err(metrics.error);
      const evaluatePopularityArgs2: EvaluatePopularityArgs = {
        metrics: metrics.value,
        thresholds,
      };
      findings.push(
        new DependencyPopularityPolicy(
          evaluatePopularityArgs2.thresholds,
        ).evaluate(evaluatePopularityArgs2.metrics),
      );
    }
    for (const name of rustCrates) {
      const metrics = await new CrateRegistryMetrics(name).execute();
      if (metrics.isErr()) return err(metrics.error);
      const evaluatePopularityArgs: EvaluatePopularityArgs = {
        metrics: metrics.value,
        thresholds,
      };
      findings.push(
        new DependencyPopularityPolicy(
          evaluatePopularityArgs.thresholds,
        ).evaluate(evaluatePopularityArgs.metrics),
      );
    }

    return ok({
      ok: findings.every(
        (finding) => finding.verdict === PopularityVerdict.Pass,
      ),
      thresholds,
      npmPackages,
      rustCrates,
      findings,
    });
  }
}

export type DependencyPopularityReport = {
  readonly ok: boolean;
  readonly thresholds: PopularityThresholds;
  readonly npmPackages: readonly string[];
  readonly rustCrates: readonly string[];
  readonly findings: readonly PopularityFinding[];
};
