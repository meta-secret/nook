import { isRecord } from '../lib/guards.ts';
import { ResultKind } from '../result.ts';
import {
  decodeAgentStatsAssembleRequest,
  decodeAgentStatsPublishRequest,
  decodeAgentStatsValidateRequest,
  type AgentStatsAssembleRequest,
  type AgentStatsFileRequest,
} from './args/agent-stats.ts';
import {
  decodeCortexAuditRequest,
  type CortexAuditRequest,
} from './args/cortex-audit.ts';
import { decodePrePushRequest, type PrePushRequest } from './args/pre-push.ts';
import {
  decodePrLandMergeCheckRequest,
  decodePrLandReadyRequest,
  decodePrLandStatusRequest,
  decodePrLandValidateRequest,
  type PrLandPrRequest,
  type PrLandValidateRequest,
} from './args/pr-land.ts';
import {
  decodeSkillScaffoldRequest,
  type SkillScaffoldRequest,
} from './args/skill-scaffold.ts';
import {
  decodeToolsListRequest,
  type ToolsListRequest,
} from './args/tools-list.ts';
import { RequestKind } from './enums.ts';
import {
  decodeErr,
  decodeOk,
  fieldError,
  type DecodeResult,
  type FieldError,
} from './field-error.ts';
import { expectObject } from './object.ts';

export type LoomRequest =
  | { readonly kind: RequestKind.PrePush; readonly prePush: PrePushRequest }
  | {
      readonly kind: RequestKind.CortexAudit;
      readonly cortexAudit: CortexAuditRequest;
    }
  | {
      readonly kind: RequestKind.SkillScaffold;
      readonly skillScaffold: SkillScaffoldRequest;
    }
  | {
      readonly kind: RequestKind.AgentStatsAssemble;
      readonly agentStatsAssemble: AgentStatsAssembleRequest;
    }
  | {
      readonly kind: RequestKind.AgentStatsValidate;
      readonly agentStatsValidate: AgentStatsFileRequest;
    }
  | {
      readonly kind: RequestKind.AgentStatsPublish;
      readonly agentStatsPublish: AgentStatsFileRequest;
    }
  | {
      readonly kind: RequestKind.PrLandStatus;
      readonly prLandStatus: PrLandPrRequest;
    }
  | {
      readonly kind: RequestKind.PrLandValidate;
      readonly prLandValidate: PrLandValidateRequest;
    }
  | {
      readonly kind: RequestKind.PrLandReady;
      readonly prLandReady: PrLandPrRequest;
    }
  | {
      readonly kind: RequestKind.PrLandMergeCheck;
      readonly prLandMergeCheck: PrLandPrRequest;
    }
  | {
      readonly kind: RequestKind.ToolsList;
      readonly toolsList: ToolsListRequest;
    }
  | {
      readonly kind: RequestKind.ToolsCall;
      readonly toolsCall: LoomRequest;
    };

const ROOT_KEYS: readonly RequestKind[] = [
  RequestKind.PrePush,
  RequestKind.CortexAudit,
  RequestKind.SkillScaffold,
  RequestKind.AgentStatsAssemble,
  RequestKind.AgentStatsValidate,
  RequestKind.AgentStatsPublish,
  RequestKind.PrLandStatus,
  RequestKind.PrLandValidate,
  RequestKind.PrLandReady,
  RequestKind.PrLandMergeCheck,
  RequestKind.ToolsList,
  RequestKind.ToolsCall,
];

export function decodeLoomRequest(value: unknown): DecodeResult<LoomRequest> {
  return decodeLoomRequestAt(value, '', true);
}

function decodeLoomRequestAt(
  value: unknown,
  path: string,
  allowToolsCall: boolean,
): DecodeResult<LoomRequest> {
  const object = expectObject(value, path);
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const keys = Object.keys(object.value);
  const domainKeys = keys.filter((key) =>
    ROOT_KEYS.includes(key as RequestKind),
  );
  const unknownKeys = keys.filter(
    (key) => !ROOT_KEYS.includes(key as RequestKind),
  );
  const errors: FieldError[] = unknownKeys.map((key) =>
    fieldError(join(path, key), 'unknown field'),
  );
  if (domainKeys.length !== 1) {
    errors.push(
      fieldError(
        path.length === 0 ? '' : path,
        `expected exactly one domain request key; known: ${ROOT_KEYS.join(', ')}`,
      ),
    );
    return decodeErr(errors);
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  const kind = domainKeys[0] as RequestKind;
  if (kind === RequestKind.ToolsCall && !allowToolsCall) {
    return decodeErr([
      fieldError(
        join(path, kind),
        'nested toolsCall is not allowed inside toolsCall',
      ),
    ]);
  }
  const payload = object.value[kind];
  return decodeKind(kind, payload, path);
}

function decodeKind(
  kind: RequestKind,
  payload: unknown,
  path: string,
): DecodeResult<LoomRequest> {
  switch (kind) {
    case RequestKind.PrePush: {
      const decoded = decodePrePushRequest(payload);
      return map(decoded, (prePush) => ({ kind, prePush }));
    }
    case RequestKind.CortexAudit: {
      const decoded = decodeCortexAuditRequest(payload);
      return map(decoded, (cortexAudit) => ({ kind, cortexAudit }));
    }
    case RequestKind.SkillScaffold: {
      const decoded = decodeSkillScaffoldRequest(payload);
      return map(decoded, (skillScaffold) => ({ kind, skillScaffold }));
    }
    case RequestKind.AgentStatsAssemble: {
      const decoded = decodeAgentStatsAssembleRequest(payload);
      return map(decoded, (agentStatsAssemble) => ({
        kind,
        agentStatsAssemble,
      }));
    }
    case RequestKind.AgentStatsValidate: {
      const decoded = decodeAgentStatsValidateRequest(payload);
      return map(decoded, (agentStatsValidate) => ({
        kind,
        agentStatsValidate,
      }));
    }
    case RequestKind.AgentStatsPublish: {
      const decoded = decodeAgentStatsPublishRequest(payload);
      return map(decoded, (agentStatsPublish) => ({
        kind,
        agentStatsPublish,
      }));
    }
    case RequestKind.PrLandStatus: {
      const decoded = decodePrLandStatusRequest(payload);
      return map(decoded, (prLandStatus) => ({ kind, prLandStatus }));
    }
    case RequestKind.PrLandValidate: {
      const decoded = decodePrLandValidateRequest(payload);
      return map(decoded, (prLandValidate) => ({ kind, prLandValidate }));
    }
    case RequestKind.PrLandReady: {
      const decoded = decodePrLandReadyRequest(payload);
      return map(decoded, (prLandReady) => ({ kind, prLandReady }));
    }
    case RequestKind.PrLandMergeCheck: {
      const decoded = decodePrLandMergeCheckRequest(payload);
      return map(decoded, (prLandMergeCheck) => ({ kind, prLandMergeCheck }));
    }
    case RequestKind.ToolsList: {
      const decoded = decodeToolsListRequest(payload);
      return map(decoded, (toolsList) => ({ kind, toolsList }));
    }
    case RequestKind.ToolsCall: {
      if (!isRecord(payload)) {
        return decodeErr([
          fieldError(join(path, kind), 'expected nested domain request object'),
        ]);
      }
      const nested = decodeLoomRequestAt(payload, join(path, kind), false);
      return map(nested, (toolsCall) => ({ kind, toolsCall }));
    }
  }
}

function map<T, U>(
  result: DecodeResult<T>,
  build: (value: T) => U,
): DecodeResult<U> {
  if (result.kind === ResultKind.Err) {
    return result;
  }
  return decodeOk(build(result.value));
}

function join(base: string, key: string): string {
  if (base.length === 0) {
    return key;
  }
  return `${base}.${key}`;
}

export function listRequestKinds(): readonly RequestKind[] {
  return ROOT_KEYS;
}
