import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
} from 'node:path';
import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';
import * as ts from 'typescript';
import {
  MODULE_EXPERT_AGENT_INSTRUCTIONS,
  MODULE_EXPERT_CATALOG,
  MODULE_EXPERT_RESEARCH_ROOT,
} from './catalog.ts';
import type {
  ModuleExpertGeneratedScope,
  ModuleExpertProfile,
} from './catalog.ts';
import {
  MODULE_EXPERT_AUTH_ENVIRONMENT_KEYS,
  MODULE_EXPERT_CODEX_OPTIONS,
  MODULE_EXPERT_PROCESS_ENVIRONMENT_KEYS,
  moduleExpertThreadOptions,
} from './runtime-contract.ts';
import {
  CargoWorkspaceInventoryKind,
  discoverCargoWorkspace,
} from './cargo-workspace.ts';
import type { DiscoverCargoWorkspaceArgs } from './cargo-workspace.ts';

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

export type AuditModuleExpertRuntimePolicyArgs = {
  readonly authEnvironmentKeys: readonly string[];
  readonly codexOptions: CodexOptions;
  readonly processEnvironmentKeys: readonly string[];
  readonly threadOptions: ThreadOptions;
};

export type AuditModuleExpertRuntimeRoutingArgs = {
  readonly agentWorkflowCliSource: string;
  readonly moduleExpertCliSource: string;
};

type ParsedAgentDefinition = {
  readonly name: string;
  readonly description: string;
  readonly sandboxMode: string;
  readonly approvalPolicy: string;
  readonly developerInstructions: string;
};

const CODEX_AGENT_DIRECTORY = '.codex/agents';
const AGENT_DIRECTORY = `${CODEX_AGENT_DIRECTORY}/module-experts`;
const AGENT_WORKFLOW_CLI = 'agentic-ai/loom/src/agent-workflow/cli.ts';
const MODULE_EXPERT_CLI = 'agentic-ai/loom/src/module-experts/cli.ts';
const PLATFORM_MANIFEST = 'nook-app/nook-platform/Cargo.toml';
const WEB_ROOT = 'nook-app/nook-web';
const EXPECTED_AUTH_ENVIRONMENT_KEYS = [
  'CODEX_API_KEY',
  'CODEX_ACCESS_TOKEN',
] as const;
const EXPECTED_PROCESS_ENVIRONMENT_KEYS = [
  'COMSPEC',
  'PATH',
  'Path',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
] as const;

export function auditModuleExperts(
  args: AuditModuleExpertsArgs,
): ModuleExpertAuditReport {
  const findings: ModuleExpertAuditFinding[] = [];
  const context: ModuleExpertValidationContext = {
    findings,
    repoRoot: args.repoRoot,
  };
  validateProfiles(context);
  const liveRoots = liveProductionModuleRoots(context);
  const coverageArgs: ValidateProductionCoverageArgs = {
    context,
    liveRoots,
  };
  validateProductionCoverage(coverageArgs);
  validateAgentDefinitions(context);
  validateRuntimePolicy(context);
  validateRuntimeRouting(context);
  return {
    findings,
    profileCount: MODULE_EXPERT_CATALOG.length,
    productionModuleCount: liveRoots.length,
    auditOk: findings.length === 0,
  };
}

type ModuleExpertValidationContext = {
  readonly findings: ModuleExpertAuditFinding[];
  readonly repoRoot: string;
};

export type AuditGeneratedScopeProducerContractArgs = {
  readonly repoRoot: string;
  readonly generatedScope: ModuleExpertGeneratedScope;
};

export function auditGeneratedScopeProducerContract(
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
  validateGeneratedScopeProducer(validationArgs);
  return findings;
}

export function auditModuleExpertRuntimePolicy(
  args: AuditModuleExpertRuntimePolicyArgs,
): readonly ModuleExpertAuditFinding[] {
  const config = args.codexOptions.config;
  const agents = config?.agents;
  const features = config?.features;
  const shellEnvironmentPolicy = config?.shell_environment_policy;
  const authEnvironmentComparison: OrderedValuesComparison = {
    actual: args.authEnvironmentKeys,
    expected: EXPECTED_AUTH_ENVIRONMENT_KEYS,
  };
  const processEnvironmentComparison: OrderedValuesComparison = {
    actual: args.processEnvironmentKeys,
    expected: EXPECTED_PROCESS_ENVIRONMENT_KEYS,
  };
  const valid =
    args.threadOptions.sandboxMode === 'read-only' &&
    args.threadOptions.approvalPolicy === 'never' &&
    args.threadOptions.networkAccessEnabled === false &&
    args.threadOptions.webSearchMode === 'disabled' &&
    config?.allow_login_shell === false &&
    config.cli_auth_credentials_store === 'file' &&
    typeof agents === 'object' &&
    !Array.isArray(agents) &&
    agents.enabled === false &&
    agents.max_depth === 0 &&
    typeof features === 'object' &&
    !Array.isArray(features) &&
    features.apps === false &&
    features.multi_agent === false &&
    features.multi_agent_v2 === false &&
    features.plugins === false &&
    features.skill_mcp_dependency_install === false &&
    typeof shellEnvironmentPolicy === 'object' &&
    !Array.isArray(shellEnvironmentPolicy) &&
    shellEnvironmentPolicy.inherit === 'none' &&
    shellEnvironmentPolicy.ignore_default_excludes === false &&
    sameOrderedValues(authEnvironmentComparison) &&
    sameOrderedValues(processEnvironmentComparison);
  if (valid) return [];
  return [
    {
      code: 'unsafe-module-expert-runtime',
      path: 'agentic-ai/loom/src/module-experts/runtime-contract.ts',
      message:
        'Module experts require an isolated read-only, offline, non-delegating Codex runtime.',
    },
  ];
}

export function auditModuleExpertRuntimeRouting(
  args: AuditModuleExpertRuntimeRoutingArgs,
): readonly ModuleExpertAuditFinding[] {
  const findings: ModuleExpertAuditFinding[] = [];
  const moduleExpertRuntimeNames = constructedRuntimeNames(
    args.moduleExpertCliSource,
  );
  const agentWorkflowRuntimeNames = constructedRuntimeNames(
    args.agentWorkflowCliSource,
  );
  if (
    !moduleExpertRuntimeNames.includes('ModuleExpertCodexSdkAgentRuntime') ||
    moduleExpertRuntimeNames.includes('CodexSdkAgentRuntime')
  ) {
    findings[findings.length] = {
      code: 'unsafe-module-expert-runtime-routing',
      path: MODULE_EXPERT_CLI,
      message:
        'Module expert invocation must use only the isolated module-expert Codex runtime.',
    };
  }
  if (
    !agentWorkflowRuntimeNames.includes('CodexSdkAgentRuntime') ||
    agentWorkflowRuntimeNames.includes('ModuleExpertCodexSdkAgentRuntime')
  ) {
    findings[findings.length] = {
      code: 'unsafe-generic-runtime-routing',
      path: AGENT_WORKFLOW_CLI,
      message:
        'Generic agent workflows must retain the ordinary Codex runtime and authentication store.',
    };
  }
  return findings;
}

function constructedRuntimeNames(source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    'runtime-routing.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      names[names.length] = node.expression.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

type OrderedValuesComparison = {
  readonly actual: readonly string[];
  readonly expected: readonly string[];
};

function sameOrderedValues(comparison: OrderedValuesComparison): boolean {
  return (
    JSON.stringify(comparison.actual) === JSON.stringify(comparison.expected)
  );
}

function validateProfiles(context: ModuleExpertValidationContext): void {
  const names = new Set<string>();
  const moduleOwners = new Map<string, string>();
  for (const profile of MODULE_EXPERT_CATALOG) {
    if (!safeIdentifier(profile.name) || names.has(profile.name)) {
      context.findings[context.findings.length] = {
        code: 'invalid-profile-name',
        path: profile.agentDefinitionPath,
        message: `Module expert name is unsafe or duplicated: ${profile.name}`,
      };
    }
    names.add(profile.name);
    const expectedDefinitionPath = `${AGENT_DIRECTORY}/${profile.name}.toml`;
    if (profile.agentDefinitionPath !== expectedDefinitionPath) {
      context.findings[context.findings.length] = {
        code: 'noncanonical-agent-path',
        path: profile.agentDefinitionPath,
        message: `Expected agent definition path ${expectedDefinitionPath}.`,
      };
    }
    if (profile.validationSelectors.length === 0) {
      context.findings[context.findings.length] = {
        code: 'missing-validation-selector',
        path: profile.agentDefinitionPath,
        message:
          'Every module expert needs at least one focused validation selector.',
      };
    }
    const validateProfilePathsArgs: ValidateProfilePathsArgs = {
      context,
      moduleOwners,
      profile,
    };
    validateProfilePaths(validateProfilePathsArgs);
  }
  validateInternalApiProfile(context);
}

type ValidateProfilePathsArgs = {
  readonly context: ModuleExpertValidationContext;
  readonly moduleOwners: Map<string, string>;
  readonly profile: ModuleExpertProfile;
};

function validateProfilePaths(args: ValidateProfilePathsArgs): void {
  const paths = [
    args.profile.agentDefinitionPath,
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
    if (!safeRepoPath(candidate)) {
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
    args.profile.agentDefinitionPath,
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
          safeRepoPath(marker.path) &&
          !marker.path.includes('/') &&
          marker.producerEvidence.length > 0 &&
          marker.producerEvidence.every(validProducerEvidence),
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
    validateGeneratedScopeProducer(producerValidationArgs);
  }
}

type ValidateGeneratedScopeProducerArgs = {
  readonly context: ModuleExpertValidationContext;
  readonly generatedScope: ModuleExpertGeneratedScope;
};

function validateGeneratedScopeProducer(
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

function validateInternalApiProfile(
  context: ModuleExpertValidationContext,
): void {
  const profile = MODULE_EXPERT_CATALOG.find(
    (candidate) => candidate.name === 'internal_api_expert',
  );
  if (!profile) {
    context.findings[context.findings.length] = {
      code: 'missing-internal-api-expert',
      path: AGENT_DIRECTORY,
      message: 'The internal_api_expert profile is required.',
    };
    return;
  }
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
        path: profile.agentDefinitionPath,
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

type ValidateProductionCoverageArgs = {
  readonly context: ModuleExpertValidationContext;
  readonly liveRoots: readonly string[];
};

function validateProductionCoverage(
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

function liveProductionModuleRoots(
  context: ModuleExpertValidationContext,
): readonly string[] {
  const discoveryArgs: DiscoverCargoWorkspaceArgs = {
    repoRoot: context.repoRoot,
    manifestPath: PLATFORM_MANIFEST,
  };
  const cargoInventory = discoverCargoWorkspace(discoveryArgs);
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
    .filter((root) => existsSync(join(context.repoRoot, root, 'package.json')))
    .filter((root) => root !== MODULE_EXPERT_RESEARCH_ROOT);
  return [...rustRoots, ...webRoots].sort();
}

function validateAgentDefinitions(
  context: ModuleExpertValidationContext,
): void {
  const agentDirectory = join(context.repoRoot, CODEX_AGENT_DIRECTORY);
  if (!existsSync(agentDirectory)) {
    context.findings[context.findings.length] = {
      code: 'missing-agent-directory',
      path: CODEX_AGENT_DIRECTORY,
      message: 'Module expert agent definition directory is missing.',
    };
    return;
  }
  const expectedPaths = new Set(
    MODULE_EXPERT_CATALOG.map((profile) => profile.agentDefinitionPath),
  );
  const collectArgs: CollectAgentDefinitionPathsArgs = {
    directory: agentDirectory,
    repoRoot: context.repoRoot,
  };
  const discovery = collectAgentDefinitionPaths(collectArgs);
  for (const unsafePath of discovery.unsafePaths) {
    context.findings[context.findings.length] = {
      code: 'unsafe-agent-definition-entry',
      path: unsafePath,
      message: `Custom-agent discovery does not permit symbolic links: ${unsafePath}`,
    };
  }
  const actualPaths = discovery.paths;
  for (const actualPath of actualPaths) {
    if (!expectedPaths.has(actualPath)) {
      const roleName = basename(actualPath, '.toml');
      const forbiddenBoundaryRole = /(?:wasm|bridge)/iu.test(roleName);
      context.findings[context.findings.length] = {
        code: forbiddenBoundaryRole
          ? 'forbidden-wasm-boundary-role'
          : 'uncataloged-agent-definition',
        path: actualPath,
        message: forbiddenBoundaryRole
          ? 'A separate WASM or bridge expert is forbidden; use internal_api_expert.'
          : `Agent definition is not present in the module expert catalog: ${roleName}`,
      };
    }
  }
  for (const profile of MODULE_EXPERT_CATALOG) {
    const validateAgentDefinitionArgs: ValidateAgentDefinitionArgs = {
      context,
      profile,
    };
    validateAgentDefinition(validateAgentDefinitionArgs);
  }
}

type CollectAgentDefinitionPathsArgs = {
  readonly directory: string;
  readonly repoRoot: string;
};

type AgentDefinitionDiscovery = {
  readonly paths: readonly string[];
  readonly unsafePaths: readonly string[];
};

function collectAgentDefinitionPaths(
  args: CollectAgentDefinitionPathsArgs,
): AgentDefinitionDiscovery {
  const paths: string[] = [];
  const unsafePaths: string[] = [];
  const directories = [args.directory];
  const directoryOptions = { withFileTypes: true } as const;
  while (directories.length > 0) {
    const directory = directories.pop();
    if (!directory) continue;
    for (const entry of readdirSync(directory, directoryOptions)) {
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        unsafePaths[unsafePaths.length] = relative(args.repoRoot, absolutePath);
      } else if (entry.isDirectory()) {
        directories[directories.length] = absolutePath;
      } else if (entry.isFile() && entry.name.endsWith('.toml')) {
        paths[paths.length] = relative(args.repoRoot, absolutePath);
      }
    }
  }
  return { paths: paths.sort(), unsafePaths: unsafePaths.sort() };
}

function validateRuntimePolicy(context: ModuleExpertValidationContext): void {
  const threadOptionsArgs = { workingDirectory: context.repoRoot };
  const threadOptions = moduleExpertThreadOptions(threadOptionsArgs);
  const auditArgs: AuditModuleExpertRuntimePolicyArgs = {
    authEnvironmentKeys: MODULE_EXPERT_AUTH_ENVIRONMENT_KEYS,
    codexOptions: MODULE_EXPERT_CODEX_OPTIONS,
    processEnvironmentKeys: MODULE_EXPERT_PROCESS_ENVIRONMENT_KEYS,
    threadOptions,
  };
  for (const finding of auditModuleExpertRuntimePolicy(auditArgs)) {
    context.findings[context.findings.length] = finding;
  }
}

function validateRuntimeRouting(context: ModuleExpertValidationContext): void {
  const agentWorkflowCliPath = join(context.repoRoot, AGENT_WORKFLOW_CLI);
  const moduleExpertCliPath = join(context.repoRoot, MODULE_EXPERT_CLI);
  const auditArgs: AuditModuleExpertRuntimeRoutingArgs = {
    agentWorkflowCliSource: existsSync(agentWorkflowCliPath)
      ? readFileSync(agentWorkflowCliPath, 'utf8')
      : '',
    moduleExpertCliSource: existsSync(moduleExpertCliPath)
      ? readFileSync(moduleExpertCliPath, 'utf8')
      : '',
  };
  for (const finding of auditModuleExpertRuntimeRouting(auditArgs)) {
    context.findings[context.findings.length] = finding;
  }
}

type ValidateAgentDefinitionArgs = {
  readonly context: ModuleExpertValidationContext;
  readonly profile: ModuleExpertProfile;
};

function validateAgentDefinition(args: ValidateAgentDefinitionArgs): void {
  const absolutePath = join(
    args.context.repoRoot,
    args.profile.agentDefinitionPath,
  );
  if (!existsSync(absolutePath)) return;
  const source = readFileSync(absolutePath, 'utf8');
  const definition = parseAgentDefinition(source);
  if (!definition) {
    args.context.findings[args.context.findings.length] = {
      code: 'malformed-agent-definition',
      path: args.profile.agentDefinitionPath,
      message:
        'Agent definition must contain the required bounded TOML fields.',
    };
    return;
  }
  const valid =
    definition.name === args.profile.name &&
    definition.description === args.profile.description &&
    definition.sandboxMode === 'read-only' &&
    definition.approvalPolicy === 'never' &&
    definition.developerInstructions === MODULE_EXPERT_AGENT_INSTRUCTIONS &&
    source.trim() === renderAgentDefinition(args.profile).trim();
  if (!valid) {
    args.context.findings[args.context.findings.length] = {
      code: 'agent-definition-contract-drift',
      path: args.profile.agentDefinitionPath,
      message:
        'Agent definition must match its catalog identity and the shared read-only instruction contract.',
    };
  }
}

function renderAgentDefinition(profile: ModuleExpertProfile): string {
  return `name = "${profile.name}"
description = "${profile.description}"
sandbox_mode = "read-only"
approval_policy = "never"

developer_instructions = """
${MODULE_EXPERT_AGENT_INSTRUCTIONS}
"""
`;
}

function parseAgentDefinition(source: string): ParsedAgentDefinition | false {
  const name = source.match(/^name\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  const description = source.match(/^description\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  const sandboxMode = source.match(/^sandbox_mode\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  const approvalPolicy = source.match(
    /^approval_policy\s*=\s*"([^"]+)"\s*$/mu,
  )?.[1];
  const developerInstructions = source.match(
    /developer_instructions\s*=\s*"""\n([\s\S]*?)\n"""/u,
  )?.[1];
  if (
    !name ||
    !description ||
    !sandboxMode ||
    !approvalPolicy ||
    !developerInstructions
  ) {
    return false;
  }
  return {
    name,
    description,
    sandboxMode,
    approvalPolicy,
    developerInstructions,
  };
}

function safeIdentifier(value: string): boolean {
  return value.length <= 64 && /^[a-z][a-z0-9_]*$/u.test(value);
}

function validProducerEvidence(value: string): boolean {
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

function safeRepoPath(value: string): boolean {
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
