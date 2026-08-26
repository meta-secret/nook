import { isValidTaskResourceClaim } from '../agent-workflow/domain.ts';

export type ResourcePathMatchRequest = {
  readonly claim: string;
  readonly path: string;
};

type BasenamePatternMatch = {
  readonly pattern: string;
  readonly basename: string;
};

function wildcardBasenameMatches(match: BasenamePatternMatch): boolean {
  if (match.pattern === '*') return match.basename.length > 0;
  if (!match.pattern.startsWith('*.')) return match.pattern === match.basename;
  return match.basename.endsWith(match.pattern.slice(1));
}

export function resourceClaimMatchesPath(
  request: ResourcePathMatchRequest,
): boolean {
  if (request.claim.startsWith('git:')) return false;
  if (!isValidTaskResourceClaim(request.claim)) return false;
  if (request.claim.endsWith('/**')) {
    const root = request.claim.slice(0, -3);
    return request.path === root || request.path.startsWith(`${root}/`);
  }
  if (request.claim.startsWith('**/')) {
    const pattern = request.claim.slice(3);
    const slash = request.path.lastIndexOf('/');
    const basename = request.path.slice(slash + 1);
    const match: BasenamePatternMatch = { pattern, basename };
    return wildcardBasenameMatches(match);
  }
  const lastSlash = request.claim.lastIndexOf('/');
  const basenamePattern = request.claim.slice(lastSlash + 1);
  if (basenamePattern.startsWith('*')) {
    const parent = request.claim.slice(0, lastSlash);
    const pathSlash = request.path.lastIndexOf('/');
    const pathParent = pathSlash === -1 ? '' : request.path.slice(0, pathSlash);
    const pathBasename = request.path.slice(pathSlash + 1);
    const match: BasenamePatternMatch = {
      pattern: basenamePattern,
      basename: pathBasename,
    };
    return pathParent === parent && wildcardBasenameMatches(match);
  }
  return request.path === request.claim;
}

export function validateModuleWriteClaims(claims: readonly string[]): void {
  if (claims.length === 0) {
    throw new Error(
      'Commit handoff requires at least one allowed write claim.',
    );
  }
  for (const claim of claims) {
    if (!isValidTaskResourceClaim(claim) || claim.startsWith('git:')) {
      throw new Error(`Commit handoff has an invalid write claim: ${claim}.`);
    }
  }
}
