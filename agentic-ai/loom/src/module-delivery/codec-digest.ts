import { createHash } from 'node:crypto';
import {
  ModuleDeliveryBaselineKind,
  ModuleDeliveryTaskKind,
} from './domain.ts';
import type { ModuleDeliveryPlanV5 } from './domain.ts';

type ModulePlanDigestNodeLookup = {
  readonly plan: ModuleDeliveryPlanV5;
  readonly taskId: string;
};

type ModulePlanDigestContractLookup = {
  readonly plan: ModuleDeliveryPlanV5;
  readonly key: string;
};

/** Owns canonical hashing of validated V4 module delivery plans. */
export class ModuleDeliveryPlanDigest {
  private constructor() {}

  static moduleDeliveryPlanDigest(plan: ModuleDeliveryPlanV5): string {
    const nodes = plan.nodes
      .map(({ taskId }) => taskId)
      .sort()
      .map((taskId) => {
        const lookup: ModulePlanDigestNodeLookup = { plan, taskId };
        return ModuleDeliveryPlanDigest.digestNode(lookup);
      });
    const edgeContracts = plan.edgeContracts
      .map(
        (contract) => `${contract.providerTaskId}->${contract.consumerTaskId}`,
      )
      .sort()
      .map((key) => {
        const lookup: ModulePlanDigestContractLookup = { plan, key };
        return ModuleDeliveryPlanDigest.digestContract(lookup);
      });
    const canonical = {
      ...plan,
      parentOwnedResources: [...plan.parentOwnedResources].sort(),
      parentJoin: {
        ...plan.parentJoin,
        validationCommands: plan.parentJoin.validationCommands,
      },
      nodes,
      edgeContracts,
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private static digestNode(lookup: ModulePlanDigestNodeLookup) {
    const node = lookup.plan.nodes.find(
      ({ taskId }) => taskId === lookup.taskId,
    );
    if (!node) throw new Error(`Validated task ${lookup.taskId} is missing.`);
    const expectedProducers =
      node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis
        ? node.evidenceInput.expectedProducers
            .map(({ taskId }) => taskId)
            .sort()
            .map((taskId) => {
              const producer = node.evidenceInput.expectedProducers.find(
                (candidate) => candidate.taskId === taskId,
              );
              if (!producer)
                throw new Error(`Validated producer ${taskId} is missing.`);
              return producer;
            })
        : [];
    return {
      ...node,
      baseline:
        node.baseline.kind === ModuleDeliveryBaselineKind.IntegratedDependencies
          ? {
              ...node.baseline,
              providerTaskIds: [...node.baseline.providerTaskIds].sort(),
            }
          : node.baseline,
      dependencies: [...node.dependencies].sort(),
      resources: {
        read: [...node.resources.read].sort(),
        write: [...node.resources.write].sort(),
        evidenceSurface: [...node.resources.evidenceSurface].sort(),
      },
      parentOwnedExclusions: [...node.parentOwnedExclusions].sort(),
      acceptance: {
        commands: node.acceptance.commands,
        evidence: [...node.acceptance.evidence].sort(),
      },
      ...(node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis
        ? {
            evidenceInput: { ...node.evidenceInput, expectedProducers },
          }
        : {}),
      ...(node.kind === ModuleDeliveryTaskKind.Write && node.cortexAuthoring
        ? {
            cortexAuthoring: {
              selectedSkillPaths: [
                ...node.cortexAuthoring.selectedSkillPaths,
              ].sort(),
              sharedWriteClaims: [
                ...node.cortexAuthoring.sharedWriteClaims,
              ].sort(),
            },
          }
        : {}),
    };
  }

  private static digestContract(lookup: ModulePlanDigestContractLookup) {
    const contract = lookup.plan.edgeContracts.find(
      (candidate) =>
        `${candidate.providerTaskId}->${candidate.consumerTaskId}` ===
        lookup.key,
    );
    if (!contract)
      throw new Error(`Validated edge contract ${lookup.key} is missing.`);
    return {
      ...contract,
      publicTypes: [...contract.publicTypes].sort(),
      errors: [...contract.errors].sort(),
      behaviorInvariants: [...contract.behaviorInvariants].sort(),
      securityInvariants: [...contract.securityInvariants].sort(),
      compatibilityExpectations: [...contract.compatibilityExpectations].sort(),
      owningTests: [...contract.owningTests].sort(),
    };
  }
}
