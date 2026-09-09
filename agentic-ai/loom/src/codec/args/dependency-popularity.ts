import type { UntrustedYamlNode } from '../../lib/guards.ts';

import { RequestFamily } from '../enums.ts';

import {
  DecodeStatus,
  type DecodeOutcome,
  FailedFieldDecode,
} from '../field-error.ts';

import {
  type IntegerJsonSchemaArgs,
  type ObjectJsonSchema,
  type ObjectJsonSchemaArgs,
  JsonSchemaDefinition,
} from '../json-schema.ts';

import {
  type CollectDecodeArgs,
  type DenyUnknownKeysArgs,
  type ExpectFieldArgs,
  type ExpectObjectArgs,
  FieldDecodeCollection,
  YamlObjectVocabulary,
  YamlBooleanField,
  YamlObjectField,
  YamlPositiveIntegerField,
} from '../object.ts';

export class DependencyPopularityRequestDecoder {
  private constructor(private readonly request: UntrustedYamlNode) {}
  static decode(
    value: UntrustedYamlNode,
  ): DecodeOutcome<DependencyPopularityRequest> {
    return new DependencyPopularityRequestDecoder(value).execute();
  }
  private execute(): DecodeOutcome<DependencyPopularityRequest> {
    const value = this.request;
    const objectArgs: ExpectObjectArgs = { value, path: ROOT };
    const object = YamlObjectField.decode(objectArgs);
    if (object.status === DecodeStatus.Failed) {
      return object;
    }
    const unknownArgs: DenyUnknownKeysArgs<DependencyPopularityField> = {
      record: object.value,
      fields: DependencyPopularityField,
      path: ROOT,
    };
    const unknown = YamlObjectVocabulary.unknownFields(unknownArgs);
    const includeRepositoryManifestsArgs: ExpectFieldArgs<DependencyPopularityField> =
      {
        record: object.value,
        key: DependencyPopularityField.IncludeRepositoryManifests,
        path: ROOT,
      };
    const includeRepositoryManifests = YamlBooleanField.decode(
      includeRepositoryManifestsArgs,
    );
    const minNpmWeeklyDownloadsArgs: ExpectFieldArgs<DependencyPopularityField> =
      {
        record: object.value,
        key: DependencyPopularityField.MinNpmWeeklyDownloads,
        path: ROOT,
      };
    const minNpmWeeklyDownloads = YamlPositiveIntegerField.decode(
      minNpmWeeklyDownloadsArgs,
    );
    const minGitHubStarsArgs: ExpectFieldArgs<DependencyPopularityField> = {
      record: object.value,
      key: DependencyPopularityField.MinGitHubStars,
      path: ROOT,
    };
    const minGitHubStars = YamlPositiveIntegerField.decode(minGitHubStarsArgs);
    const minCratesIoDownloadsArgs: ExpectFieldArgs<DependencyPopularityField> =
      {
        record: object.value,
        key: DependencyPopularityField.MinCratesIoDownloads,
        path: ROOT,
      };
    const minCratesIoDownloads = YamlPositiveIntegerField.decode(
      minCratesIoDownloadsArgs,
    );
    const minCratesIoRecentDownloadsArgs: ExpectFieldArgs<DependencyPopularityField> =
      {
        record: object.value,
        key: DependencyPopularityField.MinCratesIoRecentDownloads,
        path: ROOT,
      };
    const minCratesIoRecentDownloads = YamlPositiveIntegerField.decode(
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
      return FailedFieldDecode.create(errors);
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
        minNpmWeeklyDownloads: (minNpmWeeklyDownloads as { value: number })
          .value,
        minGitHubStars: (minGitHubStars as { value: number }).value,
        minCratesIoDownloads: (minCratesIoDownloads as { value: number }).value,
        minCratesIoRecentDownloads: (
          minCratesIoRecentDownloads as { value: number }
        ).value,
      }),
    };
    return FieldDecodeCollection.collect(collectDecodeArgs);
  }
}

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
    [DependencyPopularityField.IncludeRepositoryManifests]:
      JsonSchemaDefinition.boolean(),
    [DependencyPopularityField.MinNpmWeeklyDownloads]:
      JsonSchemaDefinition.integer(positiveIntegerSchemaArgs),
    [DependencyPopularityField.MinGitHubStars]: JsonSchemaDefinition.integer(
      positiveIntegerSchemaArgs,
    ),
    [DependencyPopularityField.MinCratesIoDownloads]:
      JsonSchemaDefinition.integer(positiveIntegerSchemaArgs),
    [DependencyPopularityField.MinCratesIoRecentDownloads]:
      JsonSchemaDefinition.integer(positiveIntegerSchemaArgs),
  },
};

export const DEPENDENCY_POPULARITY_INPUT_SCHEMA: ObjectJsonSchema =
  JsonSchemaDefinition.object(dependencyPopularityInputSchemaArgs);
