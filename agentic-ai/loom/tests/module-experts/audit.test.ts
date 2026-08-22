import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type { MakeDirectoryOptions, RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { CodexOptions } from '@openai/codex-sdk';
import { describe, expect, test } from 'bun:test';
import {
  auditGeneratedScopeProducerContract,
  auditModuleExpertRuntimePolicy,
  auditModuleExpertRuntimeRouting,
  auditModuleExperts,
} from '../../src/module-experts/audit.ts';
import type {
  AuditGeneratedScopeProducerContractArgs,
  AuditModuleExpertRuntimePolicyArgs,
  AuditModuleExpertRuntimeRoutingArgs,
  AuditModuleExpertsArgs,
} from '../../src/module-experts/audit.ts';
import {
  auditInternalApiExpertConsumerScope,
  discoverInternalApiConsumerPaths,
} from '../../src/module-experts/consumer-scope-audit.ts';
import type { AuditInternalApiExpertConsumerScopeArgs } from '../../src/module-experts/consumer-scope-audit.ts';
import {
  INTERNAL_API_EXPERT_CANONICAL_CONTEXT_PATHS,
  INTERNAL_API_EXPERT_CONSUMER_SCOPE_PATHS,
  INTERNAL_API_EXPERT_RUST_BOUNDARY_SCOPE_PATHS,
  MODULE_EXPERT_CATALOG,
  MODULE_EXPERT_CANONICAL_CONTEXT_PATHS,
} from '../../src/module-experts/catalog.ts';
import type {
  ModuleExpertGeneratedMarker,
  ModuleExpertGeneratedScope,
  ModuleExpertProfile,
} from '../../src/module-experts/catalog.ts';
import { auditModuleExpertSnapshotScopes } from '../../src/module-experts/snapshot-scope-audit.ts';
import type { AuditModuleExpertSnapshotScopesArgs } from '../../src/module-experts/snapshot-scope-audit.ts';
import {
  MODULE_EXPERT_AUTH_ENVIRONMENT_KEYS,
  MODULE_EXPERT_AUTH_BROKER_CLIENT_SOURCE,
  MODULE_EXPERT_AUTH_PROVIDER,
  MODULE_EXPERT_CODEX_OPTIONS,
  MODULE_EXPERT_CONTEXT_MCP,
  MODULE_EXPERT_PROCESS_ENVIRONMENT_KEYS,
  buildModuleExpertCodexOptions,
  moduleExpertIsolatedThreadOptions,
} from '../../src/module-experts/runtime-contract.ts';
import type { ModuleExpertCodexOptionsRequest } from '../../src/module-experts/runtime-contract.ts';
import {
  CargoWorkspaceInventoryKind,
  decodeCargoWorkspaceMetadata,
} from '../../src/module-experts/cargo-workspace.ts';
import type {
  CargoWorkspaceInventory,
  DecodeCargoWorkspaceMetadataArgs,
} from '../../src/module-experts/cargo-workspace.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

type GeneratedMarkerEvidenceMutation = {
  readonly generatedScope: ModuleExpertGeneratedScope;
  readonly marker: ModuleExpertGeneratedMarker;
  readonly evidence: string;
};

type ModuleExpertRuntimePolicyDrift = {
  readonly description: string;
  readonly codexOptions: CodexOptions;
};

const SAFE_CODEX_OPTIONS_REQUEST: ModuleExpertCodexOptionsRequest = {
  authenticationCommandArgs: [
    '-e',
    MODULE_EXPERT_AUTH_BROKER_CLIENT_SOURCE,
    '--',
    '/isolated/authentication.sock',
    'test-nonce',
  ],
  contextServerUrl: 'http://127.0.0.1:1/test-context',
  processEnvironment: {
    CODEX_HOME: '/isolated/codex-home',
    PATH: '/usr/bin',
  },
};
const SAFE_CODEX_OPTIONS = buildModuleExpertCodexOptions(
  SAFE_CODEX_OPTIONS_REQUEST,
);

const internalApiProfile = MODULE_EXPERT_CATALOG.find(
  (profile) => profile.name === 'internal_api_expert',
);
if (!internalApiProfile) {
  throw new Error('The internal API expert profile is required by this test.');
}
const GENERATED_MARKER_MUTATIONS: readonly GeneratedMarkerEvidenceMutation[] =
  internalApiProfile.generatedScopePaths.flatMap((generatedScope) =>
    generatedScope.requiredMarkers.flatMap((marker) =>
      marker.producerEvidence.map((evidence) => ({
        generatedScope,
        marker,
        evidence,
      })),
    ),
  );
const RUNTIME_POLICY_DRIFTS: readonly ModuleExpertRuntimePolicyDrift[] = [
  {
    description: 'non-file authentication storage',
    codexOptions: {
      config: {
        ...SAFE_CODEX_OPTIONS.config,
        cli_auth_credentials_store: 'auto',
      },
    },
  },
  {
    description: 'login-shell enablement',
    codexOptions: {
      config: {
        ...SAFE_CODEX_OPTIONS.config,
        allow_login_shell: true,
      },
    },
  },
  {
    description: 'inherited shell environment',
    codexOptions: {
      config: {
        ...SAFE_CODEX_OPTIONS.config,
        shell_environment_policy: {
          ...SAFE_CODEX_OPTIONS.config.shell_environment_policy,
          inherit: 'all',
        },
      },
    },
  },
  {
    description: 'ignored default shell exclusions',
    codexOptions: {
      config: {
        ...SAFE_CODEX_OPTIONS.config,
        shell_environment_policy: {
          ...SAFE_CODEX_OPTIONS.config.shell_environment_policy,
          ignore_default_excludes: true,
        },
      },
    },
  },
  {
    description: 'skill MCP dependency installation',
    codexOptions: {
      config: {
        ...SAFE_CODEX_OPTIONS.config,
        features: {
          ...SAFE_CODEX_OPTIONS.config.features,
          skill_mcp_dependency_install: true,
        },
      },
    },
  },
  {
    description: 'model-controlled process tool',
    codexOptions: {
      config: {
        ...SAFE_CODEX_OPTIONS.config,
        features: {
          ...SAFE_CODEX_OPTIONS.config.features,
          shell_tool: true,
        },
      },
    },
  },
  {
    description: 'image reader enablement',
    codexOptions: {
      config: {
        ...SAFE_CODEX_OPTIONS.config,
        features: {
          ...SAFE_CODEX_OPTIONS.config.features,
          view_image: true,
        },
      },
    },
  },
  {
    description: 'untrusted authentication helper',
    codexOptions: {
      config: {
        ...SAFE_CODEX_OPTIONS.config,
        model_providers: {
          [MODULE_EXPERT_AUTH_PROVIDER]: {
            ...SAFE_CODEX_OPTIONS.config.model_providers[
              MODULE_EXPERT_AUTH_PROVIDER
            ],
            auth: {
              ...SAFE_CODEX_OPTIONS.config.model_providers[
                MODULE_EXPERT_AUTH_PROVIDER
              ].auth,
              command: '/bin/sh',
            },
          },
        },
      },
    },
  },
  {
    description: 'mutated authentication helper source',
    codexOptions: {
      config: {
        ...SAFE_CODEX_OPTIONS.config,
        model_providers: {
          [MODULE_EXPERT_AUTH_PROVIDER]: {
            ...SAFE_CODEX_OPTIONS.config.model_providers[
              MODULE_EXPERT_AUTH_PROVIDER
            ],
            auth: {
              ...SAFE_CODEX_OPTIONS.config.model_providers[
                MODULE_EXPERT_AUTH_PROVIDER
              ].auth,
              args: [
                '-e',
                'console.log("untrusted")',
                '--',
                '/tmp/socket',
                'nonce',
              ],
            },
          },
        },
      },
    },
  },
  {
    description: 'additional MCP server',
    codexOptions: {
      config: {
        ...SAFE_CODEX_OPTIONS.config,
        mcp_servers: {
          ...SAFE_CODEX_OPTIONS.config.mcp_servers,
          untrusted_context: {
            command: '/bin/sh',
          },
        },
      },
    },
  },
  {
    description: 'expanded repository tool allowlist',
    codexOptions: {
      config: {
        ...SAFE_CODEX_OPTIONS.config,
        mcp_servers: {
          [MODULE_EXPERT_CONTEXT_MCP]: {
            ...SAFE_CODEX_OPTIONS.config.mcp_servers[MODULE_EXPERT_CONTEXT_MCP],
            enabled_tools: [
              'list_files',
              'read_file',
              'search_text',
              'write_file',
            ],
          },
        },
      },
    },
  },
  {
    description: 'missing authentication provider',
    codexOptions: {
      config: {
        ...SAFE_CODEX_OPTIONS.config,
        model_providers: {},
      },
    },
  },
  {
    description: 'missing context server',
    codexOptions: {
      config: {
        ...SAFE_CODEX_OPTIONS.config,
        mcp_servers: {},
      },
    },
  },
];

describe('module expert audit', () => {
  test('accepts the complete read-only project catalog', () => {
    const auditArgs: AuditModuleExpertsArgs = { repoRoot: REPO_ROOT };
    const report = auditModuleExperts(auditArgs);

    expect(report.findings).toEqual([]);
    expect(report.profileCount).toBe(9);
    expect(report.productionModuleCount).toBe(14);
    expect(report.auditOk).toBe(true);
  });

  test('requires exact canonical context and registered Rust boundary scope', () => {
    expect(MODULE_EXPERT_CANONICAL_CONTEXT_PATHS).toEqual([
      '.cortex/dynamic-skills/module-expert.md',
      '.cortex/workflows/module-oriented-development.md',
    ]);
    expect(INTERNAL_API_EXPERT_CANONICAL_CONTEXT_PATHS).toEqual([
      '.cortex/dynamic-skills/internal-api-expert.md',
      ...MODULE_EXPERT_CANONICAL_CONTEXT_PATHS,
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
    expect(auditModuleExpertSnapshotScopes(acceptedArgs)).toEqual([]);

    const coreProfile = MODULE_EXPERT_CATALOG.find(
      (profile) => profile.name === 'core_expert',
    );
    if (!coreProfile) throw new Error('core_expert test fixture is missing.');
    const driftedProfiles: readonly ModuleExpertProfile[] = [
      {
        ...internalApiProfile,
        canonicalContextPaths:
          internalApiProfile.canonicalContextPaths.slice(1),
      },
      {
        ...internalApiProfile,
        boundaryScopePaths: internalApiProfile.boundaryScopePaths.slice(1),
      },
      {
        ...internalApiProfile,
        boundaryScopePaths: [
          ...internalApiProfile.boundaryScopePaths,
          'nook-app/nook-web',
        ],
      },
      {
        ...internalApiProfile,
        boundaryScopePaths: [
          ...internalApiProfile.boundaryScopePaths,
        ].reverse(),
      },
      {
        ...coreProfile,
        boundaryScopePaths: ['nook-app/nook-platform/nook-auth2'],
      },
    ];
    const expectedCodes = [
      'invalid-canonical-expert-context',
      'invalid-internal-api-rust-boundary-scope',
      'invalid-internal-api-rust-boundary-scope',
      'invalid-internal-api-rust-boundary-scope',
      'unexpected-boundary-scope',
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
        auditModuleExpertSnapshotScopes(auditArgs).map(
          (finding) => finding.code,
        ),
      ).toContain(expectedCode);
    }
  });

  test('rejects missing, broad, generated, or reordered internal API binding scope', () => {
    const discoveredConsumerPaths = discoverInternalApiConsumerPaths(REPO_ROOT);
    expect(discoveredConsumerPaths).toEqual(
      INTERNAL_API_EXPERT_CONSUMER_SCOPE_PATHS,
    );
    expect(discoveredConsumerPaths).toContain(
      'nook-app/nook-web/nook-web-shared/src/vault-app/lib/auth/provider-types.ts',
    );
    expect(discoveredConsumerPaths).toContain(
      'nook-app/nook-web/nook-web-shared/src/extension/extension-connect-scope.ts',
    );
    const bindingConfigurationPaths = [
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
        ...internalApiProfile,
        scopePaths: internalApiProfile.scopePaths.filter(
          (scopePath) => scopePath !== omittedPath,
        ),
      }),
    );
    const driftedProfiles: readonly ModuleExpertProfile[] = [
      ...missingScopeProfiles,
      {
        ...internalApiProfile,
        scopePaths: [...internalApiProfile.scopePaths, 'nook-app/nook-web'],
      },
      {
        ...internalApiProfile,
        scopePaths: [
          ...internalApiProfile.scopePaths,
          internalApiProfile.generatedScopePaths[0]?.path ?? '',
        ],
      },
      {
        ...internalApiProfile,
        scopePaths: [...internalApiProfile.scopePaths].reverse(),
      },
    ];

    const catalogAuditArgs: AuditInternalApiExpertConsumerScopeArgs = {
      discoveredConsumerPaths,
      profile: internalApiProfile,
    };
    expect(auditInternalApiExpertConsumerScope(catalogAuditArgs)).toEqual([]);
    for (const profile of driftedProfiles) {
      const auditArgs: AuditInternalApiExpertConsumerScopeArgs = {
        discoveredConsumerPaths,
        profile,
      };
      expect(
        auditInternalApiExpertConsumerScope(auditArgs).map(
          (finding) => finding.code,
        ),
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
        profile: internalApiProfile,
      };
      expect(auditInternalApiExpertConsumerScope(auditArgs)).toHaveLength(1);
    }
  });

  test('rejects writable roles and a separate WASM expert', async () => {
    const fixtureRoot = await moduleExpertFixture();
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const coreDefinitionPath = join(
        fixtureRoot,
        '.codex/agents/module-experts/core_expert.toml',
      );
      const coreDefinition = await readFile(coreDefinitionPath, 'utf8');
      await writeFile(
        coreDefinitionPath,
        coreDefinition.replace(
          'sandbox_mode = "read-only"',
          'sandbox_mode = "workspace-write"',
        ),
        'utf8',
      );
      const hiddenDirectory = join(fixtureRoot, '.codex/agents/hidden/deep');
      const directoryOptions: MakeDirectoryOptions = { recursive: true };
      await mkdir(hiddenDirectory, directoryOptions);
      await writeFile(
        join(hiddenDirectory, 'wasm_expert.toml'),
        'name = "wasm_expert"\n',
        'utf8',
      );
      const auditArgs: AuditModuleExpertsArgs = { repoRoot: fixtureRoot };
      const report = auditModuleExperts(auditArgs);
      const codes = report.findings.map((finding) => finding.code);

      expect(codes).toContain('agent-definition-contract-drift');
      expect(codes).toContain('forbidden-wasm-boundary-role');
      expect(report.auditOk).toBe(false);
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('rejects recursively discovered uncataloged roles', async () => {
    const fixtureRoot = await moduleExpertFixture();
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const nestedDirectory = join(
        fixtureRoot,
        '.codex/agents/module-experts/nested',
      );
      const directoryOptions: MakeDirectoryOptions = { recursive: true };
      await mkdir(nestedDirectory, directoryOptions);
      await writeFile(
        join(nestedDirectory, 'shadow_expert.toml'),
        'name = "shadow_expert"\n',
        'utf8',
      );
      const auditArgs: AuditModuleExpertsArgs = { repoRoot: fixtureRoot };
      const report = auditModuleExperts(auditArgs);

      expect(report.findings.map((finding) => finding.code)).toContain(
        'uncataloged-agent-definition',
      );
      expect(report.auditOk).toBe(false);
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('rejects symlinked custom-agent entries', async () => {
    const fixtureRoot = await moduleExpertFixture();
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      await symlink(
        join(fixtureRoot, '.codex/agents/module-experts/core_expert.toml'),
        join(fixtureRoot, '.codex/agents/shadow.toml'),
      );
      const auditArgs: AuditModuleExpertsArgs = { repoRoot: fixtureRoot };
      const report = auditModuleExperts(auditArgs);

      expect(report.findings.map((finding) => finding.code)).toContain(
        'unsafe-agent-definition-entry',
      );
      expect(report.auditOk).toBe(false);
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('uses Cargo workspace identities instead of manifest text matches', () => {
    const liveManifest = join(
      REPO_ROOT,
      'nook-app/nook-platform/live-crate/Cargo.toml',
    );
    const decoyManifest = join(
      REPO_ROOT,
      'nook-app/nook-platform/retired-crate/Cargo.toml',
    );
    const metadata = {
      packages: [
        { id: 'live 1.0.0', manifest_path: liveManifest },
        { id: 'retired 1.0.0', manifest_path: decoyManifest },
      ],
      workspace_members: ['live 1.0.0'],
    };
    const decodeArgs: DecodeCargoWorkspaceMetadataArgs = {
      repoRoot: REPO_ROOT,
      source: JSON.stringify(metadata),
    };

    const expected: CargoWorkspaceInventory = {
      kind: CargoWorkspaceInventoryKind.Complete,
      roots: ['nook-app/nook-platform/live-crate'],
    };
    expect(decodeCargoWorkspaceMetadata(decodeArgs)).toEqual(expected);
  });

  test('uses an isolated non-delegating Codex runtime', () => {
    const threadOptionsArgs = { workingDirectory: REPO_ROOT };
    const threadOptions = moduleExpertIsolatedThreadOptions(threadOptionsArgs);

    expect(threadOptions.sandboxMode).toBe('read-only');
    expect(threadOptions.approvalPolicy).toBe('never');
    expect(threadOptions.networkAccessEnabled).toBe(false);
    expect(threadOptions.webSearchMode).toBe('disabled');
    expect(MODULE_EXPERT_CODEX_OPTIONS.config.agents.enabled).toBe(false);
    expect(MODULE_EXPERT_CODEX_OPTIONS.config.agents.max_depth).toBe(0);
    expect(MODULE_EXPERT_CODEX_OPTIONS.config.features.multi_agent).toBe(false);
    expect(MODULE_EXPERT_CODEX_OPTIONS.config.features.multi_agent_v2).toBe(
      false,
    );
    expect(MODULE_EXPERT_CODEX_OPTIONS.config.allow_login_shell).toBe(false);
    expect(
      MODULE_EXPERT_CODEX_OPTIONS.config.shell_environment_policy.inherit,
    ).toBe('none');
    expect(
      MODULE_EXPERT_CODEX_OPTIONS.config.shell_environment_policy
        .ignore_default_excludes,
    ).toBe(false);
    expect(
      MODULE_EXPERT_CODEX_OPTIONS.config.features.skill_mcp_dependency_install,
    ).toBe(false);
    expect(MODULE_EXPERT_AUTH_ENVIRONMENT_KEYS).toEqual(['CODEX_API_KEY']);
    const auditArgs: AuditModuleExpertRuntimePolicyArgs = {
      authEnvironmentKeys: MODULE_EXPERT_AUTH_ENVIRONMENT_KEYS,
      codexOptions: SAFE_CODEX_OPTIONS,
      processEnvironmentKeys: MODULE_EXPERT_PROCESS_ENVIRONMENT_KEYS,
      threadOptions,
    };
    expect(auditModuleExpertRuntimePolicy(auditArgs)).toEqual([]);
  });

  for (const drift of RUNTIME_POLICY_DRIFTS) {
    test(`rejects module expert runtime policy drift: ${drift.description}`, () => {
      const threadOptionsArgs = { workingDirectory: REPO_ROOT };
      const auditArgs: AuditModuleExpertRuntimePolicyArgs = {
        authEnvironmentKeys: MODULE_EXPERT_AUTH_ENVIRONMENT_KEYS,
        codexOptions: drift.codexOptions,
        processEnvironmentKeys: MODULE_EXPERT_PROCESS_ENVIRONMENT_KEYS,
        threadOptions: moduleExpertIsolatedThreadOptions(threadOptionsArgs),
      };
      const findings = auditModuleExpertRuntimePolicy(auditArgs);

      expect(findings.map((finding) => finding.code)).toEqual([
        'unsafe-module-expert-runtime',
      ]);
    });
  }

  test('rejects authentication and process environment allowlist drift', () => {
    const threadOptionsArgs = { workingDirectory: REPO_ROOT };
    const threadOptions = moduleExpertIsolatedThreadOptions(threadOptionsArgs);
    const authDriftArgs: AuditModuleExpertRuntimePolicyArgs = {
      authEnvironmentKeys: [
        ...MODULE_EXPERT_AUTH_ENVIRONMENT_KEYS,
        'CODEX_ACCESS_TOKEN',
      ],
      codexOptions: SAFE_CODEX_OPTIONS,
      processEnvironmentKeys: MODULE_EXPERT_PROCESS_ENVIRONMENT_KEYS,
      threadOptions,
    };
    const processDriftArgs: AuditModuleExpertRuntimePolicyArgs = {
      authEnvironmentKeys: MODULE_EXPERT_AUTH_ENVIRONMENT_KEYS,
      codexOptions: SAFE_CODEX_OPTIONS,
      processEnvironmentKeys: [
        ...MODULE_EXPERT_PROCESS_ENVIRONMENT_KEYS,
        'GITHUB_TOKEN',
      ],
      threadOptions,
    };

    expect(
      auditModuleExpertRuntimePolicy(authDriftArgs).map(
        (finding) => finding.code,
      ),
    ).toEqual(['unsafe-module-expert-runtime']);
    expect(
      auditModuleExpertRuntimePolicy(processDriftArgs).map(
        (finding) => finding.code,
      ),
    ).toEqual(['unsafe-module-expert-runtime']);
  });

  test('rejects generic and module-expert runtime routing drift', () => {
    const moduleRoutingDrift: AuditModuleExpertRuntimeRoutingArgs = {
      agentWorkflowCliSource:
        'const runtime = new CodexSdkAgentRuntime<Task, Agent>();',
      moduleExpertCliSource:
        '// new ModuleExpertCodexSdkAgentRuntime<string, string>();\nconst runtime = new CodexSdkAgentRuntime<string, string>();',
    };
    const genericRoutingDrift: AuditModuleExpertRuntimeRoutingArgs = {
      agentWorkflowCliSource:
        '// new CodexSdkAgentRuntime<Task, Agent>();\nconst runtime = new ModuleExpertCodexSdkAgentRuntime<Task, Agent>();',
      moduleExpertCliSource:
        'const runtime = new ModuleExpertCodexSdkAgentRuntime<string, string>();',
    };

    expect(
      auditModuleExpertRuntimeRouting(moduleRoutingDrift).map(
        (finding) => finding.code,
      ),
    ).toEqual(['unsafe-module-expert-runtime-routing']);
    expect(
      auditModuleExpertRuntimeRouting(genericRoutingDrift).map(
        (finding) => finding.code,
      ),
    ).toEqual(['unsafe-generic-runtime-routing']);
  });

  for (const mutation of GENERATED_MARKER_MUTATIONS) {
    test(`rejects producer drift for ${mutation.marker.path} in ${mutation.generatedScope.path}`, async () => {
      const fixtureRoot = await mkdtemp(
        join(tmpdir(), 'loom-generated-scope-'),
      );
      const removeOptions: RmOptions = { recursive: true, force: true };
      try {
        const sourceProducerPath = join(
          REPO_ROOT,
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
        const findings = auditGeneratedScopeProducerContract(auditArgs);
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

async function moduleExpertFixture(): Promise<string> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-module-experts-'));
  const recursiveDirectoryOptions: MakeDirectoryOptions = { recursive: true };
  await mkdir(
    join(fixtureRoot, '.codex/agents/module-experts'),
    recursiveDirectoryOptions,
  );
  await symlink(join(REPO_ROOT, '.cortex'), join(fixtureRoot, '.cortex'));
  await symlink(join(REPO_ROOT, '.agents'), join(fixtureRoot, '.agents'));
  await symlink(join(REPO_ROOT, 'agentic-ai'), join(fixtureRoot, 'agentic-ai'));
  await symlink(join(REPO_ROOT, 'nook-app'), join(fixtureRoot, 'nook-app'));
  const sourceDirectory = join(REPO_ROOT, '.codex/agents/module-experts');
  const definitionNames = await readdir(sourceDirectory);
  for (const definitionName of definitionNames) {
    await copyFile(
      join(sourceDirectory, definitionName),
      join(fixtureRoot, '.codex/agents/module-experts', definitionName),
    );
  }
  return fixtureRoot;
}
