import { PrLandOperation, RequestFamily } from './enums.ts';
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

export function decodePrLandFamily(
  value: unknown,
  path: string,
): DecodeOutcome<PrLandLoomRequest> {
  const basePath = joinPath(path, RequestFamily.PrLand);
  const object = expectObject(value, basePath);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const selected = decodeExactlyOneOperation(
    object.value,
    basePath,
    PR_LAND_OPERATIONS,
  );
  if (selected.status === DecodeStatus.Failed) {
    return selected;
  }
  const operationPath = joinPath(basePath, selected.value.operation);
  switch (selected.value.operation) {
    case PrLandOperation.Status:
      return mapDecode(
        decodePrLandPrPayload(selected.value.payload, operationPath),
        (status) => ({
          family: RequestFamily.PrLand,
          operation: PrLandOperation.Status,
          status,
        }),
      );
    case PrLandOperation.Validate:
      return mapDecode(
        decodePrLandValidatePayload(selected.value.payload, operationPath),
        (validate) => ({
          family: RequestFamily.PrLand,
          operation: PrLandOperation.Validate,
          validate,
        }),
      );
    case PrLandOperation.Ready:
      return mapDecode(
        decodePrLandPrPayload(selected.value.payload, operationPath),
        (ready) => ({
          family: RequestFamily.PrLand,
          operation: PrLandOperation.Ready,
          ready,
        }),
      );
    case PrLandOperation.MergeCheck:
      return mapDecode(
        decodePrLandPrPayload(selected.value.payload, operationPath),
        (mergeCheck) => ({
          family: RequestFamily.PrLand,
          operation: PrLandOperation.MergeCheck,
          mergeCheck,
        }),
      );
  }
}

export function listPrLandOperations(): readonly PrLandOperation[] {
  return PR_LAND_OPERATIONS;
}
