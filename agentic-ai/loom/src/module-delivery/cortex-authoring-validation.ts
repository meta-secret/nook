import { isValidTaskResourceClaim } from '../agent-workflow/domain.ts';
import { TeamKey, teamCortexRoot } from '../team-agents/catalog.ts';
import {
  CORTEX_TEAM_WRITER_EXPERT,
  ModuleDeliveryIssueCode,
  ModuleDeliveryOwner,
  ModuleDeliveryTaskKind,
} from './domain.ts';
import type { ModuleDeliveryNodeV2, ModuleDeliveryPlanV2 } from './domain.ts';

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

export function validateCortexAuthoring(
  request: CortexAuthoringValidationRequest,
): readonly CortexAuthoringFinding[] {
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
  if (gizmoOwned && !isGizmoPrimeCortexTask(request.node)) {
    findings.push({
      code: ModuleDeliveryIssueCode.AcceptanceOwnershipMismatch,
      path: `${request.path}.functionalOwner`,
      message: 'Gizmo Prime may own only an exact Gizmo Cortex grant task.',
    });
  }
  if (!request.node.resources.write.some(isCortexClaim)) {
    const finding: CortexAuthoringFinding = {
      code: ModuleDeliveryIssueCode.InvalidField,
      path: `${request.path}.cortexAuthoring`,
      message: 'Cortex authoring requires at least one Cortex write.',
    };
    findings.push(finding);
  }
  for (const skillPath of selectedSkillPaths) {
    if (
      !isValidTaskResourceClaim(skillPath) ||
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
      !isValidTaskResourceClaim(sharedClaim) ||
      sharedClaim.includes('*') ||
      !explicitCortexGrant({ node: request.node, claim: sharedClaim }) ||
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
  for (const write of request.node.resources.write.filter(isCortexClaim)) {
    const authorizationRequest: CortexWriteAuthorizationRequest = {
      node: request.node,
      claim: write,
    };
    if (!cortexWriteAuthorized(authorizationRequest)) {
      const finding: CortexAuthoringFinding = {
        code: ModuleDeliveryIssueCode.ParentOwnedWrite,
        path: `${request.path}.resources.write`,
        message: `Cortex write lacks team or explicit shared-file authority: ${write}.`,
      };
      findings.push(finding);
    }
  }
  if (
    isPureCortexTask(request.node) &&
    (request.node.expert !== CORTEX_TEAM_WRITER_EXPERT ||
      request.node.moduleRoot !== teamCortexRoot(request.node.team))
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

export function isCortexClaim(claim: string): boolean {
  return claim === '.cortex' || claim.startsWith('.cortex/');
}

export function isPureCortexTask(node: ModuleDeliveryNodeV2): boolean {
  return (
    node.kind === ModuleDeliveryTaskKind.Write &&
    Boolean(node.cortexAuthoring) &&
    node.resources.write.length > 0 &&
    node.resources.write.every(isCortexClaim)
  );
}

export function isGizmoPrimeCortexTask(node: ModuleDeliveryNodeV2): boolean {
  if (
    !isPureCortexTask(node) ||
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
    node.moduleRoot === teamCortexRoot(TeamKey.Ai) &&
    sharedWriteClaims.length === node.resources.write.length &&
    node.resources.write.every(
      (claim) =>
        claim.startsWith('.cortex/gizmo/') &&
        !claim.includes('*') &&
        sharedWriteClaims.includes(claim),
    )
  );
}

export function cortexWriteAuthorized(
  request: CortexWriteAuthorizationRequest,
): boolean {
  const { node, claim } = request;
  if (node.kind !== ModuleDeliveryTaskKind.Write || !node.cortexAuthoring)
    return false;
  const teamRoot = teamCortexRoot(node.team);
  return (
    claim === teamRoot ||
    claim.startsWith(`${teamRoot}/`) ||
    (node.cortexAuthoring.sharedWriteClaims.includes(claim) &&
      explicitCortexGrant(request))
  );
}

function explicitCortexGrant(request: CortexWriteAuthorizationRequest) {
  const { node, claim } = request;
  return (
    claim.startsWith('.cortex/shared/') ||
    (claim.startsWith('.cortex/gizmo/') &&
      node.team === TeamKey.Ai &&
      node.functionalOwner === ModuleDeliveryOwner.GizmoPrime &&
      node.acceptanceOwner === ModuleDeliveryOwner.GizmoPrime)
  );
}

export function expectedParentOwnedExclusions(
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
