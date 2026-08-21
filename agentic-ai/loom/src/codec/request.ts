import {
  UntrustedYamlPropertyPresence,
  untrustedYamlProperty,
  type UntrustedYamlNode,
  isRecord,
} from '../lib/guards.ts';
import {
  decodeCortexAuditRequest,
  type CortexAuditRequest,
} from './args/cortex-audit.ts';
import {
  decodeCortexSessionCleanRequest,
  type CortexSessionCleanRequest,
} from './args/cortex-session-clean.ts';
import {
  decodeDependencyPopularityRequest,
  type DependencyPopularityRequest,
} from './args/dependency-popularity.ts';
import { decodePrePushRequest, type PrePushRequest } from './args/pre-push.ts';
import {
  decodeSkillScaffoldRequest,
  type SkillScaffoldRequest,
} from './args/skill-scaffold.ts';
import {
  decodeToolsListRequest,
  type ToolsListRequest,
} from './args/tools-list.ts';
import { RequestFamily } from './enums.ts';
import {
  DecodeStatus,
  FieldIssue,
  decodeErr,
  fieldDetailText,
  fieldError,
  joinPath,
  type DecodeOutcome,
} from './field-error.ts';
import {
  expectObject,
  mapDecode,
  type ExpectObjectArgs,
  type MapDecodeArgs,
} from './object.ts';
import {
  decodeAgentStatsFamily,
  type AgentStatsLoomRequest,
  type DecodeAgentStatsFamilyArgs,
} from './request-agent-stats.ts';
import {
  decodePrLandFamily,
  type DecodePrLandFamilyArgs,
  type PrLandLoomRequest,
} from './request-pr-land.ts';
import type { FieldErrorArgs, JoinPathArgs } from './field-error.ts';
import type { UntrustedYamlPropertyArgs } from '../lib/guards.ts';
export type LoomRequest =
  | { readonly family: RequestFamily.PrePush; readonly prePush: PrePushRequest }
  | {
      readonly family: RequestFamily.CortexAudit;
      readonly cortexAudit: CortexAuditRequest;
    }
  | {
      readonly family: RequestFamily.CortexSessionClean;
      readonly cortexSessionClean: CortexSessionCleanRequest;
    }
  | {
      readonly family: RequestFamily.SkillScaffold;
      readonly skillScaffold: SkillScaffoldRequest;
    }
  | AgentStatsLoomRequest
  | PrLandLoomRequest
  | {
      readonly family: RequestFamily.DependencyPopularity;
      readonly dependencyPopularity: DependencyPopularityRequest;
    }
  | {
      readonly family: RequestFamily.ToolsList;
      readonly toolsList: ToolsListRequest;
    }
  | {
      readonly family: RequestFamily.ToolsCall;
      readonly toolsCall: LoomRequest;
    };

const ROOT_FAMILIES: readonly RequestFamily[] = [
  RequestFamily.PrePush,
  RequestFamily.CortexAudit,
  RequestFamily.CortexSessionClean,
  RequestFamily.SkillScaffold,
  RequestFamily.AgentStats,
  RequestFamily.PrLand,
  RequestFamily.DependencyPopularity,
  RequestFamily.ToolsList,
  RequestFamily.ToolsCall,
];

export function decodeLoomRequest(
  value: UntrustedYamlNode,
): DecodeOutcome<LoomRequest> {
  const decodeLoomRequestAtArgs = { value, path: '', allowToolsCall: true };
  return decodeLoomRequestAt(decodeLoomRequestAtArgs);
}

type DecodeLoomRequestAtArgs = {
  readonly value: UntrustedYamlNode;
  readonly path: string;
  readonly allowToolsCall: boolean;
};

function decodeLoomRequestAt(
  args: DecodeLoomRequestAtArgs,
): DecodeOutcome<LoomRequest> {
  const { value, path, allowToolsCall } = args;

  const objectArgs: ExpectObjectArgs = { value, path };
  const object = expectObject(objectArgs);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const keys = Object.keys(object.value);
  const domainKeys = keys.filter((key) =>
    ROOT_FAMILIES.includes(key as RequestFamily),
  );
  const unknownKeys = keys.filter(
    (key) => !ROOT_FAMILIES.includes(key as RequestFamily),
  );
  const errors = unknownKeys.map((key) => {
    const joinPathArgs5: JoinPathArgs = { base: path, key };
    const fieldErrorArgs5: FieldErrorArgs = {
      path: joinPath(joinPathArgs5),
      issue: FieldIssue.UnknownField,
    };
    return fieldError(fieldErrorArgs5);
  });
  if (domainKeys.length !== 1) {
    const fieldErrorArgs4: FieldErrorArgs = {
      path: path.length === 0 ? '' : path,
      issue: FieldIssue.ExpectedExactlyOneDomainKey,
      detail: fieldDetailText(
        `expected exactly one domain request key; known: ${ROOT_FAMILIES.join(', ')}`,
      ),
    };
    errors.push(fieldError(fieldErrorArgs4));
    return decodeErr(errors);
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  const family = domainKeys[0] as RequestFamily;
  if (family === RequestFamily.ToolsCall && !allowToolsCall) {
    const joinPathArgs4: JoinPathArgs = { base: path, key: family };
    const fieldErrorArgs3: FieldErrorArgs = {
      path: joinPath(joinPathArgs4),
      issue: FieldIssue.NestedToolsCallNotAllowed,
    };
    return decodeErr([fieldError(fieldErrorArgs3)]);
  }
  const payloadPropertyArgs: UntrustedYamlPropertyArgs = {
    record: object.value,
    key: family,
  };
  const payloadProperty = untrustedYamlProperty(payloadPropertyArgs);
  if (payloadProperty.presence === UntrustedYamlPropertyPresence.Absent) {
    const joinPathArgs3: JoinPathArgs = { base: path, key: family };
    const fieldErrorArgs2: FieldErrorArgs = {
      path: joinPath(joinPathArgs3),
      issue: FieldIssue.MissingRequiredField,
    };
    return decodeErr([fieldError(fieldErrorArgs2)]);
  }
  const decodeFamilyArgs = {
    family,
    payload: payloadProperty.value,
    path,
  };
  return decodeFamily(decodeFamilyArgs);
}

type DecodeFamilyArgs = {
  readonly family: RequestFamily;
  readonly payload: UntrustedYamlNode;
  readonly path: string;
};

function decodeFamily(args: DecodeFamilyArgs): DecodeOutcome<LoomRequest> {
  const { family, payload, path } = args;

  switch (family) {
    case RequestFamily.PrePush: {
      const decoded = decodePrePushRequest(payload);
      const mapDecodeArgs6: MapDecodeArgs<PrePushRequest, LoomRequest> = {
        outcome: decoded,
        build: (prePush) => ({ family: RequestFamily.PrePush, prePush }),
      };
      return mapDecode(mapDecodeArgs6);
    }
    case RequestFamily.CortexAudit: {
      const decoded = decodeCortexAuditRequest(payload);
      const mapDecodeArgs5: MapDecodeArgs<CortexAuditRequest, LoomRequest> = {
        outcome: decoded,
        build: (cortexAudit) => ({
          family: RequestFamily.CortexAudit,
          cortexAudit,
        }),
      };
      return mapDecode(mapDecodeArgs5);
    }
    case RequestFamily.CortexSessionClean: {
      const decoded = decodeCortexSessionCleanRequest(payload);
      const mapDecodeArgs: MapDecodeArgs<
        CortexSessionCleanRequest,
        LoomRequest
      > = {
        outcome: decoded,
        build: (cortexSessionClean) => ({
          family: RequestFamily.CortexSessionClean,
          cortexSessionClean,
        }),
      };
      return mapDecode(mapDecodeArgs);
    }
    case RequestFamily.SkillScaffold: {
      const decoded = decodeSkillScaffoldRequest(payload);
      const mapDecodeArgs4: MapDecodeArgs<SkillScaffoldRequest, LoomRequest> = {
        outcome: decoded,
        build: (skillScaffold) => ({
          family: RequestFamily.SkillScaffold,
          skillScaffold,
        }),
      };
      return mapDecode(mapDecodeArgs4);
    }
    case RequestFamily.AgentStats: {
      const decodeAgentStatsFamilyArgs: DecodeAgentStatsFamilyArgs = {
        value: payload,
        path,
      };
      return decodeAgentStatsFamily(decodeAgentStatsFamilyArgs);
    }
    case RequestFamily.PrLand: {
      const decodePrLandFamilyArgs: DecodePrLandFamilyArgs = {
        value: payload,
        path,
      };
      return decodePrLandFamily(decodePrLandFamilyArgs);
    }
    case RequestFamily.DependencyPopularity: {
      const decoded = decodeDependencyPopularityRequest(payload);
      const mapDecodeArgs3: MapDecodeArgs<
        DependencyPopularityRequest,
        LoomRequest
      > = {
        outcome: decoded,
        build: (dependencyPopularity) => ({
          family: RequestFamily.DependencyPopularity,
          dependencyPopularity,
        }),
      };
      return mapDecode(mapDecodeArgs3);
    }
    case RequestFamily.ToolsList: {
      const decoded = decodeToolsListRequest(payload);
      const mapDecodeArgs2: MapDecodeArgs<ToolsListRequest, LoomRequest> = {
        outcome: decoded,
        build: (toolsList) => ({ family: RequestFamily.ToolsList, toolsList }),
      };
      return mapDecode(mapDecodeArgs2);
    }
    case RequestFamily.ToolsCall: {
      if (!isRecord(payload)) {
        const joinPathArgs2: JoinPathArgs = { base: path, key: family };
        const fieldErrorArgs: FieldErrorArgs = {
          path: joinPath(joinPathArgs2),
          issue: FieldIssue.ExpectedNestedDomainRequest,
        };
        return decodeErr([fieldError(fieldErrorArgs)]);
      }
      const joinPathArgs: JoinPathArgs = { base: path, key: family };
      const nestedArgs: DecodeLoomRequestAtArgs = {
        value: payload,
        path: joinPath(joinPathArgs),
        allowToolsCall: false,
      };
      const nested = decodeLoomRequestAt(nestedArgs);
      const mapDecodeArgs: MapDecodeArgs<LoomRequest, LoomRequest> = {
        outcome: nested,
        build: (toolsCall) => ({ family: RequestFamily.ToolsCall, toolsCall }),
      };
      return mapDecode(mapDecodeArgs);
    }
  }
}

export function listRequestFamilies(): readonly RequestFamily[] {
  return ROOT_FAMILIES;
}
