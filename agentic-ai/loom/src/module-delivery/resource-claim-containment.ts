import { resourceClaimMatchesPath } from './resource-claims.ts';
import { taskResourcePatternsOverlap } from '../agent-workflow/domain.ts';
import type { TaskResourcePatternPair } from '../agent-workflow/domain.ts';
import type { ResourcePathMatchRequest } from './resource-claims.ts';

type ResourceClaimContainmentRequest = {
  readonly coveringClaim: string;
  readonly coveredClaim: string;
};

export type EvidenceCoverageRequest = {
  readonly read: readonly string[];
  readonly evidenceSurface: readonly string[];
};

export type ResourceClaimListPair = {
  readonly first: readonly string[];
  readonly second: readonly string[];
};

export function resourceClaimListsOverlap(
  request: ResourceClaimListPair,
): boolean {
  return request.first.some((first) =>
    request.second.some((second) => {
      const pair: TaskResourcePatternPair = { first, second };
      return taskResourcePatternsOverlap(pair);
    }),
  );
}

type BasenameContainmentRequest = {
  readonly coveringBasename: string;
  readonly coveredBasename: string;
};

export function uncoveredEvidenceClaims(
  request: EvidenceCoverageRequest,
): readonly string[] {
  return request.evidenceSurface.filter((evidenceClaim) => {
    if (evidenceClaim.startsWith('git:')) return true;
    return !request.read.some((readClaim) => {
      const containmentRequest: ResourceClaimContainmentRequest = {
        coveringClaim: readClaim,
        coveredClaim: evidenceClaim,
      };
      return resourceClaimContainsClaim(containmentRequest);
    });
  });
}

function resourceClaimContainsClaim(
  request: ResourceClaimContainmentRequest,
): boolean {
  if (request.coveringClaim.startsWith('git:')) return false;
  if (request.coveringClaim === request.coveredClaim) return true;
  if (request.coveredClaim.startsWith('git:')) return false;
  if (!request.coveredClaim.includes('*')) {
    const matchRequest: ResourcePathMatchRequest = {
      claim: request.coveringClaim,
      path: request.coveredClaim,
    };
    return resourceClaimMatchesPath(matchRequest);
  }
  if (request.coveringClaim.endsWith('/**')) {
    if (request.coveredClaim.startsWith('**/')) return false;
    const coveringRoot = request.coveringClaim.slice(0, -3);
    const coveredRoot = request.coveredClaim.endsWith('/**')
      ? request.coveredClaim.slice(0, -3)
      : request.coveredClaim.slice(0, request.coveredClaim.lastIndexOf('/'));
    return (
      coveredRoot === coveringRoot || coveredRoot.startsWith(`${coveringRoot}/`)
    );
  }
  if (request.coveringClaim.startsWith('**/')) {
    const coveringBasename = request.coveringClaim.slice(3);
    const coveredBasename = request.coveredClaim.slice(
      request.coveredClaim.lastIndexOf('/') + 1,
    );
    const basenameRequest: BasenameContainmentRequest = {
      coveringBasename,
      coveredBasename,
    };
    return basenamePatternContains(basenameRequest);
  }
  const coveringSlash = request.coveringClaim.lastIndexOf('/');
  const coveredSlash = request.coveredClaim.lastIndexOf('/');
  if (
    coveringSlash === -1 ||
    coveredSlash === -1 ||
    request.coveringClaim.slice(0, coveringSlash) !==
      request.coveredClaim.slice(0, coveredSlash)
  )
    return false;
  const basenameRequest: BasenameContainmentRequest = {
    coveringBasename: request.coveringClaim.slice(coveringSlash + 1),
    coveredBasename: request.coveredClaim.slice(coveredSlash + 1),
  };
  return basenamePatternContains(basenameRequest);
}

function basenamePatternContains(request: BasenameContainmentRequest): boolean {
  if (request.coveringBasename === '*') return true;
  if (!request.coveredBasename.startsWith('*')) {
    if (!request.coveringBasename.startsWith('*.')) {
      return request.coveringBasename === request.coveredBasename;
    }
    return request.coveredBasename.endsWith(request.coveringBasename.slice(1));
  }
  return request.coveringBasename === request.coveredBasename;
}
