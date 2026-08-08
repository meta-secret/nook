import type { ExternalValue } from '../../lib/guards.ts';
import { RequestFamily } from '../enums.ts';
import {
  DecodeStatus,
  decodeErr,
  decodeOk,
  type DecodeOutcome,
} from '../field-error.ts';
import {
  booleanJsonSchema,
  integerJsonSchema,
  objectJsonSchema,
  type ObjectJsonSchema,
} from '../json-schema.ts';
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
  value: ExternalValue,
): DecodeOutcome<DependencyPopularityRequest> {
  const object = expectObject({ value, path: ROOT });
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys({
    record: object.value,
    fields: DependencyPopularityField,
    path: ROOT,
  });
  const includeRepositoryManifests = expectBoolean({
    record: object.value,
    key: DependencyPopularityField.IncludeRepositoryManifests,
    path: ROOT,
  });
  const minNpmWeeklyDownloads = expectPositiveInt({
    record: object.value,
    key: DependencyPopularityField.MinNpmWeeklyDownloads,
    path: ROOT,
  });
  const minGitHubStars = expectPositiveInt({
    record: object.value,
    key: DependencyPopularityField.MinGitHubStars,
    path: ROOT,
  });
  const minCratesIoDownloads = expectPositiveInt({
    record: object.value,
    key: DependencyPopularityField.MinCratesIoDownloads,
    path: ROOT,
  });
  const minCratesIoRecentDownloads = expectPositiveInt({
    record: object.value,
    key: DependencyPopularityField.MinCratesIoRecentDownloads,
    path: ROOT,
  });
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
  return collectDecode({
    results: [
      includeRepositoryManifests,
      minNpmWeeklyDownloads,
      minGitHubStars,
      minCratesIoDownloads,
      minCratesIoRecentDownloads,
    ],
    build: () => ({
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
  });
}

export const DEPENDENCY_POPULARITY_INPUT_SCHEMA: ObjectJsonSchema =
  objectJsonSchema({
    required: [
      DependencyPopularityField.IncludeRepositoryManifests,
      DependencyPopularityField.MinNpmWeeklyDownloads,
      DependencyPopularityField.MinGitHubStars,
      DependencyPopularityField.MinCratesIoDownloads,
      DependencyPopularityField.MinCratesIoRecentDownloads,
    ],
    properties: {
      [DependencyPopularityField.IncludeRepositoryManifests]:
        booleanJsonSchema(),
      [DependencyPopularityField.MinNpmWeeklyDownloads]: integerJsonSchema({
        minimum: 1,
      }),
      [DependencyPopularityField.MinGitHubStars]: integerJsonSchema({
        minimum: 1,
      }),
      [DependencyPopularityField.MinCratesIoDownloads]: integerJsonSchema({
        minimum: 1,
      }),
      [DependencyPopularityField.MinCratesIoRecentDownloads]: integerJsonSchema(
        {
          minimum: 1,
        },
      ),
    },
  });
