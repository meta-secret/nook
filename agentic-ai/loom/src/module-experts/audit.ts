import { existsSync, readFileSync, readdirSync } from 'node:fs';

import { dirname, isAbsolute, join, normalize, relative } from 'node:path';

import {
  MODULE_EXPERT_CATALOG,
  MODULE_EXPERT_RESEARCH_ROOT,
} from './catalog.ts';

import type {
  ModuleExpertGeneratedScope,
  ModuleExpertProfile,
} from './catalog.ts';

import { InternalApiConsumerScope } from './consumer-scope-audit.ts';

import type { AuditInternalApiExpertConsumerScopeArgs } from './consumer-scope-audit.ts';

import { ModuleExpertSnapshotScope } from './snapshot-scope-audit.ts';

import type { AuditModuleExpertSnapshotScopesArgs } from './snapshot-scope-audit.ts';

import {
  CargoWorkspaceInventoryKind,
  CargoWorkspaceDiscovery,
} from './cargo-workspace.ts';

import type { DiscoverCargoWorkspaceArgs } from './cargo-workspace.ts';

import { TeamAgentContract } from '../team-agents/audit.ts';

import type { AuditTeamAgentsRequest } from '../team-agents/audit.ts';

import { MarkdownContractSections } from '../lib/markdown-contract.ts';

import type {
  MarkdownContractAuditRequest,
  MarkdownContractSection,
} from '../lib/markdown-contract.ts';

export class ModuleExpertContract {
  private constructor(private readonly request: AuditModuleExpertsArgs) {}

  static auditModuleExperts(
    args: AuditModuleExpertsArgs,
  ): ModuleExpertAuditReport {
    return new ModuleExpertContract(args).execute();
  }

  private execute(): ModuleExpertAuditReport {
    const args = this.request;
    const findings: ModuleExpertAuditFinding[] = [];
    const context: ModuleExpertValidationContext = {
      findings,
      repoRoot: args.repoRoot,
    };
    ModuleExpertContract.validateProfiles(context);
    ModuleExpertContract.validateCortexRoleAuthority(context);
    const liveRoots = ModuleExpertContract.liveProductionModuleRoots(context);
    const coverageArgs: ValidateProductionCoverageArgs = {
      context,
      liveRoots,
    };
    ModuleExpertContract.validateProductionCoverage(coverageArgs);
    ModuleExpertContract.mergeTeamAgentAudit(context);
    return {
      findings,
      profileCount: MODULE_EXPERT_CATALOG.length,
      productionModuleCount: liveRoots.length,
      auditOk: findings.length === 0,
    };
  }

  private static mergeTeamAgentAudit(
    context: ModuleExpertValidationContext,
  ): void {
    const teamAuditRequest: AuditTeamAgentsRequest = {
      repoRoot: context.repoRoot,
    };
    const teamAudit = TeamAgentContract.auditTeamAgents(teamAuditRequest);
    for (const teamFinding of teamAudit.findings) {
      const finding: ModuleExpertAuditFinding = {
        code: teamFinding.code,
        path: teamFinding.path,
        message: teamFinding.message,
      };
      context.findings.push(finding);
    }
  }

  static auditGeneratedScopeProducerContract(
    args: AuditGeneratedScopeProducerContractArgs,
  ): readonly ModuleExpertAuditFinding[] {
    const findings: ModuleExpertAuditFinding[] = [];
    const context: ModuleExpertValidationContext = {
      findings,
      repoRoot: args.repoRoot,
    };
    const validationArgs: ValidateGeneratedScopeProducerArgs = {
      context,
      generatedScope: args.generatedScope,
    };
    ModuleExpertContract.validateGeneratedScopeProducer(validationArgs);
    return findings;
  }

  private static validateProfiles(
    context: ModuleExpertValidationContext,
  ): void {
    const names = new Set<string>();
    const moduleOwners = new Map<string, string>();
    for (const profile of MODULE_EXPERT_CATALOG) {
      if (
        !ModuleExpertContract.safeIdentifier(profile.name) ||
        names.has(profile.name)
      ) {
        context.findings[context.findings.length] = {
          code: 'invalid-profile-name',
          path: MODULE_EXPERT_CATALOG_PATH,
          message: `Module expert name is unsafe or duplicated: ${profile.name}`,
        };
      }
      names.add(profile.name);
      if (profile.validationSelectors.length === 0) {
        context.findings[context.findings.length] = {
          code: 'missing-validation-selector',
          path: MODULE_EXPERT_CATALOG_PATH,
          message:
            'Every module expert needs at least one focused validation selector.',
        };
      }
      const validateProfilePathsArgs: ValidateProfilePathsArgs = {
        context,
        moduleOwners,
        profile,
      };
      ModuleExpertContract.validateProfilePaths(validateProfilePathsArgs);
    }
    const snapshotScopeArgs: AuditModuleExpertSnapshotScopesArgs = {
      profiles: MODULE_EXPERT_CATALOG,
    };
    context.findings.push(
      ...ModuleExpertSnapshotScope.audit(snapshotScopeArgs),
    );
    ModuleExpertContract.validateInternalApiProfile(context);
  }

  private static validateCortexRoleAuthority(
    context: ModuleExpertValidationContext,
  ): void {
    const authorityPath = join(
      context.repoRoot,
      MODULE_EXPERT_CORTEX_AUTHORITY_PATH,
    );
    const source = existsSync(authorityPath)
      ? readFileSync(authorityPath, 'utf8')
      : '';
    const authorityAuditArgs: AuditModuleExpertCortexAuthorityArgs = { source };
    context.findings.push(
      ...ModuleExpertContract.auditModuleExpertCortexAuthority(
        authorityAuditArgs,
      ),
    );
  }

  static auditModuleExpertCortexAuthority(
    args: AuditModuleExpertCortexAuthorityArgs,
  ): readonly ModuleExpertAuditFinding[] {
    const findings: ModuleExpertAuditFinding[] = [];
    const contractAuditRequest: MarkdownContractAuditRequest = {
      sections: MODULE_EXPERT_CONTRACT_SECTIONS,
      source: args.source,
    };
    for (const drift of MarkdownContractSections.audit(contractAuditRequest)) {
      const finding: ModuleExpertAuditFinding = {
        code: 'cortex-module-expert-contract-semantic-drift',
        path: MODULE_EXPERT_CORTEX_AUTHORITY_PATH,
        message: `Canonical Cortex module expert contract drifted in ${drift.heading}: ${drift.missingMarkers.join(', ')}`,
      };
      findings.push(finding);
    }
    for (const profile of MODULE_EXPERT_CATALOG) {
      const marker = ModuleExpertContract.moduleExpertCortexMarker(profile);
      if (args.source.includes(marker)) continue;
      const finding: ModuleExpertAuditFinding = {
        code: 'missing-cortex-module-expert-role',
        path: MODULE_EXPERT_CORTEX_AUTHORITY_PATH,
        message: `Canonical Cortex module expert role is missing: ${profile.name}`,
      };
      findings.push(finding);
    }
    return findings;
  }

  private static moduleExpertCortexMarker(
    profile: ModuleExpertProfile,
  ): string {
    if (profile.name === 'internal_api_expert') {
      return '`internal_api_expert` owns inter-module contract analysis.';
    }
    if (profile.name === 'web_expert') {
      return '`web_expert` covers the initial production presentation group.';
    }
    return `### \`${profile.name}\``;
  }

  private static validateProfilePaths(args: ValidateProfilePathsArgs): void {
    const paths = [
      ...args.profile.boundaryScopePaths,
      ...args.profile.canonicalContextPaths,
      ...args.profile.allowedContextPaths,
      ...args.profile.moduleRoots,
      ...args.profile.scopePaths,
      ...args.profile.generatedScopePaths.flatMap((scope) => [
        scope.path,
        scope.producerPath,
      ]),
      ...args.profile.excludedPaths,
      ...args.profile.publicEntryPoints,
      ...args.profile.authorityPaths,
      ...args.profile.skillPaths,
    ];
    for (const candidate of paths) {
      if (!ModuleExpertContract.safeRepoPath(candidate)) {
        args.context.findings[args.context.findings.length] = {
          code: 'unsafe-catalog-path',
          path: candidate,
          message: `Module expert path must be normalized and repository-relative: ${candidate}`,
        };
      }
    }
    for (const moduleRoot of args.profile.moduleRoots) {
      const owner = args.moduleOwners.get(moduleRoot);
      if (owner) {
        args.context.findings[args.context.findings.length] = {
          code: 'duplicate-module-owner',
          path: moduleRoot,
          message: `Module is owned by both ${owner} and ${args.profile.name}.`,
        };
      }
      args.moduleOwners.set(moduleRoot, args.profile.name);
    }
    const requiredPaths = [
      ...args.profile.boundaryScopePaths,
      ...args.profile.canonicalContextPaths,
      ...args.profile.allowedContextPaths,
      ...args.profile.moduleRoots,
      ...args.profile.scopePaths,
      ...args.profile.publicEntryPoints,
      ...args.profile.authorityPaths,
      ...args.profile.skillPaths,
    ];
    for (const requiredPath of requiredPaths) {
      if (!existsSync(join(args.context.repoRoot, requiredPath))) {
        args.context.findings[args.context.findings.length] = {
          code: 'missing-catalog-path',
          path: requiredPath,
          message: `Module expert catalog path does not exist: ${requiredPath}`,
        };
      }
    }
    for (const generatedScope of args.profile.generatedScopePaths) {
      const selectors = [
        generatedScope.sealedSelector,
        generatedScope.workspaceMaterializerSelector,
        generatedScope.productionSelector,
      ];
      const validMarkers =
        generatedScope.requiredMarkers.length > 0 &&
        generatedScope.requiredMarkers.every(
          (marker) =>
            ModuleExpertContract.safeRepoPath(marker.path) &&
            !marker.path.includes('/') &&
            marker.producerEvidence.length > 0 &&
            marker.producerEvidence.every(
              ModuleExpertContract.validProducerEvidence,
            ),
        );
      if (!validMarkers) {
        args.context.findings[args.context.findings.length] = {
          code: 'invalid-generated-scope-markers',
          path: generatedScope.path,
          message:
            'Generated scopes require safe, non-empty relative output markers.',
        };
      }
      if (
        generatedScope.sealedSelector !== 'wasm:build' ||
        generatedScope.workspaceMaterializerSelector !== 'wasm:build:fast' ||
        generatedScope.productionSelector !== 'wasm:build:prod'
      ) {
        args.context.findings[args.context.findings.length] = {
          code: 'invalid-generated-scope-selectors',
          path: generatedScope.path,
          message:
            'WASM generated scopes require sealed, workspace-materializer, and production selectors.',
        };
      }
      const producerValidationArgs: ValidateGeneratedScopeProducerArgs = {
        context: args.context,
        generatedScope,
      };
      ModuleExpertContract.validateGeneratedScopeProducer(
        producerValidationArgs,
      );
    }
  }

  private static validateGeneratedScopeProducer(
    args: ValidateGeneratedScopeProducerArgs,
  ): void {
    const producerPath = join(
      args.context.repoRoot,
      args.generatedScope.producerPath,
    );
    if (!existsSync(producerPath)) {
      args.context.findings[args.context.findings.length] = {
        code: 'missing-generated-scope-producer',
        path: args.generatedScope.producerPath,
        message: `Generated scope producer does not exist: ${args.generatedScope.producerPath}`,
      };
      return;
    }
    const producer = readFileSync(producerPath, 'utf8');
    if (!producer.includes(args.generatedScope.producerContains)) {
      args.context.findings[args.context.findings.length] = {
        code: 'generated-scope-producer-drift',
        path: args.generatedScope.producerPath,
        message: `Generated scope producer no longer declares ${args.generatedScope.path}.`,
      };
    }
    const selectors = [
      args.generatedScope.sealedSelector,
      args.generatedScope.workspaceMaterializerSelector,
      args.generatedScope.productionSelector,
    ];
    for (const selector of selectors) {
      if (!producer.includes(`\n  ${selector}:`)) {
        args.context.findings[args.context.findings.length] = {
          code: 'generated-scope-selector-drift',
          path: args.generatedScope.producerPath,
          message: `Generated scope producer no longer declares ${selector}.`,
        };
      }
    }
    for (const marker of args.generatedScope.requiredMarkers) {
      if (
        marker.producerEvidence.some((evidence) => !producer.includes(evidence))
      ) {
        args.context.findings[args.context.findings.length] = {
          code: 'generated-scope-marker-producer-drift',
          path: args.generatedScope.producerPath,
          message: `Generated scope producer no longer proves output marker ${marker.path} for ${args.generatedScope.path}.`,
        };
      }
    }
  }

  private static validateInternalApiProfile(
    context: ModuleExpertValidationContext,
  ): void {
    const profile = MODULE_EXPERT_CATALOG.find(
      (candidate) => candidate.name === 'internal_api_expert',
    );
    if (!profile) {
      context.findings[context.findings.length] = {
        code: 'missing-internal-api-expert',
        path: MODULE_EXPERT_CATALOG_PATH,
        message: 'The internal_api_expert profile is required.',
      };
      return;
    }
    const consumerScopeArgs: AuditInternalApiExpertConsumerScopeArgs = {
      discoveredConsumerPaths:
        InternalApiConsumerScope.discoverInternalApiConsumerPaths(
          context.repoRoot,
        ),
      profile,
    };
    context.findings.push(
      ...InternalApiConsumerScope.auditInternalApiExpertConsumerScope(
        consumerScopeArgs,
      ),
    );
    const requiredScopes = [
      'nook-app/nook-platform/nook-companion-wasm',
      'nook-app/nook-platform/nook-wasm',
      'nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm',
      'nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm',
    ];
    const ownedScopes = new Set([
      ...profile.moduleRoots,
      ...profile.scopePaths,
      ...profile.generatedScopePaths.map((scope) => scope.path),
    ]);
    for (const requiredScope of requiredScopes) {
      if (!ownedScopes.has(requiredScope)) {
        context.findings[context.findings.length] = {
          code: 'incomplete-internal-api-scope',
          path: MODULE_EXPERT_CATALOG_PATH,
          message: `internal_api_expert must cover ${requiredScope}.`,
        };
      }
    }
    const requiredGeneratedMarkers = new Map<string, readonly string[]>([
      [
        'nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm',
        [
          '.wasm-source-sha256',
          'nook_companion_wasm.js',
          'nook_companion_wasm_bg.wasm',
        ],
      ],
      [
        'nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm',
        [
          '.wasm-source-sha256',
          'nook-wasm-build-mode',
          'nook_wasm.js',
          'nook_wasm_bg.wasm',
        ],
      ],
    ]);
    for (const [path, markers] of requiredGeneratedMarkers) {
      const generatedScope = profile.generatedScopePaths.find(
        (candidate) => candidate.path === path,
      );
      if (
        !generatedScope ||
        markers.some(
          (marker) =>
            !generatedScope.requiredMarkers.some(
              (requiredMarker) => requiredMarker.path === marker,
            ),
        )
      ) {
        context.findings[context.findings.length] = {
          code: 'incomplete-generated-scope-contract',
          path,
          message: `internal_api_expert must declare all required generated outputs for ${path}.`,
        };
      }
    }
  }

  private static validateProductionCoverage(
    args: ValidateProductionCoverageArgs,
  ): void {
    const catalogRoots = MODULE_EXPERT_CATALOG.flatMap(
      (profile) => profile.moduleRoots,
    );
    const catalogSet = new Set(catalogRoots);
    const liveSet = new Set(args.liveRoots);
    for (const liveRoot of args.liveRoots) {
      if (!catalogSet.has(liveRoot)) {
        args.context.findings[args.context.findings.length] = {
          code: 'unrouted-production-module',
          path: liveRoot,
          message: `Production module has no module expert: ${liveRoot}`,
        };
      }
    }
    for (const catalogRoot of catalogRoots) {
      if (!liveSet.has(catalogRoot)) {
        args.context.findings[args.context.findings.length] = {
          code: 'stale-module-route',
          path: catalogRoot,
          message: `Catalog route is not a live production module: ${catalogRoot}`,
        };
      }
    }
    if (catalogSet.has(MODULE_EXPERT_RESEARCH_ROOT)) {
      args.context.findings[args.context.findings.length] = {
        code: 'research-module-routed',
        path: MODULE_EXPERT_RESEARCH_ROOT,
        message:
          'nook-web-research must remain outside production expert routing.',
      };
    }
  }

  private static liveProductionModuleRoots(
    context: ModuleExpertValidationContext,
  ): readonly string[] {
    const discoveryArgs: DiscoverCargoWorkspaceArgs = {
      repoRoot: context.repoRoot,
      manifestPath: PLATFORM_MANIFEST,
    };
    const cargoInventory = CargoWorkspaceDiscovery.discover(discoveryArgs);
    const rustRoots =
      cargoInventory.kind === CargoWorkspaceInventoryKind.Complete
        ? cargoInventory.roots
        : [];
    if (cargoInventory.kind === CargoWorkspaceInventoryKind.Failed) {
      context.findings[context.findings.length] = {
        code: cargoInventory.code,
        path: PLATFORM_MANIFEST,
        message: cargoInventory.message,
      };
    }
    const webDirectory = join(context.repoRoot, WEB_ROOT);
    const directoryOptions = { withFileTypes: true } as const;
    const webRoots = readdirSync(webDirectory, directoryOptions)
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${WEB_ROOT}/${entry.name}`)
      .filter((root) =>
        existsSync(join(context.repoRoot, root, 'package.json')),
      )
      .filter((root) => root !== MODULE_EXPERT_RESEARCH_ROOT);
    return [...rustRoots, ...webRoots].sort();
  }

  private static safeIdentifier(value: string): boolean {
    return value.length <= 64 && /^[a-z][a-z0-9_]*$/u.test(value);
  }

  private static validProducerEvidence(value: string): boolean {
    return (
      value.length > 0 &&
      value.length <= 512 &&
      value.trim() === value &&
      !Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
    );
  }

  private static safeRepoPath(value: string): boolean {
    return (
      value.length > 0 &&
      value.length <= 512 &&
      !isAbsolute(value) &&
      normalize(value) === value &&
      relative('.', value) === value &&
      !value.split('/').includes('.git') &&
      !value.split('/').includes('..') &&
      dirname(value) !== '..'
    );
  }
}

export type ModuleExpertAuditFinding = {
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type ModuleExpertAuditReport = {
  readonly findings: readonly ModuleExpertAuditFinding[];
  readonly profileCount: number;
  readonly productionModuleCount: number;
  readonly auditOk: boolean;
};

export type AuditModuleExpertsArgs = {
  readonly repoRoot: string;
};

export type AuditModuleExpertCortexAuthorityArgs = {
  readonly source: string;
};

const MODULE_EXPERT_CATALOG_PATH =
  'agentic-ai/loom/src/module-experts/catalog.ts';

const MODULE_EXPERT_CORTEX_AUTHORITY_PATH =
  '.cortex/teams/ai/architecture/module-experts.md';

const PLATFORM_MANIFEST = 'nook-app/nook-platform/Cargo.toml';

const WEB_ROOT = 'nook-app/nook-web';

const MODULE_EXPERT_CONTRACT_SECTIONS: readonly MarkdownContractSection[] = [
  {
    heading: '## Engineering team routing',
    requiredMarkers: [
      'Every module expert runs inside one engineering-team ownership domain.',
      'The internal API expert may inspect an accepted provider-consumer boundary across teams. It remains read-only and cannot transfer ownership.',
      "The expert must not expand into another team's implementation scope.",
    ],
  },
  {
    heading: '## Registry contract',
    requiredMarkers: [
      'This Cortex registry is the semantic authority for role capability and context.',
      'The typed catalog is a deterministic implementation mirror.',
      'Every invocation follows the universal worker contract.',
      'Native semantic evidence, optional `ModuleExpertEvidence`, and `parentActions` remain recommendations. They do not authorize descendants, writes, integration, or lifecycle changes.',
      'Every role is read-only.',
      'Every role loads only the context named by this registry and its bounded task contract.',
      'The stable role name identifies semantic expertise. It is not a native worker label or harness configuration key.',
    ],
  },
  {
    heading: '## Production web expert',
    requiredMarkers: [
      '**Allowed product authority catalog:** The task selects only the authorities that own its assigned functionality.',
      '**Extension release authority:** When extension release security is required, the task selects only the relevant release paths from this catalog.',
      '**Security routing:** A task cannot omit `browser-extension-release-security` or its canonical security authority when an extension release boundary is in scope.',
    ],
  },
];

type ModuleExpertValidationContext = {
  readonly findings: ModuleExpertAuditFinding[];
  readonly repoRoot: string;
};

export type AuditGeneratedScopeProducerContractArgs = {
  readonly repoRoot: string;
  readonly generatedScope: ModuleExpertGeneratedScope;
};

type ValidateProfilePathsArgs = {
  readonly context: ModuleExpertValidationContext;
  readonly moduleOwners: Map<string, string>;
  readonly profile: ModuleExpertProfile;
};

type ValidateGeneratedScopeProducerArgs = {
  readonly context: ModuleExpertValidationContext;
  readonly generatedScope: ModuleExpertGeneratedScope;
};

type ValidateProductionCoverageArgs = {
  readonly context: ModuleExpertValidationContext;
  readonly liveRoots: readonly string[];
};
