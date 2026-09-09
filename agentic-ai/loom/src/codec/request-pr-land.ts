import { PrLandOperation, RequestFamily } from './enums.ts';

import type { UntrustedYamlNode } from '../lib/guards.ts';

import {
  type PrLandPrRequest,
  type PrLandValidateRequest,
  PrLandPullRequestPayload,
  PrLandValidationPayload,
} from './args/pr-land.ts';

import { type DecodeOutcome, DecodeStatus, FieldPath } from './field-error.ts';

import {
  PR_LAND_OPERATIONS,
  type ExpectObjectArgs,
  type MapDecodeArgs,
  YamlOperationSelection,
  YamlObjectField,
  FieldDecodeProjection,
} from './object.ts';

import type { JoinPathArgs } from './field-error.ts';

import type {
  DecodePrLandPrPayloadArgs,
  DecodePrLandValidatePayloadArgs,
} from './args/pr-land.ts';

export class PrLandFamilyDecoder {
  private constructor(private readonly request: DecodePrLandFamilyArgs) {}

  static decodePrLandFamily(
    args: DecodePrLandFamilyArgs,
  ): DecodeOutcome<PrLandLoomRequest> {
    return new PrLandFamilyDecoder(args).execute();
  }

  private execute(): DecodeOutcome<PrLandLoomRequest> {
    const args = this.request;
    const { value, path } = args;

    const basePathArgs: JoinPathArgs = {
      base: path,
      key: RequestFamily.PrLand,
    };
    const basePath = FieldPath.join(basePathArgs);
    const objectArgs: ExpectObjectArgs = { value, path: basePath };
    const object = YamlObjectField.decode(objectArgs);
    if (object.status === DecodeStatus.Failed) {
      return object;
    }
    const selectedArgs = {
      record: object.value,
      path: basePath,
      operations: PR_LAND_OPERATIONS,
    };
    const selected = YamlOperationSelection.decode(selectedArgs);
    if (selected.status === DecodeStatus.Failed) {
      return selected;
    }
    const operationPathArgs: JoinPathArgs = {
      base: basePath,
      key: selected.value.operation,
    };
    const operationPath = FieldPath.join(operationPathArgs);
    switch (selected.value.operation) {
      case PrLandOperation.Status: {
        const decodePrLandPrPayloadArgs3: DecodePrLandPrPayloadArgs = {
          value: selected.value.payload,
          path: operationPath,
        };
        const mapDecodeArgs4: MapDecodeArgs<
          PrLandPrRequest,
          PrLandLoomRequest
        > = {
          outcome: PrLandPullRequestPayload.decode(decodePrLandPrPayloadArgs3),
          build: (status) => ({
            family: RequestFamily.PrLand,
            operation: PrLandOperation.Status,
            status,
          }),
        };
        return FieldDecodeProjection.map(mapDecodeArgs4);
      }
      case PrLandOperation.Validate: {
        const decodePrLandValidatePayloadArgs: DecodePrLandValidatePayloadArgs =
          {
            value: selected.value.payload,
            path: operationPath,
          };
        const mapDecodeArgs3: MapDecodeArgs<
          PrLandValidateRequest,
          PrLandLoomRequest
        > = {
          outcome: PrLandValidationPayload.decode(
            decodePrLandValidatePayloadArgs,
          ),
          build: (validate) => ({
            family: RequestFamily.PrLand,
            operation: PrLandOperation.Validate,
            validate,
          }),
        };
        return FieldDecodeProjection.map(mapDecodeArgs3);
      }
      case PrLandOperation.Ready: {
        const decodePrLandPrPayloadArgs2: DecodePrLandPrPayloadArgs = {
          value: selected.value.payload,
          path: operationPath,
        };
        const mapDecodeArgs2: MapDecodeArgs<
          PrLandPrRequest,
          PrLandLoomRequest
        > = {
          outcome: PrLandPullRequestPayload.decode(decodePrLandPrPayloadArgs2),
          build: (ready) => ({
            family: RequestFamily.PrLand,
            operation: PrLandOperation.Ready,
            ready,
          }),
        };
        return FieldDecodeProjection.map(mapDecodeArgs2);
      }
      case PrLandOperation.MergeCheck: {
        const decodePrLandPrPayloadArgs: DecodePrLandPrPayloadArgs = {
          value: selected.value.payload,
          path: operationPath,
        };
        const mapDecodeArgs: MapDecodeArgs<PrLandPrRequest, PrLandLoomRequest> =
          {
            outcome: PrLandPullRequestPayload.decode(decodePrLandPrPayloadArgs),
            build: (mergeCheck) => ({
              family: RequestFamily.PrLand,
              operation: PrLandOperation.MergeCheck,
              mergeCheck,
            }),
          };
        return FieldDecodeProjection.map(mapDecodeArgs);
      }
    }
  }

  static listPrLandOperations(): readonly PrLandOperation[] {
    return PR_LAND_OPERATIONS;
  }
}

export type PrLandLoomRequest =
  | {
      readonly family: RequestFamily.PrLand;
      readonly operation: PrLandOperation.Status;
      readonly status: PrLandPrRequest;
    }
  | {
      readonly family: RequestFamily.PrLand;
      readonly operation: PrLandOperation.Validate;
      readonly validate: PrLandValidateRequest;
    }
  | {
      readonly family: RequestFamily.PrLand;
      readonly operation: PrLandOperation.Ready;
      readonly ready: PrLandPrRequest;
    }
  | {
      readonly family: RequestFamily.PrLand;
      readonly operation: PrLandOperation.MergeCheck;
      readonly mergeCheck: PrLandPrRequest;
    };

export type DecodePrLandFamilyArgs = {
  readonly value: UntrustedYamlNode;
  readonly path: string;
};
