import type { UntrustedYamlNode } from '../../lib/guards.ts';
import { RequestFamily } from '../enums.ts';
import { DecodeStatus, decodeErr, type DecodeOutcome } from '../field-error.ts';
import {
  booleanJsonSchema,
  integerJsonSchema,
  objectJsonSchema,
  type IntegerJsonSchemaArgs,
  type ObjectJsonSchema,
  type ObjectJsonSchemaArgs,
} from '../json-schema.ts';
import {
  collectDecode,
  denyUnknownKeys,
  expectBoolean,
  expectObject,
  expectPositiveInt,
  type CollectDecodeArgs,
  type DenyUnknownKeysArgs,
  type ExpectFieldArgs,
  type ExpectObjectArgs,
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
  value: UntrustedYamlNode,
): DecodeOutcome<DependencyPopularityRequest> {
  const objectArgs: ExpectObjectArgs = { value, path: ROOT };
  const object = expectObject(objectArgs);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknownArgs: DenyUnknownKeysArgs<DependencyPopularityField> = {
    record: object.value,
    fields: DependencyPopularityField,
    path: ROOT,
  };
  const unknown = denyUnknownKeys(unknownArgs);
  const includeRepositoryManifestsArgs: ExpectFieldArgs<DependencyPopularityField> =
    {
      record: object.value,
      key: DependencyPopularityField.IncludeRepositoryManifests,
      path: ROOT,
    };
  const includeRepositoryManifests = expectBoolean(
    includeRepositoryManifestsArgs,
  );
  const minNpmWeeklyDownloadsArgs: ExpectFieldArgs<DependencyPopularityField> =
    {
      record: object.value,
      key: DependencyPopularityField.MinNpmWeeklyDownloads,
      path: ROOT,
    };
  const minNpmWeeklyDownloads = expectPositiveInt(minNpmWeeklyDownloadsArgs);
  const minGitHubStarsArgs: ExpectFieldArgs<DependencyPopularityField> = {
    record: object.value,
    key: DependencyPopularityField.MinGitHubStars,
    path: ROOT,
  };
  const minGitHubStars = expectPositiveInt(minGitHubStarsArgs);
  const minCratesIoDownloadsArgs: ExpectFieldArgs<DependencyPopularityField> = {
    record: object.value,
    key: DependencyPopularityField.MinCratesIoDownloads,
    path: ROOT,
  };
  const minCratesIoDownloads = expectPositiveInt(minCratesIoDownloadsArgs);
  const minCratesIoRecentDownloadsArgs: ExpectFieldArgs<DependencyPopularityField> =
    {
      record: object.value,
      key: DependencyPopularityField.MinCratesIoRecentDownloads,
      path: ROOT,
    };
  const minCratesIoRecentDownloads = expectPositiveInt(
    minCratesIoRecentDownloadsArgs,
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
  const collectDecodeArgs: CollectDecodeArgs<DependencyPopularityRequest> = {
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
  };
  return collectDecode(collectDecodeArgs);
}

const positiveIntegerSchemaArgs: IntegerJsonSchemaArgs = { minimum: 1 };
const dependencyPopularityInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [
    DependencyPopularityField.IncludeRepositoryManifests,
    DependencyPopularityField.MinNpmWeeklyDownloads,
    DependencyPopularityField.MinGitHubStars,
    DependencyPopularityField.MinCratesIoDownloads,
    DependencyPopularityField.MinCratesIoRecentDownloads,
  ],
  properties: {
    [DependencyPopularityField.IncludeRepositoryManifests]: booleanJsonSchema(),
    [DependencyPopularityField.MinNpmWeeklyDownloads]: integerJsonSchema(
      positiveIntegerSchemaArgs,
    ),
    [DependencyPopularityField.MinGitHubStars]: integerJsonSchema(
      positiveIntegerSchemaArgs,
    ),
    [DependencyPopularityField.MinCratesIoDownloads]: integerJsonSchema(
      positiveIntegerSchemaArgs,
    ),
    [DependencyPopularityField.MinCratesIoRecentDownloads]: integerJsonSchema(
      positiveIntegerSchemaArgs,
    ),
  },
};
export const DEPENDENCY_POPULARITY_INPUT_SCHEMA: ObjectJsonSchema =
  objectJsonSchema(dependencyPopularityInputSchemaArgs);
