import { TaskResourceClaim } from '../agent-workflow/domain.ts';

import { TeamKey, TeamAuthorityCatalog } from '../team-agents/catalog.ts';

import {
  CORTEX_TEAM_WRITER_EXPERT,
  ModuleDeliveryIssueCode,
  ModuleDeliveryOwner,
  ModuleDeliveryTaskKind,
} from './domain.ts';

import type { ModuleDeliveryNodeV2, ModuleDeliveryPlanV2 } from './domain.ts';

export class CortexAuthoringPolicy {
  private constructor(
    private readonly request: CortexAuthoringValidationRequest,
  ) {}

  static validateCortexAuthoring(
    request: CortexAuthoringValidationRequest,
  ): readonly CortexAuthoringFinding[] {
    return new CortexAuthoringPolicy(request).execute();
  }

  private execute(): readonly CortexAuthoringFinding[] {
    const request = this.request;
    if (
      request.node.kind !== ModuleDeliveryTaskKind.Write ||
      !request.node.cortexAuthoring
    )
      return [];
    const findings: CortexAuthoringFinding[] = [];
    const { selectedSkillPaths, sharedWriteClaims } =
      request.node.cortexAuthoring;
    const gizmoOwned =
      request.node.functionalOwner === ModuleDeliveryOwner.GizmoPrime ||
      request.node.acceptanceOwner === ModuleDeliveryOwner.GizmoPrime;
    if (
      gizmoOwned &&
      !CortexAuthoringPolicy.isGizmoPrimeCortexTask(request.node)
    ) {
      findings.push({
        code: ModuleDeliveryIssueCode.AcceptanceOwnershipMismatch,
        path: `${request.path}.functionalOwner`,
        message: 'Gizmo Prime may own only an exact Gizmo Cortex grant task.',
      });
    }
    if (
      !request.node.resources.write.some(CortexAuthoringPolicy.isCortexClaim)
    ) {
      const finding: CortexAuthoringFinding = {
        code: ModuleDeliveryIssueCode.InvalidField,
        path: `${request.path}.cortexAuthoring`,
        message: 'Cortex authoring requires at least one Cortex write.',
      };
      findings.push(finding);
    }
    for (const skillPath of selectedSkillPaths) {
      if (
        !TaskResourceClaim.isValidTaskResourceClaim(skillPath) ||
        skillPath.includes('*') ||
        !skillPath.startsWith('.cortex/') ||
        !skillPath.includes('/dynamic-skills/') ||
        !skillPath.endsWith('.md')
      ) {
        const finding: CortexAuthoringFinding = {
          code: ModuleDeliveryIssueCode.InvalidField,
          path: `${request.path}.cortexAuthoring.selectedSkillPaths`,
          message: `Selected Cortex skill path is invalid: ${skillPath}.`,
        };
        findings.push(finding);
      }
    }
    for (const sharedClaim of sharedWriteClaims) {
      if (
        !TaskResourceClaim.isValidTaskResourceClaim(sharedClaim) ||
        sharedClaim.includes('*') ||
        !CortexAuthoringPolicy.explicitCortexGrant({
          node: request.node,
          claim: sharedClaim,
        }) ||
        !request.node.resources.write.includes(sharedClaim)
      ) {
        const finding: CortexAuthoringFinding = {
          code: ModuleDeliveryIssueCode.InvalidField,
          path: `${request.path}.cortexAuthoring.sharedWriteClaims`,
          message: `Cortex grant must be an exact assigned shared or Gizmo-owned file: ${sharedClaim}.`,
        };
        findings.push(finding);
      }
    }
    for (const write of request.node.resources.write.filter(
      CortexAuthoringPolicy.isCortexClaim,
    )) {
      const authorizationRequest: CortexWriteAuthorizationRequest = {
        node: request.node,
        claim: write,
      };
      if (!CortexAuthoringPolicy.cortexWriteAuthorized(authorizationRequest)) {
        const finding: CortexAuthoringFinding = {
          code: ModuleDeliveryIssueCode.ParentOwnedWrite,
          path: `${request.path}.resources.write`,
          message: `Cortex write lacks team or explicit shared-file authority: ${write}.`,
        };
        findings.push(finding);
      }
    }
    if (
      CortexAuthoringPolicy.isPureCortexTask(request.node) &&
      (request.node.expert !== CORTEX_TEAM_WRITER_EXPERT ||
        request.node.moduleRoot !==
          TeamAuthorityCatalog.teamCortexRoot(request.node.team))
    ) {
      const finding: CortexAuthoringFinding = {
        code: ModuleDeliveryIssueCode.ModuleOwnershipMismatch,
        path: `${request.path}.moduleRoot`,
        message:
          'A pure Cortex task must use its team root and the Cortex team writer expert.',
      };
      findings.push(finding);
    }
    return Object.freeze(findings);
  }

  static isCortexClaim(claim: string): boolean {
    return claim === '.cortex' || claim.startsWith('.cortex/');
  }

  static isPureCortexTask(node: ModuleDeliveryNodeV2): boolean {
    return (
      node.kind === ModuleDeliveryTaskKind.Write &&
      Boolean(node.cortexAuthoring) &&
      node.resources.write.length > 0 &&
      node.resources.write.every(CortexAuthoringPolicy.isCortexClaim)
    );
  }

  static isGizmoPrimeCortexTask(node: ModuleDeliveryNodeV2): boolean {
    if (
      !CortexAuthoringPolicy.isPureCortexTask(node) ||
      node.kind !== ModuleDeliveryTaskKind.Write ||
      !node.cortexAuthoring
    )
      return false;
    const { sharedWriteClaims } = node.cortexAuthoring;
    return (
      node.team === TeamKey.Ai &&
      node.functionalOwner === ModuleDeliveryOwner.GizmoPrime &&
      node.acceptanceOwner === ModuleDeliveryOwner.GizmoPrime &&
      node.expert === CORTEX_TEAM_WRITER_EXPERT &&
      node.moduleRoot === TeamAuthorityCatalog.teamCortexRoot(TeamKey.Ai) &&
      sharedWriteClaims.length === node.resources.write.length &&
      node.resources.write.every(
        (claim) =>
          claim.startsWith('.cortex/gizmo/') &&
          !claim.includes('*') &&
          CortexAuthoringPolicy.isMarkdownFileClaim(claim) &&
          sharedWriteClaims.includes(claim),
      )
    );
  }

  static cortexWriteAuthorized(
    request: CortexWriteAuthorizationRequest,
  ): boolean {
    const { node, claim } = request;
    if (node.kind !== ModuleDeliveryTaskKind.Write || !node.cortexAuthoring)
      return false;
    const teamRoot = TeamAuthorityCatalog.teamCortexRoot(node.team);
    return (
      claim === teamRoot ||
      claim.startsWith(`${teamRoot}/`) ||
      (node.cortexAuthoring.sharedWriteClaims.includes(claim) &&
        CortexAuthoringPolicy.explicitCortexGrant(request))
    );
  }

  private static explicitCortexGrant(request: CortexWriteAuthorizationRequest) {
    const { node, claim } = request;
    return (
      CortexAuthoringPolicy.isMarkdownFileClaim(claim) &&
      (claim.startsWith('.cortex/shared/') ||
        (claim.startsWith('.cortex/gizmo/') &&
          node.team === TeamKey.Ai &&
          node.functionalOwner === ModuleDeliveryOwner.GizmoPrime &&
          node.acceptanceOwner === ModuleDeliveryOwner.GizmoPrime))
    );
  }

  private static isMarkdownFileClaim(claim: string): boolean {
    return claim.endsWith('.md');
  }

  static expectedParentOwnedExclusions(
    request: ParentOwnedExclusionsRequest,
  ): readonly string[] {
    return request.plan.parentOwnedResources.filter(
      (claim) =>
        claim !== '.cortex/**' ||
        !(
          request.node.kind === ModuleDeliveryTaskKind.Write &&
          request.node.cortexAuthoring
        ),
    );
  }
}

export type CortexAuthoringFinding = {
  readonly code: ModuleDeliveryIssueCode;
  readonly path: string;
  readonly message: string;
};

export type CortexAuthoringValidationRequest = {
  readonly node: ModuleDeliveryNodeV2;
  readonly path: string;
};

export type CortexWriteAuthorizationRequest = {
  readonly node: ModuleDeliveryNodeV2;
  readonly claim: string;
};

export type ParentOwnedExclusionsRequest = {
  readonly plan: ModuleDeliveryPlanV2;
  readonly node: ModuleDeliveryNodeV2;
};
