import { resourceClaimMatchesPath } from './resource-claims.ts';
import { taskResourcePatternsOverlap } from '../agent-workflow/domain.ts';
import type { TaskResourcePatternPair } from '../agent-workflow/domain.ts';
import type { ResourcePathMatchRequest } from './resource-claims.ts';
import type {
  ModuleDeliveryExecutionPrecedence,
  ModuleDeliveryNodeV2,
} from './domain.ts';

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

export type ModuleDeliveryNodePair = {
  readonly first: ModuleDeliveryNodeV2;
  readonly second: ModuleDeliveryNodeV2;
};

export type OrderedModuleDeliveryNodePair = ModuleDeliveryNodePair & {
  readonly reachability: ReadonlyMap<string, ReadonlySet<string>>;
};

export type ModuleDeliveryReachabilityRequest = {
  readonly order: readonly string[];
  readonly dependencies: ReadonlyMap<string, ReadonlySet<string>>;
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

export function moduleDeliveryNodesConflict(
  pair: ModuleDeliveryNodePair,
): boolean {
  const writeWrite: ResourceClaimListPair = {
    first: pair.first.resources.write,
    second: pair.second.resources.write,
  };
  const firstWriteRead: ResourceClaimListPair = {
    first: pair.first.resources.write,
    second: pair.second.resources.read,
  };
  const secondWriteRead: ResourceClaimListPair = {
    first: pair.second.resources.write,
    second: pair.first.resources.read,
  };
  return (
    resourceClaimListsOverlap(writeWrite) ||
    resourceClaimListsOverlap(firstWriteRead) ||
    resourceClaimListsOverlap(secondWriteRead)
  );
}

export function moduleDeliveryNodesAreOrdered(
  request: OrderedModuleDeliveryNodePair,
): boolean {
  return (
    request.reachability
      .get(request.first.taskId)
      ?.has(request.second.taskId) === true ||
    request.reachability
      .get(request.second.taskId)
      ?.has(request.first.taskId) === true
  );
}

export function buildModuleDeliveryReachability(
  request: ModuleDeliveryReachabilityRequest,
): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, ReadonlySet<string>>();
  for (const taskId of request.order) {
    const dependencies = new Set<string>();
    for (const dependency of request.dependencies.get(taskId) ?? []) {
      dependencies.add(dependency);
      const ancestors = result.get(dependency);
      if (ancestors)
        for (const ancestor of ancestors) dependencies.add(ancestor);
    }
    result.set(taskId, dependencies);
  }
  return result;
}

export function moduleDeliveryPrecedenceIdentity(
  value: ModuleDeliveryExecutionPrecedence,
): string {
  return `${value.predecessorTaskId}->${value.successorTaskId}:${value.reason}`;
}

export function sortedModuleDeliveryPrecedence(
  values: readonly ModuleDeliveryExecutionPrecedence[],
): readonly ModuleDeliveryExecutionPrecedence[] {
  const byIdentity = new Map<string, ModuleDeliveryExecutionPrecedence>();
  for (const value of values)
    byIdentity.set(moduleDeliveryPrecedenceIdentity(value), value);
  return [...byIdentity.keys()].sort().map((identity) => {
    const value = byIdentity.get(identity);
    if (!value) throw new Error(`Execution constraint ${identity} is missing.`);
    return value;
  });
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
  if (request.coveredClaim.endsWith('/**')) return false;
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
