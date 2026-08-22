import {
  INTERNAL_API_EXPERT_CANONICAL_CONTEXT_PATHS,
  MODULE_EXPERT_CANONICAL_CONTEXT_PATHS,
} from './catalog.ts';
import type { ModuleExpertProfile } from './catalog.ts';

const INTERNAL_API_EXPERT_NAME = 'internal_api_expert';
const RUST_MODULE_ROOT_PREFIX = 'nook-app/nook-platform/';

export type ModuleExpertSnapshotScopeFinding = {
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type AuditModuleExpertSnapshotScopesArgs = {
  readonly profiles: readonly ModuleExpertProfile[];
};

type OrderedSnapshotPaths = {
  readonly actual: readonly string[];
  readonly expected: readonly string[];
};

export function auditModuleExpertSnapshotScopes(
  args: AuditModuleExpertSnapshotScopesArgs,
): readonly ModuleExpertSnapshotScopeFinding[] {
  const findings: ModuleExpertSnapshotScopeFinding[] = [];
  const internalApiProfile = args.profiles.find(
    (profile) => profile.name === INTERNAL_API_EXPERT_NAME,
  );
  for (const profile of args.profiles) {
    const expectedContext =
      profile.name === INTERNAL_API_EXPERT_NAME
        ? INTERNAL_API_EXPERT_CANONICAL_CONTEXT_PATHS
        : MODULE_EXPERT_CANONICAL_CONTEXT_PATHS;
    const contextComparison: OrderedSnapshotPaths = {
      actual: profile.canonicalContextPaths,
      expected: expectedContext,
    };
    if (!sameOrderedPaths(contextComparison)) {
      const finding: ModuleExpertSnapshotScopeFinding = {
        code: 'invalid-canonical-expert-context',
        path: profile.agentDefinitionPath,
        message:
          'Module expert snapshots require the exact transitive canonical skill and workflow context.',
      };
      findings.push(finding);
    }
    if (
      profile.name !== INTERNAL_API_EXPERT_NAME &&
      profile.boundaryScopePaths.length > 0
    ) {
      const finding: ModuleExpertSnapshotScopeFinding = {
        code: 'unexpected-boundary-scope',
        path: profile.agentDefinitionPath,
        message:
          'Only internal_api_expert may receive cross-module Rust boundary scope.',
      };
      findings.push(finding);
    }
  }
  if (!internalApiProfile) return findings;
  const expectedRustBoundaryRoots = args.profiles
    .flatMap((profile) => profile.moduleRoots)
    .filter((root) => root.startsWith(RUST_MODULE_ROOT_PREFIX))
    .filter((root) => !internalApiProfile.moduleRoots.includes(root))
    .sort();
  const boundaryComparison: OrderedSnapshotPaths = {
    actual: internalApiProfile.boundaryScopePaths,
    expected: expectedRustBoundaryRoots,
  };
  if (!sameOrderedPaths(boundaryComparison)) {
    const finding: ModuleExpertSnapshotScopeFinding = {
      code: 'invalid-internal-api-rust-boundary-scope',
      path: internalApiProfile.agentDefinitionPath,
      message:
        'internal_api_expert requires every registered portable Rust module root in exact sorted order, and no broader scope.',
    };
    findings.push(finding);
  }
  return findings;
}

function sameOrderedPaths(paths: OrderedSnapshotPaths): boolean {
  return JSON.stringify(paths.actual) === JSON.stringify(paths.expected);
}
