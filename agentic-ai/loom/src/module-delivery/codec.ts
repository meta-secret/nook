import { CanonicalFeatureBranchContract } from '../lib/base-evidence.ts';
import { UntrustedYamlBoundary } from '../lib/guards.ts';
import type { UntrustedYamlNode } from '../lib/guards.ts';
import { ModulePlanDecodeFailure, ModulePlanFields } from './codec-fields.ts';
import {
  ModuleDeliveryPlanTransportLimit,
  ModuleDeliveryPlanTransportLimitCode,
} from './codec-fields.ts';
import { ModuleDeliveryPlanDigest } from './codec-digest.ts';
import { ModuleDeliveryPlanNodeCodec } from './codec-node.ts';
import { ModulePlanV5RootField } from './codec-schema.ts';
import type { RejectedModulePlanRequest } from './codec-schema.ts';
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
      Buffer.byteLength(serialized, 'utf8') >
      MAX_MODULE_DELIVERY_PLAN_HANDOFF_BYTES
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
    const pending: ModulePlanTransportFrame[] = [{ node, depth: 0, path: '$' }];
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
        (typeof current.node === 'object' && !current.node) ||
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
      const entries = Object.entries(object);
      if (entries.length > MAX_MODULE_DELIVERY_PLAN_OBJECT_KEYS)
        ModuleDeliveryPlanSchema.throwTransportLimit({
          code: ModuleDeliveryPlanTransportLimitCode.ObjectKeyLimit,
          observed: entries.length,
          limit: MAX_MODULE_DELIVERY_PLAN_OBJECT_KEYS,
          path: current.path,
        });
      const childDepth = current.depth + 1;
      for (const [key, value] of entries.reverse()) {
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
          node: value,
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
    if (version !== MODULE_DELIVERY_PLAN_VERSION)
      ModuleDeliveryPlanSchema.fail(
        '$.version: only canonical plan version 5 is accepted.',
      );
    fields.requireExactKeys(ModulePlanV5RootField);
    const parentJoinRequest = {
      record: fields.recordField('parentJoin'),
      path: '$.parentJoin',
    };
    const nodeValues = fields.nodeList('nodes', MAX_MODULE_DELIVERY_NODES);
    const generation = fields.positiveInteger('generation');
    const maxAgentDepth = fields.positiveInteger('maxAgentDepth');
    const maxAttempts = fields.positiveInteger('maxAttempts');
    const parentOwnedResources = fields.nonEmptyStringList(
      'parentOwnedResources',
    );
    const parentJoin =
      ModuleDeliveryPlanNodeCodec.decodeParentJoin(parentJoinRequest);
    const nodes = ModuleDeliveryPlanNodeCodec.decodeNodes({
      values: nodeValues,
      legacy: false,
    });
    const edgeContracts = ModuleDeliveryPlanNodeCodec.decodeEdgeContracts(
      fields.list('edgeContracts', MAX_MODULE_DELIVERY_EDGE_CONTRACTS),
    );
    let featureBranch: string;
    try {
      featureBranch = CanonicalFeatureBranchContract.parse(
        fields.string('featureBranch'),
      );
    } catch {
      ModuleDeliveryPlanSchema.fail(
        '$.featureBranch: feature branch is not canonical.',
      );
    }
    const currentPlan: ModuleDeliveryPlanV5 = {
      version: MODULE_DELIVERY_PLAN_VERSION,
      baseBranch: fields.string('baseBranch'),
      generation,
      featureBranch,
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
      path: request.path || '$',
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
