import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type { MakeDirectoryOptions, RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  type AuditGeneratedScopeProducerContractArgs,
  type AuditModuleExpertsArgs,
  ModuleExpertContract,
} from '../../src/module-experts/audit.ts';
import { InternalApiConsumerScope } from '../../src/module-experts/consumer-scope-audit.ts';
import type { AuditInternalApiExpertConsumerScopeArgs } from '../../src/module-experts/consumer-scope-audit.ts';
import {
  INTERNAL_API_EXPERT_CANONICAL_CONTEXT_PATHS,
  INTERNAL_API_EXPERT_CONSUMER_SCOPE_PATHS,
  INTERNAL_API_EXPERT_JSON_CONSUMER_SCOPE_PATHS,
  INTERNAL_API_EXPERT_RUST_BOUNDARY_SCOPE_PATHS,
  MODULE_EXPERT_CATALOG,
  MODULE_EXPERT_CANONICAL_CONTEXT_PATHS,
  type ModuleExpertGeneratedMarker,
  type ModuleExpertGeneratedScope,
  type ModuleExpertProfile,
  WEB_EXPERT_AUTHORITY_PATHS,
  WEB_EXPERT_CANONICAL_CONTEXT_PATHS,
  WEB_EXPERT_PRODUCT_SPEC_PATHS,
  WEB_EXPERT_RELEASE_AUTHORITY_PATHS,
  WEB_EXPERT_ALLOWED_CONTEXT_PATHS,
  WEB_EXPERT_SKILL_AUTHORITY_PATHS,
  WEB_EXPERT_SKILL_PATHS,
} from '../../src/module-experts/catalog.ts';
import { ModuleExpertSnapshotScope } from '../../src/module-experts/snapshot-scope-audit.ts';
import type { AuditModuleExpertSnapshotScopesArgs } from '../../src/module-experts/snapshot-scope-audit.ts';
/** Owns the module experts audit fixture registry and its capability transitions. */
export class ModuleExpertsAuditFixture {
  private constructor() {}
  static readonly REPO_ROOT = resolve(import.meta.dir, '../../../..');
  static readonly internalApiProfile: ModuleExpertProfile =
    ModuleExpertsAuditFixture.internalApiProfileValue();
  private static internalApiProfileValue(): ModuleExpertProfile {
    const profile = MODULE_EXPERT_CATALOG.find(
      (candidate) => candidate.name === 'internal_api_expert',
    );
    if (profile) return profile;
    return ModuleExpertsAuditFixture.missingInternalApiProfile();
  }
  private static missingInternalApiProfile(): never {
    throw new Error('internal_api_expert test fixture is missing.');
  }
  static readonly GENERATED_MARKER_MUTATIONS: readonly GeneratedMarkerEvidenceMutation[] =
    ModuleExpertsAuditFixture.internalApiProfile.generatedScopePaths.flatMap(
      (generatedScope) =>
        generatedScope.requiredMarkers.flatMap((marker) =>
          marker.producerEvidence.map((evidence) => ({
            generatedScope,
            marker,
            evidence,
          })),
        ),
    );

  static async moduleExpertFixture(): Promise<string> {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-module-experts-'));
    await symlink(
      join(ModuleExpertsAuditFixture.REPO_ROOT, '.cortex'),
      join(fixtureRoot, '.cortex'),
    );
    await symlink(
      join(ModuleExpertsAuditFixture.REPO_ROOT, '.agents'),
      join(fixtureRoot, '.agents'),
    );
    await symlink(
      join(ModuleExpertsAuditFixture.REPO_ROOT, 'agentic-ai'),
      join(fixtureRoot, 'agentic-ai'),
    );
    await symlink(
      join(ModuleExpertsAuditFixture.REPO_ROOT, 'nook-app'),
      join(fixtureRoot, 'nook-app'),
    );
    return fixtureRoot;
  }
}

type GeneratedMarkerEvidenceMutation = {
  readonly generatedScope: ModuleExpertGeneratedScope;
  readonly marker: ModuleExpertGeneratedMarker;
  readonly evidence: string;
};

if (!ModuleExpertsAuditFixture.internalApiProfile) {
  throw new Error('The internal API expert profile is required by this test.');
}

describe('module expert audit', () => {
  test('discovers bindings only inside production Svelte TypeScript scripts', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-svelte-scope-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    const fixtureFiles = new Map<string, string>([
      [
        'nook-app/nook-web/example/src/Included.svelte',
        '<div>$app-wasm</div>\n<script>const ignored = "$app-wasm";</script>\n<script lang="ts">import type { NookVaultManager } from "$app-wasm";</script>\n',
      ],
      [
        'nook-app/nook-web/example/src/OutsideScript.svelte',
        '<div data-binding="$app-wasm">No TypeScript import</div>\n',
      ],
      [
        'nook-app/nook-web/example/e2e/mock/src/Excluded.svelte',
        '<script lang="ts">import type { NookVaultManager } from "$app-wasm";</script>\n',
      ],
      [
        'nook-app/nook-web/nook-web-research/src/Excluded.svelte',
        '<script lang="ts">import type { NookVaultManager } from "$app-wasm";</script>\n',
      ],
      [
        'nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm/Excluded.svelte',
        '<script lang="ts">const generated = "nook-companion-wasm/nook_companion_wasm";</script>\n',
      ],
    ]);
    const directoryOptions: MakeDirectoryOptions = { recursive: true };
    try {
      for (const [path, source] of fixtureFiles) {
        const absolutePath = join(fixtureRoot, path);
        await mkdir(dirname(absolutePath), directoryOptions);
        await writeFile(absolutePath, source, 'utf8');
      }

      expect(
        InternalApiConsumerScope.discoverInternalApiConsumerPaths(fixtureRoot),
      ).toEqual(['nook-app/nook-web/example/src/Included.svelte']);
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('accepts the complete read-only project catalog', () => {
    const auditArgs: AuditModuleExpertsArgs = {
      repoRoot: ModuleExpertsAuditFixture.REPO_ROOT,
    };
    const report = ModuleExpertContract.auditModuleExperts(auditArgs);

    expect(report.findings).toEqual([]);
    expect(report.profileCount).toBe(9);
    expect(report.productionModuleCount).toBe(15);
    expect(report.auditOk).toBe(true);
  });

  test('requires exact canonical context, web skills, and Rust boundary scope', () => {
    expect(MODULE_EXPERT_CANONICAL_CONTEXT_PATHS).toEqual([
      '.cortex/teams/dev-core/AGENTS.md',
      '.cortex/teams/dev-core/knowledge-graph.md',
      '.cortex/teams/ai/dynamic-skills/module-expert.md',
      '.cortex/gizmo-prime/workflows/module-oriented-development.md',
    ]);
    expect(INTERNAL_API_EXPERT_CANONICAL_CONTEXT_PATHS).toEqual([
      '.cortex/teams/ai/AGENTS.md',
      '.cortex/teams/ai/knowledge-graph.md',
      '.cortex/teams/ai/dynamic-skills/internal-api-expert.md',
      '.cortex/teams/ai/dynamic-skills/module-expert.md',
      '.cortex/gizmo-prime/workflows/module-oriented-development.md',
    ]);
    expect(WEB_EXPERT_CANONICAL_CONTEXT_PATHS).toEqual([
      '.cortex/teams/web-dev/AGENTS.md',
      '.cortex/teams/web-dev/knowledge-graph.md',
      '.cortex/teams/ai/dynamic-skills/module-expert.md',
      '.cortex/gizmo-prime/workflows/module-oriented-development.md',
    ]);
    expect(WEB_EXPERT_SKILL_PATHS).toEqual([
      '.cortex/teams/ai/dynamic-skills/module-expert.md',
      '.cortex/teams/web-dev/dynamic-skills/ui-design-skills.md',
      '.cortex/teams/security/dynamic-skills/browser-extension-release-security.md',
    ]);
    expect(WEB_EXPERT_SKILL_AUTHORITY_PATHS).toEqual([
      '.cortex/teams/web-dev/AGENTS.md',
      '.cortex/teams/ai/architecture/module-experts.md',
      '.cortex/teams/ai/dynamic-skills/module-expert.md',
      '.cortex/gizmo-prime/workflows/module-oriented-development.md',
    ]);
    expect(WEB_EXPERT_AUTHORITY_PATHS).toEqual([
      '.cortex/shared/architecture/packages.md',
      '.cortex/teams/ai/architecture/module-experts.md',
    ]);
    expect(WEB_EXPERT_PRODUCT_SPEC_PATHS).toEqual([
      '.cortex/teams/dev-core/product-specs/authenticator-items.md',
      '.cortex/teams/web-dev/product-specs/browser-extension.md',
      '.cortex/teams/dev-core/product-specs/credit-card-items.md',
      '.cortex/teams/dev-core/product-specs/decentralized-auth.md',
      '.cortex/teams/dev-core/product-specs/devices-and-access.md',
      '.cortex/teams/dev-core/product-specs/file-attachments.md',
      '.cortex/teams/dev-core/product-specs/password-envelope.md',
      '.cortex/teams/dev-core/product-specs/password-manager.md',
      '.cortex/teams/dev-core/product-specs/secure-notes.md',
      '.cortex/teams/dev-core/product-specs/slip39-recovery.md',
      '.cortex/teams/web-dev/product-specs/vault-app-isolation.md',
    ]);
    expect(WEB_EXPERT_RELEASE_AUTHORITY_PATHS).toEqual([
      '.github/scripts/ci-release-verify-extension.sh',
      '.github/workflows/ci.yml',
      '.github/workflows/main.yml',
      '.github/workflows/pr.yml',
      '.github/workflows/release.yml',
      '.task/ci-workflows.yml',
      'Taskfile.yml',
      'nook-app/ci/Taskfile.yml',
    ]);
    expect(WEB_EXPERT_ALLOWED_CONTEXT_PATHS).toEqual([
      ...WEB_EXPERT_PRODUCT_SPEC_PATHS,
      ...WEB_EXPERT_RELEASE_AUTHORITY_PATHS,
      '.cortex/teams/web-dev/dynamic-skills/ui-design-skills.md',
      '.cortex/teams/security/dynamic-skills/browser-extension-release-security.md',
    ]);
    expect(INTERNAL_API_EXPERT_RUST_BOUNDARY_SCOPE_PATHS).toEqual([
      'nook-app/nook-platform/nook-app-common',
      'nook-app/nook-platform/nook-auth2',
      'nook-app/nook-platform/nook-authenticator-domain',
      'nook-app/nook-platform/nook-companion-core',
      'nook-app/nook-platform/nook-core',
      'nook-app/nook-platform/nook-event-log',
      'nook-app/nook-platform/nook-replication',
    ]);
    const acceptedArgs: AuditModuleExpertSnapshotScopesArgs = {
      profiles: MODULE_EXPERT_CATALOG,
    };
    expect(ModuleExpertSnapshotScope.audit(acceptedArgs)).toEqual([]);

    const coreProfile = MODULE_EXPERT_CATALOG.find(
      (profile) => profile.name === 'core_expert',
    );
    if (!coreProfile) throw new Error('core_expert test fixture is missing.');
    const webProfile = MODULE_EXPERT_CATALOG.find(
      (profile) => profile.name === 'web_expert',
    );
    if (!webProfile) throw new Error('web_expert test fixture is missing.');
    const driftedProfiles: readonly ModuleExpertProfile[] = [
      {
        ...ModuleExpertsAuditFixture.internalApiProfile,
        canonicalContextPaths:
          ModuleExpertsAuditFixture.internalApiProfile.canonicalContextPaths.slice(
            1,
          ),
      },
      {
        ...ModuleExpertsAuditFixture.internalApiProfile,
        boundaryScopePaths:
          ModuleExpertsAuditFixture.internalApiProfile.boundaryScopePaths.slice(
            1,
          ),
      },
      {
        ...ModuleExpertsAuditFixture.internalApiProfile,
        boundaryScopePaths: [
          ...ModuleExpertsAuditFixture.internalApiProfile.boundaryScopePaths,
          'nook-app/nook-web',
        ],
      },
      {
        ...ModuleExpertsAuditFixture.internalApiProfile,
        boundaryScopePaths: [
          ...ModuleExpertsAuditFixture.internalApiProfile.boundaryScopePaths,
        ].reverse(),
      },
      {
        ...coreProfile,
        boundaryScopePaths: ['nook-app/nook-platform/nook-auth2'],
      },
      {
        ...webProfile,
        canonicalContextPaths: webProfile.canonicalContextPaths.slice(1),
      },
      {
        ...webProfile,
        allowedContextPaths: webProfile.allowedContextPaths.slice(1),
      },
      {
        ...webProfile,
        allowedContextPaths: [
          ...webProfile.allowedContextPaths,
          WEB_EXPERT_ALLOWED_CONTEXT_PATHS[0],
        ],
      },
      {
        ...webProfile,
        allowedContextPaths: [...webProfile.allowedContextPaths].reverse(),
      },
      {
        ...webProfile,
        scopePaths: ['.github'],
      },
      {
        ...webProfile,
        authorityPaths: webProfile.authorityPaths.slice(0, 1),
      },
      {
        ...webProfile,
        authorityPaths: [...webProfile.authorityPaths, '.github'],
      },
      {
        ...webProfile,
        skillPaths: webProfile.skillPaths.slice(1),
      },
      {
        ...webProfile,
        skillPaths: [
          ...webProfile.skillPaths,
          '.agents/skills/coding-bro/SKILL.md',
        ],
      },
    ];
    const expectedCodes = [
      'invalid-canonical-expert-context',
      'invalid-internal-api-rust-boundary-scope',
      'invalid-internal-api-rust-boundary-scope',
      'invalid-internal-api-rust-boundary-scope',
      'unexpected-boundary-scope',
      'invalid-canonical-expert-context',
      'invalid-web-expert-allowed-context',
      'invalid-web-expert-allowed-context',
      'invalid-web-expert-allowed-context',
      'invalid-web-expert-scope',
      'missing-web-expert-skill-authority',
      'invalid-web-expert-authorities',
      'invalid-web-expert-skills',
      'invalid-web-expert-skills',
    ];
    for (const [index, driftedProfile] of driftedProfiles.entries()) {
      const expectedCode = expectedCodes[index];
      if (!expectedCode) {
        throw new Error('Snapshot scope drift fixture is incomplete.');
      }
      const profiles = MODULE_EXPERT_CATALOG.map((profile) =>
        profile.name === driftedProfile.name ? driftedProfile : profile,
      );
      const auditArgs: AuditModuleExpertSnapshotScopesArgs = { profiles };
      expect(
        ModuleExpertSnapshotScope.audit(auditArgs).map(
          (finding) => finding.code,
        ),
      ).toContain(expectedCode);
    }
  });

  test('rejects missing, broad, generated, or reordered internal API binding scope', () => {
    const discoveredConsumerPaths =
      InternalApiConsumerScope.discoverInternalApiConsumerPaths(
        ModuleExpertsAuditFixture.REPO_ROOT,
      );
    expect(discoveredConsumerPaths).toEqual(
      INTERNAL_API_EXPERT_CONSUMER_SCOPE_PATHS,
    );
    expect(discoveredConsumerPaths).toContain(
      'nook-app/nook-web/nook-web-shared/src/vault-app/lib/auth/provider-types.ts',
    );
    expect(discoveredConsumerPaths).toContain(
      'nook-app/nook-web/nook-web-shared/src/extension/extension-connect-scope.ts',
    );
    const contextualAuthenticationConsumers = [
      'nook-app/nook-web/nook-web-extension/src/background/service-worker/account-pickers.ts',
      'nook-app/nook-web/nook-web-extension/src/background/service-worker/authentication-workflow-routing.ts',
      'nook-app/nook-web/nook-web-extension/src/background/service-worker/pairing-identity.ts',
      'nook-app/nook-web/nook-web-extension/src/background/service-worker/website-login-options-wire-adapter.ts',
      'nook-app/nook-web/nook-web-extension/src/content/autofill/state.ts',
      'nook-app/nook-web/nook-web-shared/src/extension/password-form-classified-observations.ts',
      'nook-app/nook-web/nook-web-shared/src/extension/password-form-passkey-only-workflows.ts',
      'nook-app/nook-web/nook-web-shared/src/extension/password-form-submission-controls.ts',
    ] as const;
    for (const consumerPath of contextualAuthenticationConsumers) {
      expect(discoveredConsumerPaths).toContain(consumerPath);
    }
    expect(
      discoveredConsumerPaths.filter((path) => path.endsWith('.svelte')),
    ).toHaveLength(42);
    expect(discoveredConsumerPaths).toContain(
      'nook-app/nook-web/nook-web-shared/src/vault-app/App.svelte',
    );
    const bindingConfigurationPaths = [
      ...INTERNAL_API_EXPERT_JSON_CONSUMER_SCOPE_PATHS,
      'nook-app/nook-web/nook-vault-sentinel/vite.config.ts',
      'nook-app/nook-web/nook-vault-simple/vite.config.ts',
      'nook-app/nook-web/nook-web-app/scripts/verify-app-isolation.ts',
      'nook-app/nook-web/nook-web-app/vite.config.ts',
      'nook-app/nook-web/nook-web-shared/vite-config.ts',
    ] as const;
    for (const configurationPath of bindingConfigurationPaths) {
      expect(discoveredConsumerPaths).toContain(configurationPath);
    }
    expect(discoveredConsumerPaths).not.toContain(
      'nook-app/nook-web/nook-web-app/tests/unit/setup-wasm.ts',
    );
    expect(discoveredConsumerPaths).not.toContain(
      'nook-app/nook-web/nook-web-app/e2e/connect.spec.ts',
    );
    const missingScopeProfiles = INTERNAL_API_EXPERT_CONSUMER_SCOPE_PATHS.map(
      (omittedPath): ModuleExpertProfile => ({
        ...ModuleExpertsAuditFixture.internalApiProfile,
        scopePaths:
          ModuleExpertsAuditFixture.internalApiProfile.scopePaths.filter(
            (scopePath) => scopePath !== omittedPath,
          ),
      }),
    );
    const [defaulted1 = ''] = [
      ModuleExpertsAuditFixture.internalApiProfile.generatedScopePaths[0]?.path,
    ];
    const driftedProfiles: readonly ModuleExpertProfile[] = [
      ...missingScopeProfiles,
      {
        ...ModuleExpertsAuditFixture.internalApiProfile,
        scopePaths: [
          ...ModuleExpertsAuditFixture.internalApiProfile.scopePaths,
          'nook-app/nook-web',
        ],
      },
      {
        ...ModuleExpertsAuditFixture.internalApiProfile,
        scopePaths: [
          ...ModuleExpertsAuditFixture.internalApiProfile.scopePaths,
          defaulted1,
        ],
      },
      {
        ...ModuleExpertsAuditFixture.internalApiProfile,
        scopePaths: [
          ...ModuleExpertsAuditFixture.internalApiProfile.scopePaths,
        ].reverse(),
      },
    ];

    const catalogAuditArgs: AuditInternalApiExpertConsumerScopeArgs = {
      discoveredConsumerPaths,
      profile: ModuleExpertsAuditFixture.internalApiProfile,
    };
    expect(
      InternalApiConsumerScope.auditInternalApiExpertConsumerScope(
        catalogAuditArgs,
      ),
    ).toEqual([]);
    for (const profile of driftedProfiles) {
      const auditArgs: AuditInternalApiExpertConsumerScopeArgs = {
        discoveredConsumerPaths,
        profile,
      };
      expect(
        InternalApiConsumerScope.auditInternalApiExpertConsumerScope(
          auditArgs,
        ).map((finding) => finding.code),
      ).toEqual(['invalid-internal-api-consumer-scope']);
    }
    const discoveredDrifts: readonly (readonly string[])[] = [
      [
        ...discoveredConsumerPaths,
        'nook-app/nook-web/nook-web-shared/src/new-direct-consumer.ts',
      ],
      discoveredConsumerPaths.slice(1),
    ];
    for (const driftedDiscovery of discoveredDrifts) {
      const auditArgs: AuditInternalApiExpertConsumerScopeArgs = {
        discoveredConsumerPaths: driftedDiscovery,
        profile: ModuleExpertsAuditFixture.internalApiProfile,
      };
      expect(
        InternalApiConsumerScope.auditInternalApiExpertConsumerScope(auditArgs),
      ).toHaveLength(1);
    }
  });

  test('ignores vendor profile TOMLs when auditing canonical expert roles', async () => {
    const fixtureRoot = await ModuleExpertsAuditFixture.moduleExpertFixture();
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const vendorProfileDirectory = join(
        fixtureRoot,
        '.codex/agents/module-experts',
      );
      const directoryOptions: MakeDirectoryOptions = { recursive: true };
      await mkdir(vendorProfileDirectory, directoryOptions);
      await writeFile(
        join(vendorProfileDirectory, 'core_expert.toml'),
        'name = "core_expert"\nsandbox_mode = "workspace-write"\napproval_policy = "on-request"\n',
        'utf8',
      );
      const auditArgs: AuditModuleExpertsArgs = { repoRoot: fixtureRoot };
      const reportWithVendorProfile =
        ModuleExpertContract.auditModuleExperts(auditArgs);
      await rm(join(fixtureRoot, '.codex'), removeOptions);
      const reportWithoutVendorProfiles =
        ModuleExpertContract.auditModuleExperts(auditArgs);

      expect(reportWithVendorProfile).toEqual(reportWithoutVendorProfiles);
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('rejects semantic drift in the Cortex module expert contract', async () => {
    const authorityPath = join(
      ModuleExpertsAuditFixture.REPO_ROOT,
      '.cortex/teams/ai/architecture/module-experts.md',
    );
    const source = await readFile(authorityPath, 'utf8');
    const driftedSource = source.replace(
      'Every role is read-only.',
      'Every role may write when useful.',
    );
    const authorityArgs = { source: driftedSource };

    expect(
      ModuleExpertContract.auditModuleExpertCortexAuthority(authorityArgs).map(
        (finding) => finding.code,
      ),
    ).toContain('cortex-module-expert-contract-semantic-drift');
  });

  for (const mutation of ModuleExpertsAuditFixture.GENERATED_MARKER_MUTATIONS) {
    test(`rejects producer drift for ${mutation.marker.path} in ${mutation.generatedScope.path}`, async () => {
      const fixtureRoot = await mkdtemp(
        join(tmpdir(), 'loom-generated-scope-'),
      );
      const removeOptions: RmOptions = { recursive: true, force: true };
      try {
        const sourceProducerPath = join(
          ModuleExpertsAuditFixture.REPO_ROOT,
          mutation.generatedScope.producerPath,
        );
        const fixtureProducerPath = join(
          fixtureRoot,
          mutation.generatedScope.producerPath,
        );
        const directoryOptions: MakeDirectoryOptions = { recursive: true };
        await mkdir(dirname(fixtureProducerPath), directoryOptions);
        const producerSource = await readFile(sourceProducerPath, 'utf8');
        expect(producerSource.includes(mutation.evidence)).toBe(true);
        const driftedProducerSource = producerSource.replace(
          mutation.evidence,
          `drifted-${mutation.marker.path}`,
        );
        await writeFile(fixtureProducerPath, driftedProducerSource, 'utf8');
        const auditArgs: AuditGeneratedScopeProducerContractArgs = {
          repoRoot: fixtureRoot,
          generatedScope: mutation.generatedScope,
        };
        const findings =
          ModuleExpertContract.auditGeneratedScopeProducerContract(auditArgs);
        const markerFinding = findings.find(
          (finding) =>
            finding.code === 'generated-scope-marker-producer-drift' &&
            finding.message.includes(mutation.marker.path),
        );

        expect(markerFinding?.message).toContain(mutation.marker.path);
      } finally {
        await rm(fixtureRoot, removeOptions);
      }
    });
  }
});
