import { PrLandOperation, RequestFamily } from './enums.ts';
import type { UntrustedYamlNode } from '../lib/guards.ts';
import {
  decodePrLandPrPayload,
  decodePrLandValidatePayload,
  type PrLandPrRequest,
  type PrLandValidateRequest,
} from './args/pr-land.ts';
import { joinPath, type DecodeOutcome, DecodeStatus } from './field-error.ts';
import {
  decodeExactlyOneOperation,
  expectObject,
  mapDecode,
  PR_LAND_OPERATIONS,
  type ExpectObjectArgs,
  type MapDecodeArgs,
} from './object.ts';
import type { JoinPathArgs } from './field-error.ts';
import type {
  DecodePrLandPrPayloadArgs,
  DecodePrLandValidatePayloadArgs,
} from './args/pr-land.ts';
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

export function decodePrLandFamily(
  args: DecodePrLandFamilyArgs,
): DecodeOutcome<PrLandLoomRequest> {
  const { value, path } = args;

  const basePathArgs: JoinPathArgs = { base: path, key: RequestFamily.PrLand };
  const basePath = joinPath(basePathArgs);
  const objectArgs: ExpectObjectArgs = { value, path: basePath };
  const object = expectObject(objectArgs);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const selectedArgs = {
    record: object.value,
    path: basePath,
    operations: PR_LAND_OPERATIONS,
  };
  const selected = decodeExactlyOneOperation(selectedArgs);
  if (selected.status === DecodeStatus.Failed) {
    return selected;
  }
  const operationPathArgs: JoinPathArgs = {
    base: basePath,
    key: selected.value.operation,
  };
  const operationPath = joinPath(operationPathArgs);
  switch (selected.value.operation) {
    case PrLandOperation.Status: {
      const decodePrLandPrPayloadArgs3: DecodePrLandPrPayloadArgs = {
        value: selected.value.payload,
        path: operationPath,
      };
      const mapDecodeArgs4: MapDecodeArgs<PrLandPrRequest, PrLandLoomRequest> =
        {
          outcome: decodePrLandPrPayload(decodePrLandPrPayloadArgs3),
          build: (status) => ({
            family: RequestFamily.PrLand,
            operation: PrLandOperation.Status,
            status,
          }),
        };
      return mapDecode(mapDecodeArgs4);
    }
    case PrLandOperation.Validate: {
      const decodePrLandValidatePayloadArgs: DecodePrLandValidatePayloadArgs = {
        value: selected.value.payload,
        path: operationPath,
      };
      const mapDecodeArgs3: MapDecodeArgs<
        PrLandValidateRequest,
        PrLandLoomRequest
      > = {
        outcome: decodePrLandValidatePayload(decodePrLandValidatePayloadArgs),
        build: (validate) => ({
          family: RequestFamily.PrLand,
          operation: PrLandOperation.Validate,
          validate,
        }),
      };
      return mapDecode(mapDecodeArgs3);
    }
    case PrLandOperation.Ready: {
      const decodePrLandPrPayloadArgs2: DecodePrLandPrPayloadArgs = {
        value: selected.value.payload,
        path: operationPath,
      };
      const mapDecodeArgs2: MapDecodeArgs<PrLandPrRequest, PrLandLoomRequest> =
        {
          outcome: decodePrLandPrPayload(decodePrLandPrPayloadArgs2),
          build: (ready) => ({
            family: RequestFamily.PrLand,
            operation: PrLandOperation.Ready,
            ready,
          }),
        };
      return mapDecode(mapDecodeArgs2);
    }
    case PrLandOperation.MergeCheck: {
      const decodePrLandPrPayloadArgs: DecodePrLandPrPayloadArgs = {
        value: selected.value.payload,
        path: operationPath,
      };
      const mapDecodeArgs: MapDecodeArgs<PrLandPrRequest, PrLandLoomRequest> = {
        outcome: decodePrLandPrPayload(decodePrLandPrPayloadArgs),
        build: (mergeCheck) => ({
          family: RequestFamily.PrLand,
          operation: PrLandOperation.MergeCheck,
          mergeCheck,
        }),
      };
      return mapDecode(mapDecodeArgs);
    }
  }
}

export function listPrLandOperations(): readonly PrLandOperation[] {
  return PR_LAND_OPERATIONS;
}
