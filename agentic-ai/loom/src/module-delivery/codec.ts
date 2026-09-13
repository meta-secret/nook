import { PinnedDevBaseEvidenceContract } from '../lib/base-evidence.ts';
import { UntrustedYamlBoundary } from '../lib/guards.ts';
import type { UntrustedYamlNode } from '../lib/guards.ts';
import { ModulePlanDecodeFailure, ModulePlanFields } from './codec-fields.ts';
import { ModuleDeliveryPlanDigest } from './codec-digest.ts';
import { ModuleDeliveryPlanNodeCodec } from './codec-node.ts';
import {
  LegacyModulePlanRootField,
  ModulePlanRootField,
  ModulePlanV3RootField,
  ModulePlanV4RootField,
} from './codec-schema.ts';
import type {
  ModulePlanNodeListRequest,
  RejectedModulePlanRequest,
} from './codec-schema.ts';
import {
  MAX_MODULE_DELIVERY_EDGE_CONTRACTS,
  MAX_MODULE_DELIVERY_NODES,
  MODULE_DELIVERY_PLAN_VERSION,
  ModuleDeliveryCompatibilityStatus,
  ModuleDeliveryIssueCode,
} from './domain.ts';
import type {
  CompatibleModuleDeliveryPlanDecode,
  LegacyModuleDeliveryPlan,
  ModuleDeliveryPlanV2,
  ModuleDeliveryPlanV3,
  ModuleDeliveryPlanV4,
  ModuleDeliveryIssue,
  RejectedCompatibleModuleDeliveryPlan,
} from './domain.ts';

/** Owns the public module delivery plan codec boundary and version registry. */
export class ModuleDeliveryPlanSchema {
  private constructor() {}
  private static readonly MAX_SERIALIZED_PLAN_BYTES = 262_144;

  static decodeCompatibleModuleDeliveryPlan(
    serialized: string,
  ): CompatibleModuleDeliveryPlanDecode {
    if (
      Buffer.byteLength(serialized, 'utf8') >
      ModuleDeliveryPlanSchema.MAX_SERIALIZED_PLAN_BYTES
    ) {
      const request: RejectedModulePlanRequest = {
        code: ModuleDeliveryIssueCode.LimitExceeded,
        message: 'Plan transport exceeds 262144 bytes.',
      };
      return ModuleDeliveryPlanSchema.rejected(request);
    }
    let node: UntrustedYamlNode;
    try {
      node = UntrustedYamlBoundary.fromHost(JSON.parse(serialized));
    } catch {
      const request: RejectedModulePlanRequest = {
        code: ModuleDeliveryIssueCode.MalformedTransport,
        message: 'Plan must be valid JSON.',
      };
      return ModuleDeliveryPlanSchema.rejected(request);
    }
    try {
      return ModuleDeliveryPlanSchema.decodePlanRoot(node);
    } catch (error) {
      if (error instanceof ModulePlanDecodeFailure) {
        const request: RejectedModulePlanRequest = {
          code: error.code,
          path: error.path,
          message: error.message,
        };
        return ModuleDeliveryPlanSchema.rejected(request);
      }
      throw error;
    }
  }

  /** Creates a current plan from V3 evidence without mutating the old plan. */
  static migrateModuleDeliveryPlan(
    plan: ModuleDeliveryPlanV3,
    featureHeadSha: string,
  ): ModuleDeliveryPlanV4 {
    if (plan.version !== 3)
      throw new Error('Only module delivery plan version 3 can be migrated.');
    PinnedDevBaseEvidenceContract.assertShape({
      originMainSha: plan.originMainSha,
      pinnedLocalDevSha: plan.pinnedLocalDevSha,
      featureHeadSha,
    });
    return {
      ...plan,
      version: MODULE_DELIVERY_PLAN_VERSION,
      featureHeadSha,
    };
  }

  static moduleDeliveryPlanDigest(plan: ModuleDeliveryPlanV4): string {
    return ModuleDeliveryPlanDigest.moduleDeliveryPlanDigest(plan);
  }

  private static decodePlanRoot(
    node: UntrustedYamlNode,
  ): CompatibleModuleDeliveryPlanDecode {
    if (!UntrustedYamlBoundary.isRecord(node))
      ModuleDeliveryPlanSchema.fail('Plan root must be an object.');
    const fieldRequest = { record: node, path: '$' };
    const fields = new ModulePlanFields(fieldRequest);
    const version = fields.positiveInteger('version');
    if (
      version !== 1 &&
      version !== 2 &&
      version !== 3 &&
      version !== MODULE_DELIVERY_PLAN_VERSION
    )
      ModuleDeliveryPlanSchema.fail(
        '$.version: plan version must be 1, 2, 3, or 4.',
      );
    const legacy = version === 1;
    if (legacy) fields.requireExactKeys(LegacyModulePlanRootField);
    else if (version === 2) fields.requireExactKeys(ModulePlanRootField);
    else if (version === 3) fields.requireExactKeys(ModulePlanV3RootField);
    else fields.requireExactKeys(ModulePlanV4RootField);
    const parentJoinRequest = {
      record: fields.recordField('parentJoin'),
      path: '$.parentJoin',
    };
    const nodeListRequest: ModulePlanNodeListRequest = {
      values: fields.nodeList('nodes', MAX_MODULE_DELIVERY_NODES),
      legacy,
    };
    const generation = legacy ? 1 : fields.positiveInteger('generation');
    const sourceCommit = fields.string('sourceCommit');
    const maxAgentDepth = fields.positiveInteger('maxAgentDepth');
    const maxAttempts = fields.positiveInteger('maxAttempts');
    const parentOwnedResources = fields.nonEmptyStringList(
      'parentOwnedResources',
    );
    const parentJoin = ModuleDeliveryPlanNodeCodec.decodeParentJoin(
      parentJoinRequest,
    );
    const nodes = ModuleDeliveryPlanNodeCodec.decodeNodes(nodeListRequest);
    const edgeContracts = ModuleDeliveryPlanNodeCodec.decodeEdgeContracts(
      fields.list('edgeContracts', MAX_MODULE_DELIVERY_EDGE_CONTRACTS),
    );
    const common = {
      generation,
      sourceCommit,
      maxAgentDepth,
      maxAttempts,
      parentOwnedResources,
      parentJoin,
      nodes,
      edgeContracts,
    };
    if (version === 1) {
      const plan: LegacyModuleDeliveryPlan = {
        version: 1,
        sourceCommit,
        maxAgentDepth,
        maxAttempts,
        parentOwnedResources,
        parentJoin,
        nodes,
        edgeContracts,
      };
      return {
        status: ModuleDeliveryCompatibilityStatus.Decoded,
        inputVersion: version,
        plan,
      };
    }
    if (version === 2) {
      const plan: ModuleDeliveryPlanV2 = { version: 2, ...common };
      return {
        status: ModuleDeliveryCompatibilityStatus.Decoded,
        inputVersion: version,
        plan,
      };
    }
    if (version === 3) {
      const plan: ModuleDeliveryPlanV3 = {
        version: 3,
        generation,
        sourceCommit,
        originMainSha: fields.string('originMainSha'),
        pinnedLocalDevSha: fields.string('pinnedLocalDevSha'),
        maxAgentDepth,
        maxAttempts,
        parentOwnedResources,
        parentJoin,
        nodes,
        edgeContracts,
      };
      return {
        status: ModuleDeliveryCompatibilityStatus.Decoded,
        inputVersion: version,
        plan,
      };
    }
    const plan: ModuleDeliveryPlanV4 = {
      version: MODULE_DELIVERY_PLAN_VERSION,
      generation,
      sourceCommit,
      originMainSha: fields.string('originMainSha'),
      pinnedLocalDevSha: fields.string('pinnedLocalDevSha'),
      featureHeadSha: fields.string('featureHeadSha'),
      maxAgentDepth,
      maxAttempts,
      parentOwnedResources,
      parentJoin,
      nodes,
      edgeContracts,
    };
    return {
      status: ModuleDeliveryCompatibilityStatus.Decoded,
      inputVersion: version,
      plan,
    };
  }

  private static rejected(
    request: RejectedModulePlanRequest,
  ): RejectedCompatibleModuleDeliveryPlan {
    const issue: ModuleDeliveryIssue = {
      code: request.code,
      path: request.path ?? '$',
      message: request.message,
    };
    return {
      status: ModuleDeliveryCompatibilityStatus.Rejected,
      issues: [issue],
    };
  }

  private static fail(message: string): never {
    throw new ModulePlanDecodeFailure({ message });
  }
}
