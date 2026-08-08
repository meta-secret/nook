import {
  DecodeStatus,
  decodeErr,
  decodeOk,
  type DecodeOutcome,
} from '../field-error.ts';
import { RequestFamily } from '../enums.ts';
import {
  collectDecode,
  denyUnknownKeys,
  expectBoolean,
  expectObject,
  expectPositiveInt,
} from '../object.ts';

export enum DependencyPopularityField {
  IncludeRepositoryManifests = 'includeRepositoryManifests',
  MinNpmWeeklyDownloads = 'minNpmWeeklyDownloads',
  MinGitHubStars = 'minGitHubStars',
  MinCratesIoDownloads = 'minCratesIoDownloads',
  MinCratesIoRecentDownloads = 'minCratesIoRecentDownloads',
}

export type DependencyPopularityRequest = {
  readonly includeRepositoryManifests: boolean;
  readonly minNpmWeeklyDownloads: number;
  readonly minGitHubStars: number;
  readonly minCratesIoDownloads: number;
  readonly minCratesIoRecentDownloads: number;
};

const ROOT = RequestFamily.DependencyPopularity;

export function decodeDependencyPopularityRequest(
  value: unknown,
): DecodeOutcome<DependencyPopularityRequest> {
  const object = expectObject(value, ROOT);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys(
    object.value,
    DependencyPopularityField,
    ROOT,
  );
  const includeRepositoryManifests = expectBoolean(
    object.value,
    DependencyPopularityField.IncludeRepositoryManifests,
    ROOT,
  );
  const minNpmWeeklyDownloads = expectPositiveInt(
    object.value,
    DependencyPopularityField.MinNpmWeeklyDownloads,
    ROOT,
  );
  const minGitHubStars = expectPositiveInt(
    object.value,
    DependencyPopularityField.MinGitHubStars,
    ROOT,
  );
  const minCratesIoDownloads = expectPositiveInt(
    object.value,
    DependencyPopularityField.MinCratesIoDownloads,
    ROOT,
  );
  const minCratesIoRecentDownloads = expectPositiveInt(
    object.value,
    DependencyPopularityField.MinCratesIoRecentDownloads,
    ROOT,
  );
  const errors = [
    ...unknown,
    ...(includeRepositoryManifests.status === DecodeStatus.Failed
      ? includeRepositoryManifests.errors
      : []),
    ...(minNpmWeeklyDownloads.status === DecodeStatus.Failed
      ? minNpmWeeklyDownloads.errors
      : []),
    ...(minGitHubStars.status === DecodeStatus.Failed
      ? minGitHubStars.errors
      : []),
    ...(minCratesIoDownloads.status === DecodeStatus.Failed
      ? minCratesIoDownloads.errors
      : []),
    ...(minCratesIoRecentDownloads.status === DecodeStatus.Failed
      ? minCratesIoRecentDownloads.errors
      : []),
  ];
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return collectDecode(
    [
      includeRepositoryManifests,
      minNpmWeeklyDownloads,
      minGitHubStars,
      minCratesIoDownloads,
      minCratesIoRecentDownloads,
    ],
    () => ({
      includeRepositoryManifests: (
        includeRepositoryManifests as { value: boolean }
      ).value,
      minNpmWeeklyDownloads: (minNpmWeeklyDownloads as { value: number }).value,
      minGitHubStars: (minGitHubStars as { value: number }).value,
      minCratesIoDownloads: (minCratesIoDownloads as { value: number }).value,
      minCratesIoRecentDownloads: (
        minCratesIoRecentDownloads as { value: number }
      ).value,
    }),
  );
}

export const DEPENDENCY_POPULARITY_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'includeRepositoryManifests',
    'minNpmWeeklyDownloads',
    'minGitHubStars',
    'minCratesIoDownloads',
    'minCratesIoRecentDownloads',
  ],
  properties: {
    includeRepositoryManifests: { type: 'boolean' },
    minNpmWeeklyDownloads: { type: 'integer', minimum: 1 },
    minGitHubStars: { type: 'integer', minimum: 1 },
    minCratesIoDownloads: { type: 'integer', minimum: 1 },
    minCratesIoRecentDownloads: { type: 'integer', minimum: 1 },
  },
} as const;
