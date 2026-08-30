import { taskResourcePatternsOverlap } from '../agent-workflow/domain.ts';
import type { TaskResourcePatternPair } from '../agent-workflow/domain.ts';
import type { ModuleExpertProfile } from '../module-experts/catalog.ts';
import {
  isCortexClaim,
  isPureCortexTask,
} from './cortex-authoring-validation.ts';
import {
  ModuleDeliveryIssueCode,
  ModuleDeliveryTaskKind,
  moduleDeliveryTaskTeam,
} from './domain.ts';
import type { ModuleDeliveryNodeV2 } from './domain.ts';

export type ModuleScopeValidationRequest = {
  readonly path: string;
  readonly node: ModuleDeliveryNodeV2;
  readonly profile: ModuleExpertProfile;
};

export type ModuleScopeFinding = {
  readonly code: ModuleDeliveryIssueCode;
  readonly path: string;
  readonly message: string;
};

export function validateModuleScope(
  request: ModuleScopeValidationRequest,
): readonly ModuleScopeFinding[] {
  const findings: ModuleScopeFinding[] = [];
  const teamRequest = {
    kind: request.node.kind,
    moduleRoot: request.node.moduleRoot,
    expertContextPaths: request.profile.canonicalContextPaths,
  };
  const expectedTeam = moduleDeliveryTaskTeam(teamRequest);
  if (!isPureCortexTask(request.node) && request.node.team !== expectedTeam) {
    const finding: ModuleScopeFinding = {
      code: ModuleDeliveryIssueCode.TeamOwnershipMismatch,
      path: `${request.path}.team`,
      message: `${request.node.taskId} requires task team ${expectedTeam}.`,
    };
    findings.push(finding);
  }
  if (
    !isPureCortexTask(request.node) &&
    !request.profile.moduleRoots.includes(request.node.moduleRoot)
  ) {
    const finding: ModuleScopeFinding = {
      code: ModuleDeliveryIssueCode.ModuleOwnershipMismatch,
      path: `${request.path}.moduleRoot`,
      message: `${request.node.moduleRoot} is not a canonical module root for ${request.node.expert}.`,
    };
    findings.push(finding);
  }
  for (const claim of request.node.resources.write) {
    if (
      isCortexClaim(claim) &&
      request.node.kind === ModuleDeliveryTaskKind.Write &&
      request.node.cortexAuthoring
    )
      continue;
    if (
      claim !== request.node.moduleRoot &&
      !claim.startsWith(`${request.node.moduleRoot}/`)
    ) {
      const finding: ModuleScopeFinding = {
        code: ModuleDeliveryIssueCode.WriteScopeMismatch,
        path: `${request.path}.resources.write`,
        message: `Write ${claim} escapes canonical module root ${request.node.moduleRoot}.`,
      };
      findings.push(finding);
    }
    const generatedPaths = request.profile.generatedScopePaths.map(
      (scope) => scope.path,
    );
    const protectedPaths = [
      ...request.profile.excludedPaths,
      ...generatedPaths,
    ];
    for (const protectedPath of protectedPaths) {
      const pair: TaskResourcePatternPair = {
        first: claim,
        second: `${protectedPath}/**`,
      };
      if (taskResourcePatternsOverlap(pair)) {
        const finding: ModuleScopeFinding = {
          code: ModuleDeliveryIssueCode.WriteScopeMismatch,
          path: `${request.path}.resources.write`,
          message: `Write ${claim} overlaps expert-protected path ${protectedPath}.`,
        };
        findings.push(finding);
      }
    }
  }
  return Object.freeze(findings);
}
