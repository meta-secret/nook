import {
  ExternalPropertyPresence,
  externalProperty,
  type ExternalValue,
  isRecord,
} from '../lib/guards.ts';
import {
  decodeCortexAuditRequest,
  type CortexAuditRequest,
} from './args/cortex-audit.ts';
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
import { expectObject, mapDecode } from './object.ts';
import {
  decodeAgentStatsFamily,
  type AgentStatsLoomRequest,
} from './request-agent-stats.ts';
import {
  decodePrLandFamily,
  type PrLandLoomRequest,
} from './request-pr-land.ts';

export type LoomRequest =
  | { readonly family: RequestFamily.PrePush; readonly prePush: PrePushRequest }
  | {
      readonly family: RequestFamily.CortexAudit;
      readonly cortexAudit: CortexAuditRequest;
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
  RequestFamily.SkillScaffold,
  RequestFamily.AgentStats,
  RequestFamily.PrLand,
  RequestFamily.DependencyPopularity,
  RequestFamily.ToolsList,
  RequestFamily.ToolsCall,
];

export function decodeLoomRequest(
  value: ExternalValue,
): DecodeOutcome<LoomRequest> {
  return decodeLoomRequestAt({ value, path: '', allowToolsCall: true });
}

type DecodeLoomRequestAtArgs = {
  readonly value: ExternalValue;
  readonly path: string;
  readonly allowToolsCall: boolean;
};

function decodeLoomRequestAt(
  args: DecodeLoomRequestAtArgs,
): DecodeOutcome<LoomRequest> {
  const { value, path, allowToolsCall } = args;

  const object = expectObject({ value, path });
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
  const errors = unknownKeys.map((key) =>
    fieldError({
      path: joinPath({ base: path, key }),
      issue: FieldIssue.UnknownField,
    }),
  );
  if (domainKeys.length !== 1) {
    errors.push(
      fieldError({
        path: path.length === 0 ? '' : path,
        issue: FieldIssue.ExpectedExactlyOneDomainKey,
        detail: fieldDetailText(
          `expected exactly one domain request key; known: ${ROOT_FAMILIES.join(', ')}`,
        ),
      }),
    );
    return decodeErr(errors);
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  const family = domainKeys[0] as RequestFamily;
  if (family === RequestFamily.ToolsCall && !allowToolsCall) {
    return decodeErr([
      fieldError({
        path: joinPath({ base: path, key: family }),
        issue: FieldIssue.NestedToolsCallNotAllowed,
      }),
    ]);
  }
  const payloadProperty = externalProperty({
    record: object.value,
    key: family,
  });
  if (payloadProperty.presence === ExternalPropertyPresence.Absent) {
    return decodeErr([
      fieldError({
        path: joinPath({ base: path, key: family }),
        issue: FieldIssue.MissingRequiredField,
      }),
    ]);
  }
  return decodeFamily({
    family,
    payload: payloadProperty.value,
    path,
  });
}

type DecodeFamilyArgs = {
  readonly family: RequestFamily;
  readonly payload: ExternalValue;
  readonly path: string;
};

function decodeFamily(args: DecodeFamilyArgs): DecodeOutcome<LoomRequest> {
  const { family, payload, path } = args;

  switch (family) {
    case RequestFamily.PrePush: {
      const decoded = decodePrePushRequest(payload);
      return mapDecode({
        outcome: decoded,
        build: (prePush) => ({ family, prePush }),
      });
    }
    case RequestFamily.CortexAudit: {
      const decoded = decodeCortexAuditRequest(payload);
      return mapDecode({
        outcome: decoded,
        build: (cortexAudit) => ({ family, cortexAudit }),
      });
    }
    case RequestFamily.SkillScaffold: {
      const decoded = decodeSkillScaffoldRequest(payload);
      return mapDecode({
        outcome: decoded,
        build: (skillScaffold) => ({ family, skillScaffold }),
      });
    }
    case RequestFamily.AgentStats:
      return decodeAgentStatsFamily({ value: payload, path });
    case RequestFamily.PrLand:
      return decodePrLandFamily({ value: payload, path });
    case RequestFamily.DependencyPopularity: {
      const decoded = decodeDependencyPopularityRequest(payload);
      return mapDecode({
        outcome: decoded,
        build: (dependencyPopularity) => ({
          family,
          dependencyPopularity,
        }),
      });
    }
    case RequestFamily.ToolsList: {
      const decoded = decodeToolsListRequest(payload);
      return mapDecode({
        outcome: decoded,
        build: (toolsList) => ({ family, toolsList }),
      });
    }
    case RequestFamily.ToolsCall: {
      if (!isRecord(payload)) {
        return decodeErr([
          fieldError({
            path: joinPath({ base: path, key: family }),
            issue: FieldIssue.ExpectedNestedDomainRequest,
          }),
        ]);
      }
      const nested = decodeLoomRequestAt({
        value: payload,
        path: joinPath({ base: path, key: family }),
        allowToolsCall: false,
      });
      return mapDecode({
        outcome: nested,
        build: (toolsCall) => ({ family, toolsCall }),
      });
    }
  }
}

export function listRequestFamilies(): readonly RequestFamily[] {
  return ROOT_FAMILIES;
}
