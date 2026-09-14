import {
  CanonicalFeatureBranchContract,
  PinnedDevBaseEvidenceContract,
} from '../lib/base-evidence.ts';
import { UntrustedYamlBoundary } from '../lib/guards.ts';
import type { UntrustedYamlNode } from '../lib/guards.ts';
import { ModulePlanDecodeFailure, ModulePlanFields } from './codec-fields.ts';
import {
  ModuleDeliveryPlanTransportLimit,
  ModuleDeliveryPlanTransportLimitCode,
} from './codec-fields.ts';
import { ModuleDeliveryPlanDigest } from './codec-digest.ts';
import { ModuleDeliveryPlanNodeCodec } from './codec-node.ts';
import {
  LegacyModulePlanRootField,
  ModulePlanRootField,
  ModulePlanV3RootField,
  ModulePlanV4RootField,
  ModulePlanV5RootField,
} from './codec-schema.ts';
import type {
  RejectedModulePlanRequest,
} from './codec-schema.ts';
import {
  MAX_MODULE_DELIVERY_EDGE_CONTRACTS,
  MAX_MODULE_DELIVERY_NODES,
  MODULE_DELIVERY_PLAN_VERSION,
  ModuleDeliveryCompatibilityStatus,
  ModuleDeliveryIssueCode,
} from './domain.ts';
import {
  MAX_MODULE_DELIVERY_PLAN_AGGREGATE_NODES,
  MAX_MODULE_DELIVERY_PLAN_AGGREGATE_STRING_CODE_UNITS,
  MAX_MODULE_DELIVERY_PLAN_ARRAY_ENTRIES,
  MAX_MODULE_DELIVERY_PLAN_DEPTH,
  MAX_MODULE_DELIVERY_PLAN_HANDOFF_BYTES,
  MAX_MODULE_DELIVERY_PLAN_OBJECT_KEYS,
} from './evidence-limits.ts';
import type {
  CompatibleModuleDeliveryPlanDecode,
  LegacyModuleDeliveryPlan,
  ModuleDeliveryPlanV2,
  ModuleDeliveryPlanV3,
  ModuleDeliveryPlanV4,
  ModuleDeliveryPlanV5,
  ModuleDeliveryIssue,
  RejectedCompatibleModuleDeliveryPlan,
} from './domain.ts';

/** Owns the public module delivery plan codec boundary and version registry. */
export class ModuleDeliveryPlanSchema {
  private constructor() {}

  static decodeCompatibleModuleDeliveryPlan(
    serialized: string,
  ): CompatibleModuleDeliveryPlanDecode {
    if (
      Buffer.byteLength(serialized, 'utf8') > MAX_MODULE_DELIVERY_PLAN_HANDOFF_BYTES
    ) {
      const error = new ModuleDeliveryPlanTransportLimit({
        code: ModuleDeliveryPlanTransportLimitCode.SerializedByteLimit,
        observed: Buffer.byteLength(serialized, 'utf8'),
        limit: MAX_MODULE_DELIVERY_PLAN_HANDOFF_BYTES,
      });
      const request: RejectedModulePlanRequest = {
        code: error.code,
        path: error.path,
        message: error.message,
      };
      return ModuleDeliveryPlanSchema.rejected(request);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized) as unknown;
    } catch {
      const request: RejectedModulePlanRequest = {
        code: ModuleDeliveryIssueCode.MalformedTransport,
        message: 'Plan must be valid JSON.',
      };
      return ModuleDeliveryPlanSchema.rejected(request);
    }
    let node: UntrustedYamlNode;
    try {
      ModuleDeliveryPlanSchema.assertTransportWithinBounds(parsed);
      node = UntrustedYamlBoundary.fromHost(parsed);
      return ModuleDeliveryPlanSchema.decodePlanRoot(node);
    } catch (error) {
      if (error instanceof ModuleDeliveryPlanTransportLimit) {
        const request: RejectedModulePlanRequest = {
          code: error.code,
          path: error.path,
          message: error.message,
        };
        return ModuleDeliveryPlanSchema.rejected(request);
      }
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

  /** Iteratively bounds parsed JSON before the recursive transport adapter. */
  private static assertTransportWithinBounds(node: unknown): void {
    const pending: ModulePlanTransportFrame[] = [
      { node, depth: 0, path: '$' },
    ];
    let aggregateNodes = 0;
    let aggregateStringCodeUnits = 0;
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      aggregateNodes += 1;
      if (aggregateNodes > MAX_MODULE_DELIVERY_PLAN_AGGREGATE_NODES)
        ModuleDeliveryPlanSchema.throwTransportLimit({
          code: ModuleDeliveryPlanTransportLimitCode.AggregateNodeLimit,
          observed: aggregateNodes,
          limit: MAX_MODULE_DELIVERY_PLAN_AGGREGATE_NODES,
          path: '$',
        });
      if (current.depth > MAX_MODULE_DELIVERY_PLAN_DEPTH)
        ModuleDeliveryPlanSchema.throwTransportLimit({
          code: ModuleDeliveryPlanTransportLimitCode.DepthLimit,
          observed: current.depth,
          limit: MAX_MODULE_DELIVERY_PLAN_DEPTH,
          path: current.path,
        });
      if (typeof current.node === 'string') {
        aggregateStringCodeUnits += current.node.length;
        if (
          aggregateStringCodeUnits >
          MAX_MODULE_DELIVERY_PLAN_AGGREGATE_STRING_CODE_UNITS
        )
          ModuleDeliveryPlanSchema.throwTransportLimit({
            code: ModuleDeliveryPlanTransportLimitCode.AggregateStringLimit,
            observed: aggregateStringCodeUnits,
            limit: MAX_MODULE_DELIVERY_PLAN_AGGREGATE_STRING_CODE_UNITS,
            path: '$',
          });
        continue;
      }
      if (
        current.node === null ||
        typeof current.node === 'boolean' ||
        typeof current.node === 'number'
      )
        continue;
      if (Array.isArray(current.node)) {
        if (current.node.length > MAX_MODULE_DELIVERY_PLAN_ARRAY_ENTRIES)
          ModuleDeliveryPlanSchema.throwTransportLimit({
            code: ModuleDeliveryPlanTransportLimitCode.ArrayEntryLimit,
            observed: current.node.length,
            limit: MAX_MODULE_DELIVERY_PLAN_ARRAY_ENTRIES,
            path: current.path,
          });
        const childDepth = current.depth + 1;
        for (let index = current.node.length - 1; index >= 0; index -= 1)
          pending.push({
            node: current.node[index],
            depth: childDepth,
            path: `${current.path}[${index}]`,
          });
        continue;
      }
      if (typeof current.node !== 'object') continue;
      if (!UntrustedYamlBoundary.isRecord(current.node)) continue;
      const object = current.node;
      const keys = Object.keys(object);
      if (keys.length > MAX_MODULE_DELIVERY_PLAN_OBJECT_KEYS)
        ModuleDeliveryPlanSchema.throwTransportLimit({
          code: ModuleDeliveryPlanTransportLimitCode.ObjectKeyLimit,
          observed: keys.length,
          limit: MAX_MODULE_DELIVERY_PLAN_OBJECT_KEYS,
          path: current.path,
        });
      const childDepth = current.depth + 1;
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        if (key === undefined) continue;
        aggregateStringCodeUnits += key.length;
        if (
          aggregateStringCodeUnits >
          MAX_MODULE_DELIVERY_PLAN_AGGREGATE_STRING_CODE_UNITS
        )
          ModuleDeliveryPlanSchema.throwTransportLimit({
            code: ModuleDeliveryPlanTransportLimitCode.AggregateStringLimit,
            observed: aggregateStringCodeUnits,
            limit: MAX_MODULE_DELIVERY_PLAN_AGGREGATE_STRING_CODE_UNITS,
            path: '$',
          });
        pending.push({
          node: object[key],
          depth: childDepth,
          path: current.path,
        });
      }
    }
  }

  private static throwTransportLimit(request: {
    readonly code: ModuleDeliveryPlanTransportLimitCode;
    readonly observed: number;
    readonly limit: number;
    readonly path: string;
  }): never {
    throw new ModuleDeliveryPlanTransportLimit(request);
  }

  /** Creates a branch-authoritative plan from a historical V4 value without mutating it. */
  static migrateModuleDeliveryPlan(
    ...[plan, featureBranch]: [
      plan: ModuleDeliveryPlanV4,
      featureBranch: string,
    ]
  ): ModuleDeliveryPlanV5 {
    if (plan.version !== 4)
      throw new Error('Only module delivery plan version 4 can be migrated.');
    const branch = CanonicalFeatureBranchContract.parse(featureBranch);
    PinnedDevBaseEvidenceContract.assertShape({
      originMainSha: plan.originMainSha,
      pinnedLocalDevSha: plan.pinnedLocalDevSha,
    });
    const { featureHeadSha: _observedFeatureHeadSha, ...withoutFeatureHead } =
      plan;
    return {
      ...withoutFeatureHead,
      version: MODULE_DELIVERY_PLAN_VERSION,
      featureBranch: branch,
    };
  }

  static moduleDeliveryPlanDigest(plan: ModuleDeliveryPlanV5): string {
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
      version !== 4 &&
      version !== MODULE_DELIVERY_PLAN_VERSION
    )
      ModuleDeliveryPlanSchema.fail(
        '$.version: plan version must be 1, 2, 3, 4, or 5.',
      );
    const legacy = version === 1;
    if (legacy) fields.requireExactKeys(LegacyModulePlanRootField);
    else if (version === 2) fields.requireExactKeys(ModulePlanRootField);
    else if (version === 3) fields.requireExactKeys(ModulePlanV3RootField);
    else if (version === 4) fields.requireExactKeys(ModulePlanV4RootField);
    else fields.requireExactKeys(ModulePlanV5RootField);
    const parentJoinRequest = {
      record: fields.recordField('parentJoin'),
      path: '$.parentJoin',
    };
    const nodeValues = fields.nodeList('nodes', MAX_MODULE_DELIVERY_NODES);
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
    if (version === 1) {
      const nodes = ModuleDeliveryPlanNodeCodec.decodeNodes({
        values: nodeValues,
        legacy: true,
      });
      const edgeContracts = ModuleDeliveryPlanNodeCodec.decodeEdgeContracts(
        fields.list('edgeContracts', MAX_MODULE_DELIVERY_EDGE_CONTRACTS),
      );
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
    const nodes = ModuleDeliveryPlanNodeCodec.decodeNodes({
      values: nodeValues,
      legacy: false,
    });
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
    if (version === 4) {
      const plan: ModuleDeliveryPlanV4 = {
        version: 4,
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
    const currentPlan: ModuleDeliveryPlanV5 = {
      version: MODULE_DELIVERY_PLAN_VERSION,
      generation,
      sourceCommit,
      originMainSha: fields.string('originMainSha'),
      pinnedLocalDevSha: fields.string('pinnedLocalDevSha'),
      featureBranch: CanonicalFeatureBranchContract.parse(
        fields.string('featureBranch'),
      ),
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
      plan: currentPlan,
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

type ModulePlanTransportFrame = {
  readonly node: unknown;
  readonly depth: number;
  readonly path: string;
};
