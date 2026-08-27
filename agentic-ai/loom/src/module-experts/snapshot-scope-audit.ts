import {
  INTERNAL_API_EXPERT_CANONICAL_CONTEXT_PATHS,
  MODULE_EXPERT_CANONICAL_CONTEXT_PATHS,
  WEB_EXPERT_ALLOWED_CONTEXT_PATHS,
  WEB_EXPERT_AUTHORITY_PATHS,
  WEB_EXPERT_CANONICAL_CONTEXT_PATHS,
  WEB_EXPERT_SKILL_AUTHORITY_PATHS,
  WEB_EXPERT_SKILL_PATHS,
} from './catalog.ts';
import type { ModuleExpertProfile } from './catalog.ts';

const MODULE_EXPERT_CATALOG_PATH =
  'agentic-ai/loom/src/module-experts/catalog.ts';

const INTERNAL_API_EXPERT_NAME = 'internal_api_expert';
const WEB_EXPERT_NAME = 'web_expert';
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
    let expectedContext: readonly string[] =
      MODULE_EXPERT_CANONICAL_CONTEXT_PATHS;
    if (profile.name === INTERNAL_API_EXPERT_NAME) {
      expectedContext = INTERNAL_API_EXPERT_CANONICAL_CONTEXT_PATHS;
    }
    if (profile.name === WEB_EXPERT_NAME) {
      expectedContext = WEB_EXPERT_CANONICAL_CONTEXT_PATHS;
    }
    const contextComparison: OrderedSnapshotPaths = {
      actual: profile.canonicalContextPaths,
      expected: expectedContext,
    };
    const contextMatches = sameOrderedPaths(contextComparison);
    if (!contextMatches) {
      const finding: ModuleExpertSnapshotScopeFinding = {
        code: 'invalid-canonical-expert-context',
        path: MODULE_EXPERT_CATALOG_PATH,
        message:
          'Module expert snapshots require the exact transitive canonical skill and workflow context.',
      };
      findings.push(finding);
    }
    if (profile.name === WEB_EXPERT_NAME) {
      const authorityComparison: OrderedSnapshotPaths = {
        actual: profile.authorityPaths,
        expected: WEB_EXPERT_AUTHORITY_PATHS,
      };
      if (!sameOrderedPaths(authorityComparison)) {
        const finding: ModuleExpertSnapshotScopeFinding = {
          code: 'invalid-web-expert-authorities',
          path: MODULE_EXPERT_CATALOG_PATH,
          message:
            'web_expert requires the exact cataloged package and module-expert authorities.',
        };
        findings.push(finding);
      }
      const scopeComparison: OrderedSnapshotPaths = {
        actual: profile.scopePaths,
        expected: [],
      };
      if (!sameOrderedPaths(scopeComparison)) {
        const finding: ModuleExpertSnapshotScopeFinding = {
          code: 'invalid-web-expert-scope',
          path: MODULE_EXPERT_CATALOG_PATH,
          message:
            'web_expert fixed scope must not preload task-selectable context.',
        };
        findings.push(finding);
      }
      const allowedContextComparison: OrderedSnapshotPaths = {
        actual: profile.allowedContextPaths,
        expected: WEB_EXPERT_ALLOWED_CONTEXT_PATHS,
      };
      if (!sameOrderedPaths(allowedContextComparison)) {
        const finding: ModuleExpertSnapshotScopeFinding = {
          code: 'invalid-web-expert-allowed-context',
          path: MODULE_EXPERT_CATALOG_PATH,
          message:
            'web_expert requires the exact typed catalog of task-selectable context paths.',
        };
        findings.push(finding);
      }
      const skillComparison: OrderedSnapshotPaths = {
        actual: profile.skillPaths,
        expected: [WEB_EXPERT_SKILL_PATHS[0]],
      };
      if (!sameOrderedPaths(skillComparison)) {
        const finding: ModuleExpertSnapshotScopeFinding = {
          code: 'invalid-web-expert-skills',
          path: MODULE_EXPERT_CATALOG_PATH,
          message:
            'web_expert requires only the fixed module-expert skill; task-applicable web skills must remain selectable.',
        };
        findings.push(finding);
      }
      const availableAuthorities = new Set([
        ...profile.canonicalContextPaths,
        ...profile.authorityPaths,
      ]);
      if (
        contextMatches &&
        WEB_EXPERT_SKILL_AUTHORITY_PATHS.some(
          (path) => !availableAuthorities.has(path),
        )
      ) {
        const finding: ModuleExpertSnapshotScopeFinding = {
          code: 'missing-web-expert-skill-authority',
          path: MODULE_EXPERT_CATALOG_PATH,
          message:
            'web_expert snapshots must resolve every authority linked by the fixed skill bundle.',
        };
        findings.push(finding);
      }
    }
    if (
      profile.name !== INTERNAL_API_EXPERT_NAME &&
      profile.boundaryScopePaths.length > 0
    ) {
      const finding: ModuleExpertSnapshotScopeFinding = {
        code: 'unexpected-boundary-scope',
        path: MODULE_EXPERT_CATALOG_PATH,
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
      path: MODULE_EXPERT_CATALOG_PATH,
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
