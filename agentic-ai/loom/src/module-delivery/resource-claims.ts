import { TaskResourceClaim } from '../agent-workflow/domain.ts';

export class ModuleWriteClaim {
  private constructor(private readonly request: readonly string[]) {}

  private static wildcardBasenameMatches(match: BasenamePatternMatch): boolean {
    if (match.pattern === '*') return match.basename.length > 0;
    if (!match.pattern.startsWith('*.'))
      return match.pattern === match.basename;
    return match.basename.endsWith(match.pattern.slice(1));
  }

  static resourceClaimMatchesPath(request: ResourcePathMatchRequest): boolean {
    if (request.claim.startsWith('git:')) return false;
    if (!TaskResourceClaim.isValidTaskResourceClaim(request.claim))
      return false;
    if (request.claim.endsWith('/**')) {
      const root = request.claim.slice(0, -3);
      return request.path === root || request.path.startsWith(`${root}/`);
    }
    if (request.claim.startsWith('**/')) {
      const pattern = request.claim.slice(3);
      const slash = request.path.lastIndexOf('/');
      const basename = request.path.slice(slash + 1);
      const match: BasenamePatternMatch = { pattern, basename };
      return ModuleWriteClaim.wildcardBasenameMatches(match);
    }
    const lastSlash = request.claim.lastIndexOf('/');
    const basenamePattern = request.claim.slice(lastSlash + 1);
    if (basenamePattern.startsWith('*')) {
      const parent = request.claim.slice(0, lastSlash);
      const pathSlash = request.path.lastIndexOf('/');
      const pathParent =
        pathSlash === -1 ? '' : request.path.slice(0, pathSlash);
      const pathBasename = request.path.slice(pathSlash + 1);
      const match: BasenamePatternMatch = {
        pattern: basenamePattern,
        basename: pathBasename,
      };
      return (
        pathParent === parent && ModuleWriteClaim.wildcardBasenameMatches(match)
      );
    }
    return request.path === request.claim;
  }

  static validateModuleWriteClaims(claims: readonly string[]): void {
    return new ModuleWriteClaim(claims).execute();
  }

  private execute(): void {
    const claims = this.request;
    if (claims.length === 0) {
      throw new Error(
        'Commit handoff requires at least one allowed write claim.',
      );
    }
    for (const claim of claims) {
      if (
        !TaskResourceClaim.isValidTaskResourceClaim(claim) ||
        claim.startsWith('git:')
      ) {
        throw new Error(`Commit handoff has an invalid write claim: ${claim}.`);
      }
    }
  }
}

export type ResourcePathMatchRequest = {
  readonly claim: string;
  readonly path: string;
};

type BasenamePatternMatch = {
  readonly pattern: string;
  readonly basename: string;
};
