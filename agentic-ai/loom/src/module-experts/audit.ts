import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
} from 'node:path';
import {
  MODULE_EXPERT_AGENT_INSTRUCTIONS,
  MODULE_EXPERT_CATALOG,
  MODULE_EXPERT_RESEARCH_ROOT,
} from './catalog.ts';
import type { ModuleExpertProfile } from './catalog.ts';

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

type ParsedAgentDefinition = {
  readonly name: string;
  readonly description: string;
  readonly sandboxMode: string;
  readonly approvalPolicy: string;
  readonly developerInstructions: string;
};

const AGENT_DIRECTORY = '.codex/agents/module-experts';
const PLATFORM_MANIFEST = 'nook-app/nook-platform/Cargo.toml';
const WEB_ROOT = 'nook-app/nook-web';

export function auditModuleExperts(
  args: AuditModuleExpertsArgs,
): ModuleExpertAuditReport {
  const findings: ModuleExpertAuditFinding[] = [];
  const context: ModuleExpertValidationContext = {
    findings,
    repoRoot: args.repoRoot,
  };
  validateProfiles(context);
  validateProductionCoverage(context);
  validateAgentDefinitions(context);
  return {
    findings,
    profileCount: MODULE_EXPERT_CATALOG.length,
    productionModuleCount: liveProductionModuleRoots(args.repoRoot).length,
    auditOk: findings.length === 0,
  };
}

type ModuleExpertValidationContext = {
  readonly findings: ModuleExpertAuditFinding[];
  readonly repoRoot: string;
};

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
  const ownedScopes = new Set([...profile.moduleRoots, ...profile.scopePaths]);
  for (const requiredScope of requiredScopes) {
    if (!ownedScopes.has(requiredScope)) {
      context.findings[context.findings.length] = {
        code: 'incomplete-internal-api-scope',
        path: profile.agentDefinitionPath,
        message: `internal_api_expert must cover ${requiredScope}.`,
      };
    }
  }
}

function validateProductionCoverage(
  context: ModuleExpertValidationContext,
): void {
  const catalogRoots = MODULE_EXPERT_CATALOG.flatMap(
    (profile) => profile.moduleRoots,
  );
  const catalogSet = new Set(catalogRoots);
  const liveRoots = liveProductionModuleRoots(context.repoRoot);
  const liveSet = new Set(liveRoots);
  for (const liveRoot of liveRoots) {
    if (!catalogSet.has(liveRoot)) {
      context.findings[context.findings.length] = {
        code: 'unrouted-production-module',
        path: liveRoot,
        message: `Production module has no module expert: ${liveRoot}`,
      };
    }
  }
  for (const catalogRoot of catalogRoots) {
    if (!liveSet.has(catalogRoot)) {
      context.findings[context.findings.length] = {
        code: 'stale-module-route',
        path: catalogRoot,
        message: `Catalog route is not a live production module: ${catalogRoot}`,
      };
    }
  }
  if (catalogSet.has(MODULE_EXPERT_RESEARCH_ROOT)) {
    context.findings[context.findings.length] = {
      code: 'research-module-routed',
      path: MODULE_EXPERT_RESEARCH_ROOT,
      message:
        'nook-web-research must remain outside production expert routing.',
    };
  }
}

function liveProductionModuleRoots(repoRoot: string): readonly string[] {
  const manifestPath = join(repoRoot, PLATFORM_MANIFEST);
  const manifest = readFileSync(manifestPath, 'utf8');
  const membersBlock =
    manifest.match(/members\s*=\s*\[([\s\S]*?)\]/u)?.[1] ?? '';
  const rustRoots = [...membersBlock.matchAll(/"([^"]+)"/gu)].map(
    (match) => `nook-app/nook-platform/${match[1] ?? ''}`,
  );
  const webDirectory = join(repoRoot, WEB_ROOT);
  const directoryOptions = { withFileTypes: true } as const;
  const webRoots = readdirSync(webDirectory, directoryOptions)
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${WEB_ROOT}/${entry.name}`)
    .filter((root) => existsSync(join(repoRoot, root, 'package.json')))
    .filter((root) => root !== MODULE_EXPERT_RESEARCH_ROOT);
  return [...rustRoots, ...webRoots].sort();
}

function validateAgentDefinitions(
  context: ModuleExpertValidationContext,
): void {
  const agentDirectory = join(context.repoRoot, AGENT_DIRECTORY);
  if (!existsSync(agentDirectory)) {
    context.findings[context.findings.length] = {
      code: 'missing-agent-directory',
      path: AGENT_DIRECTORY,
      message: 'Module expert agent definition directory is missing.',
    };
    return;
  }
  const expectedPaths = new Set(
    MODULE_EXPERT_CATALOG.map((profile) => profile.agentDefinitionPath),
  );
  const directoryOptions = { withFileTypes: true } as const;
  const actualPaths = readdirSync(agentDirectory, directoryOptions)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.toml'))
    .map((entry) => `${AGENT_DIRECTORY}/${entry.name}`)
    .sort();
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
