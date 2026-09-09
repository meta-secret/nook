import {
  UntrustedYamlPropertyPresence,
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from '../lib/guards.ts';
import {
  type CortexAuditRequest,
  CortexAuditRequestDecoder,
} from './args/cortex-audit.ts';
import {
  type CortexSessionCleanRequest,
  CortexSessionCleanRequestDecoder,
} from './args/cortex-session-clean.ts';
import {
  type DependencyPopularityRequest,
  DependencyPopularityRequestDecoder,
} from './args/dependency-popularity.ts';
import { type PrePushRequest, PrePushRequestDecoder } from './args/pre-push.ts';
import {
  type SkillScaffoldRequest,
  SkillScaffoldRequestDecoder,
} from './args/skill-scaffold.ts';
import {
  type ToolsListRequest,
  ToolsListRequestDecoder,
} from './args/tools-list.ts';
import { RequestFamily } from './enums.ts';
import {
  DecodeStatus,
  FieldIssue,
  type DecodeOutcome,
  FailedFieldDecode,
  FieldDiagnosticText,
  FieldDiagnostic,
  FieldPath,
} from './field-error.ts';
import {
  type ExpectObjectArgs,
  type MapDecodeArgs,
  YamlObjectField,
  FieldDecodeProjection,
} from './object.ts';
import {
  type AgentStatsLoomRequest,
  type DecodeAgentStatsFamilyArgs,
  AgentStatsFamilyDecoder,
} from './request-agent-stats.ts';
import {
  type DecodePrLandFamilyArgs,
  type PrLandLoomRequest,
  PrLandFamilyDecoder,
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

/** Owns the loom request schema registry and its capability transitions. */
export class LoomRequestSchema {
  private constructor() {}
  private static readonly ROOT_FAMILIES: readonly RequestFamily[] = [
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

  static decodeLoomRequest(
    value: UntrustedYamlNode,
  ): DecodeOutcome<LoomRequest> {
    const decodeLoomRequestAtArgs = { value, path: '', allowToolsCall: true };
    return LoomRequestSchema.decodeLoomRequestAt(decodeLoomRequestAtArgs);
  }

  private static decodeLoomRequestAt(
    args: DecodeLoomRequestAtArgs,
  ): DecodeOutcome<LoomRequest> {
    const { value, path, allowToolsCall } = args;

    const objectArgs: ExpectObjectArgs = { value, path };
    const object = YamlObjectField.decode(objectArgs);
    if (object.status === DecodeStatus.Failed) {
      return object;
    }
    const keys = Object.keys(object.value);
    const domainKeys = keys.filter((key) =>
      LoomRequestSchema.ROOT_FAMILIES.includes(key as RequestFamily),
    );
    const unknownKeys = keys.filter(
      (key) => !LoomRequestSchema.ROOT_FAMILIES.includes(key as RequestFamily),
    );
    const errors = unknownKeys.map((key) => {
      const joinPathArgs5: JoinPathArgs = { base: path, key };
      const fieldErrorArgs5: FieldErrorArgs = {
        path: FieldPath.join(joinPathArgs5),
        issue: FieldIssue.UnknownField,
      };
      return FieldDiagnostic.create(fieldErrorArgs5);
    });
    if (domainKeys.length !== 1) {
      const fieldErrorArgs4: FieldErrorArgs = {
        path: path.length === 0 ? '' : path,
        issue: FieldIssue.ExpectedExactlyOneDomainKey,
        detail: FieldDiagnosticText.create(
          `expected exactly one domain request key; known: ${LoomRequestSchema.ROOT_FAMILIES.join(', ')}`,
        ),
      };
      errors.push(FieldDiagnostic.create(fieldErrorArgs4));
      return FailedFieldDecode.create(errors);
    }
    if (errors.length > 0) {
      return FailedFieldDecode.create(errors);
    }
    const family = domainKeys[0] as RequestFamily;
    if (family === RequestFamily.ToolsCall && !allowToolsCall) {
      const joinPathArgs4: JoinPathArgs = { base: path, key: family };
      const fieldErrorArgs3: FieldErrorArgs = {
        path: FieldPath.join(joinPathArgs4),
        issue: FieldIssue.NestedToolsCallNotAllowed,
      };
      return FailedFieldDecode.create([
        FieldDiagnostic.create(fieldErrorArgs3),
      ]);
    }
    const payloadPropertyArgs: UntrustedYamlPropertyArgs = {
      record: object.value,
      key: family,
    };
    const payloadProperty = UntrustedYamlBoundary.property(payloadPropertyArgs);
    if (payloadProperty.presence === UntrustedYamlPropertyPresence.Absent) {
      const joinPathArgs3: JoinPathArgs = { base: path, key: family };
      const fieldErrorArgs2: FieldErrorArgs = {
        path: FieldPath.join(joinPathArgs3),
        issue: FieldIssue.MissingRequiredField,
      };
      return FailedFieldDecode.create([
        FieldDiagnostic.create(fieldErrorArgs2),
      ]);
    }
    const decodeFamilyArgs = {
      family,
      payload: payloadProperty.value,
      path,
    };
    return LoomRequestSchema.decodeFamily(decodeFamilyArgs);
  }

  private static decodeFamily(
    args: DecodeFamilyArgs,
  ): DecodeOutcome<LoomRequest> {
    const { family, payload, path } = args;

    switch (family) {
      case RequestFamily.PrePush: {
        const decoded = PrePushRequestDecoder.decode(payload);
        const mapDecodeArgs6: MapDecodeArgs<PrePushRequest, LoomRequest> = {
          outcome: decoded,
          build: (prePush) => ({ family: RequestFamily.PrePush, prePush }),
        };
        return FieldDecodeProjection.map(mapDecodeArgs6);
      }
      case RequestFamily.CortexAudit: {
        const decoded = CortexAuditRequestDecoder.decode(payload);
        const mapDecodeArgs5: MapDecodeArgs<CortexAuditRequest, LoomRequest> = {
          outcome: decoded,
          build: (cortexAudit) => ({
            family: RequestFamily.CortexAudit,
            cortexAudit,
          }),
        };
        return FieldDecodeProjection.map(mapDecodeArgs5);
      }
      case RequestFamily.CortexSessionClean: {
        const decoded = CortexSessionCleanRequestDecoder.decode(payload);
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
        return FieldDecodeProjection.map(mapDecodeArgs);
      }
      case RequestFamily.SkillScaffold: {
        const decoded = SkillScaffoldRequestDecoder.decode(payload);
        const mapDecodeArgs4: MapDecodeArgs<SkillScaffoldRequest, LoomRequest> =
          {
            outcome: decoded,
            build: (skillScaffold) => ({
              family: RequestFamily.SkillScaffold,
              skillScaffold,
            }),
          };
        return FieldDecodeProjection.map(mapDecodeArgs4);
      }
      case RequestFamily.AgentStats: {
        const decodeAgentStatsFamilyArgs: DecodeAgentStatsFamilyArgs = {
          value: payload,
          path,
        };
        return AgentStatsFamilyDecoder.decodeAgentStatsFamily(
          decodeAgentStatsFamilyArgs,
        );
      }
      case RequestFamily.PrLand: {
        const decodePrLandFamilyArgs: DecodePrLandFamilyArgs = {
          value: payload,
          path,
        };
        return PrLandFamilyDecoder.decodePrLandFamily(decodePrLandFamilyArgs);
      }
      case RequestFamily.DependencyPopularity: {
        const decoded = DependencyPopularityRequestDecoder.decode(payload);
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
        return FieldDecodeProjection.map(mapDecodeArgs3);
      }
      case RequestFamily.ToolsList: {
        const decoded = ToolsListRequestDecoder.decode(payload);
        const mapDecodeArgs2: MapDecodeArgs<ToolsListRequest, LoomRequest> = {
          outcome: decoded,
          build: (toolsList) => ({
            family: RequestFamily.ToolsList,
            toolsList,
          }),
        };
        return FieldDecodeProjection.map(mapDecodeArgs2);
      }
      case RequestFamily.ToolsCall: {
        if (!UntrustedYamlBoundary.isRecord(payload)) {
          const joinPathArgs2: JoinPathArgs = { base: path, key: family };
          const fieldErrorArgs: FieldErrorArgs = {
            path: FieldPath.join(joinPathArgs2),
            issue: FieldIssue.ExpectedNestedDomainRequest,
          };
          return FailedFieldDecode.create([
            FieldDiagnostic.create(fieldErrorArgs),
          ]);
        }
        const joinPathArgs: JoinPathArgs = { base: path, key: family };
        const nestedArgs: DecodeLoomRequestAtArgs = {
          value: payload,
          path: FieldPath.join(joinPathArgs),
          allowToolsCall: false,
        };
        const nested = LoomRequestSchema.decodeLoomRequestAt(nestedArgs);
        const mapDecodeArgs: MapDecodeArgs<LoomRequest, LoomRequest> = {
          outcome: nested,
          build: (toolsCall) => ({
            family: RequestFamily.ToolsCall,
            toolsCall,
          }),
        };
        return FieldDecodeProjection.map(mapDecodeArgs);
      }
    }
  }

  static listRequestFamilies(): readonly RequestFamily[] {
    return LoomRequestSchema.ROOT_FAMILIES;
  }
}

type DecodeLoomRequestAtArgs = {
  readonly value: UntrustedYamlNode;
  readonly path: string;
  readonly allowToolsCall: boolean;
};

type DecodeFamilyArgs = {
  readonly family: RequestFamily;
  readonly payload: UntrustedYamlNode;
  readonly path: string;
};
