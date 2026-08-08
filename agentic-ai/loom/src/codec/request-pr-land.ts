import { PrLandOperation, RequestFamily } from './enums.ts';
import type { ExternalValue } from '../lib/guards.ts';
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
} from './object.ts';

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
  readonly value: ExternalValue;
  readonly path: string;
};

export function decodePrLandFamily(
  args: DecodePrLandFamilyArgs,
): DecodeOutcome<PrLandLoomRequest> {
  const { value, path } = args;

  const basePath = joinPath({ base: path, key: RequestFamily.PrLand });
  const object = expectObject({ value, path: basePath });
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const selected = decodeExactlyOneOperation({
    record: object.value,
    path: basePath,
    operations: PR_LAND_OPERATIONS,
  });
  if (selected.status === DecodeStatus.Failed) {
    return selected;
  }
  const operationPath = joinPath({
    base: basePath,
    key: selected.value.operation,
  });
  switch (selected.value.operation) {
    case PrLandOperation.Status:
      return mapDecode({
        outcome: decodePrLandPrPayload({
          value: selected.value.payload,
          path: operationPath,
        }),
        build: (status) => ({
          family: RequestFamily.PrLand,
          operation: PrLandOperation.Status,
          status,
        }),
      });
    case PrLandOperation.Validate:
      return mapDecode({
        outcome: decodePrLandValidatePayload({
          value: selected.value.payload,
          path: operationPath,
        }),
        build: (validate) => ({
          family: RequestFamily.PrLand,
          operation: PrLandOperation.Validate,
          validate,
        }),
      });
    case PrLandOperation.Ready:
      return mapDecode({
        outcome: decodePrLandPrPayload({
          value: selected.value.payload,
          path: operationPath,
        }),
        build: (ready) => ({
          family: RequestFamily.PrLand,
          operation: PrLandOperation.Ready,
          ready,
        }),
      });
    case PrLandOperation.MergeCheck:
      return mapDecode({
        outcome: decodePrLandPrPayload({
          value: selected.value.payload,
          path: operationPath,
        }),
        build: (mergeCheck) => ({
          family: RequestFamily.PrLand,
          operation: PrLandOperation.MergeCheck,
          mergeCheck,
        }),
      });
  }
}

export function listPrLandOperations(): readonly PrLandOperation[] {
  return PR_LAND_OPERATIONS;
}
