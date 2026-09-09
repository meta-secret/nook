import { err, ok, type Result } from 'neverthrow';
import {
  RegistryResponse,
  RegistryJson,
  RegistryFailureKind,
  type RegistryFailure,
} from './registry-response.ts';
import {
  UntrustedYamlPropertyPresence,
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from '../guards.ts';

import {
  DependencyEcosystem,
  GitHubStarsPresence,
  type GitHubStars,
  type NpmPackageMetrics,
} from './types.ts';

import type { UntrustedYamlPropertyArgs } from '../guards.ts';

export class NpmRegistryMetrics {
  constructor(private readonly request: string) {}
  async execute(): Promise<Result<NpmPackageMetrics, RegistryFailure>> {
    const name = this.request;
    const encoded = encodeURIComponent(name);
    const [downloadsFetch, metadataFetch] = await Promise.all([
      new RegistryResponse(
        `https://api.npmjs.org/downloads/point/last-week/${encoded}`,
      ).fetch(),
      new RegistryResponse(`https://registry.npmjs.org/${encoded}`).fetch(),
    ]);
    if (downloadsFetch.isErr()) return err(downloadsFetch.error);
    if (metadataFetch.isErr()) return err(metadataFetch.error);
    const downloadsResponse = downloadsFetch.value;
    const metadataResponse = metadataFetch.value;
    if (!downloadsResponse.ok) {
      return err({
        kind: RegistryFailureKind.Payload,
        message: `npm downloads lookup failed for ${name}: HTTP ${downloadsResponse.status}`,
      });
    }
    if (!metadataResponse.ok) {
      return err({
        kind: RegistryFailureKind.Payload,
        message: `npm registry lookup failed for ${name}: HTTP ${metadataResponse.status}`,
      });
    }
    const downloadsDecoded = await new RegistryJson(downloadsResponse).decode();
    if (downloadsDecoded.isErr()) return err(downloadsDecoded.error);
    const metadataDecoded = await new RegistryJson(metadataResponse).decode();
    if (metadataDecoded.isErr()) return err(metadataDecoded.error);
    const downloadsJson = downloadsDecoded.value;
    const metadataJson = metadataDecoded.value;
    const weeklyDownloadsArgs = { value: downloadsJson, name };
    const weeklyDownloads = this.readWeeklyDownloads(weeklyDownloadsArgs);
    if (weeklyDownloads.isErr()) return err(weeklyDownloads.error);
    const githubStars = await this.resolveGitHubStars(metadataJson);
    if (githubStars.isErr()) return err(githubStars.error);
    return ok({
      ecosystem: DependencyEcosystem.Npm,
      name,
      weeklyDownloads: weeklyDownloads.value,
      githubStars: githubStars.value,
    });
  }

  private readWeeklyDownloads(
    args: ReadWeeklyDownloadsArgs,
  ): Result<number, RegistryFailure> {
    const { value, name } = args;

    if (!UntrustedYamlBoundary.isRecord(value)) {
      return err({
        kind: RegistryFailureKind.Payload,
        message: `npm downloads payload invalid for ${name}`,
      });
    }
    const downloadsArgs: UntrustedYamlPropertyArgs = {
      record: value,
      key: 'downloads',
    };
    const downloads = UntrustedYamlBoundary.property(downloadsArgs);
    if (
      downloads.presence === UntrustedYamlPropertyPresence.Absent ||
      typeof downloads.value !== 'number'
    ) {
      return err({
        kind: RegistryFailureKind.Payload,
        message: `npm downloads payload invalid for ${name}`,
      });
    }
    return ok(downloads.value);
  }

  private async resolveGitHubStars(
    metadata: UntrustedYamlNode,
  ): Promise<Result<GitHubStars, RegistryFailure>> {
    if (!UntrustedYamlBoundary.isRecord(metadata)) {
      return ok({ presence: GitHubStarsPresence.Unavailable });
    }
    const repositoryPropertyArgs: UntrustedYamlPropertyArgs = {
      record: metadata,
      key: 'repository',
    };
    const repositoryProperty = UntrustedYamlBoundary.property(
      repositoryPropertyArgs,
    );
    let repoUrl = '';
    if (repositoryProperty.presence === UntrustedYamlPropertyPresence.Present) {
      if (typeof repositoryProperty.value === 'string') {
        repoUrl = repositoryProperty.value;
      } else if (UntrustedYamlBoundary.isRecord(repositoryProperty.value)) {
        const urlPropertyArgs: UntrustedYamlPropertyArgs = {
          record: repositoryProperty.value,
          key: 'url',
        };
        const urlProperty = UntrustedYamlBoundary.property(urlPropertyArgs);
        if (
          urlProperty.presence === UntrustedYamlPropertyPresence.Present &&
          typeof urlProperty.value === 'string'
        ) {
          repoUrl = urlProperty.value;
        }
      }
    }
    const slug = this.githubSlug(repoUrl);
    if (slug.length === 0) {
      return ok({ presence: GitHubStarsPresence.Unavailable });
    }
    const requestInit: RequestInit = {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nook-loom-dependency-popularity',
      },
    };
    const fetched = await new RegistryResponse(
      `https://api.github.com/repos/${slug}`,
      requestInit,
    ).fetch();
    if (fetched.isErr()) return err(fetched.error);
    const response = fetched.value;
    if (!response.ok) {
      return ok({ presence: GitHubStarsPresence.Unavailable });
    }
    const decoded = await new RegistryJson(response).decode();
    if (decoded.isErr()) return err(decoded.error);
    const json = decoded.value;
    if (!UntrustedYamlBoundary.isRecord(json)) {
      return ok({ presence: GitHubStarsPresence.Unavailable });
    }
    const starsArgs: UntrustedYamlPropertyArgs = {
      record: json,
      key: 'stargazers_count',
    };
    const stars = UntrustedYamlBoundary.property(starsArgs);
    if (
      stars.presence === UntrustedYamlPropertyPresence.Absent ||
      typeof stars.value !== 'number'
    ) {
      return ok({ presence: GitHubStarsPresence.Unavailable });
    }
    return ok({
      presence: GitHubStarsPresence.Reported,
      stars: stars.value,
    });
  }

  private githubSlug(repoUrl: string): string {
    const normalized = repoUrl
      .replace(/^git\+/, '')
      .replace(/^git:\/\//, 'https://')
      .replace(/\.git$/, '');
    const match = normalized.match(
      /(?:github\.com[:/]|github\.com\/)([^/]+)\/([^/#?]+)/i,
    );
    if (!match) {
      return '';
    }
    return `${match[1]}/${match[2]}`;
  }
}

type ReadWeeklyDownloadsArgs = {
  readonly value: UntrustedYamlNode;
  readonly name: string;
};
