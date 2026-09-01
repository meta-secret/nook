import { TeamKey } from '../team-agents/catalog.ts';
import { taskResourcePatternsOverlap } from '../agent-workflow/domain.ts';
import type { AgentAttemptParent } from '../agent-workflow/domain.ts';

export const MODULE_DELIVERY_PLAN_VERSION = 3;
export type ModuleDeliveryPlanInputVersion =
  typeof MODULE_DELIVERY_PLAN_VERSION;
export const MAX_MODULE_DELIVERY_NODES = 64;
export const MAX_MODULE_DELIVERY_CONCURRENCY = 16;
export const MAX_MODULE_DELIVERY_AGENT_DEPTH = 3;
export const MAX_MODULE_DELIVERY_ATTEMPTS = 5;
export const CORTEX_TEAM_WRITER_EXPERT = 'cortex_team_writer';

export enum ModuleDeliveryOwner {
  GizmoPrime = 'gizmo-prime',
}

export enum ModuleDeliveryGitCommonSurface {
  Hooks = 'hooks',
  Info = 'info',
}

export type ModuleDeliveryOwnerIdentity = TeamKey | ModuleDeliveryOwner;

export const REQUIRED_PARENT_OWNED_RESOURCES = [
  '.cortex/**',
  '.github/**',
  'Cargo.lock',
  'Taskfile.yml',
  'bun.lock',
  'git:branch',
  'git:index',
  'git:worktree',
  'package.json',
] as const;

export enum ModuleDeliveryTaskKind {
  ReadOnly = 'read-only',
  EvidenceSynthesis = 'evidence-synthesis',
  Write = 'write',
}

export enum ModuleDeliveryTaskProfile {
  Ordinary = 'ordinary-team-task',
}

const SRE_EXACT_OPERATIONAL_FILES = [
  'agentic-ai/minds/Taskfile.yml',
  'nook-app/Taskfile.yml',
  'nook-app/docker-bake.hcl',
  'nook-app/nook-web/nook-web-extension/scripts/hosted-extension.sh',
  'nook-app/nook-web/nook-web-extension/scripts/hosted-extension.test.sh',
  'nook-app/nook-web/nook-web-extension/scripts/run-with-xvfb.sh',
  'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.mjs',
  'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.sh',
  'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.test.sh',
  'nook-app/nook-web/nook-web-extension/scripts/test-e2e.sh',
  'nook-app/nook-web/nook-web-extension/scripts/test-hosted-smoke.sh',
  'nook-app/nook-web/nook-web-extension/scripts/test-hosted-smoke.test.sh',
  'nook-app/nook-web/nook-web-extension/scripts/verify-deployment.sh',
] as const;

export const ORDINARY_TASK_WRITE_ROOTS = {
  [TeamKey.Ai]: [
    'agentic-ai/loom',
    '.task/agentic-ai.yml',
    'preflight/tests/loom_contracts.rs',
  ],
  [TeamKey.DevelopmentCore]: [
    'agentic-ai/minds/Cargo.lock',
    'agentic-ai/minds/Cargo.toml',
    'agentic-ai/minds/clippy.toml',
    'agentic-ai/minds/hive/Cargo.toml',
    'agentic-ai/minds/hive/src',
    'agentic-ai/minds/hive/tests',
    'agentic-ai/minds/lace',
    'nook-app/nook-platform/Cargo.lock',
    'nook-app/nook-platform/Cargo.toml',
    'nook-app/nook-platform/fuzz',
    'nook-app/nook-platform/nook-app-common',
    'nook-app/nook-platform/nook-auth2',
    'nook-app/nook-platform/nook-authenticator-domain',
    'nook-app/nook-platform/nook-companion-core',
    'nook-app/nook-platform/nook-companion-wasm',
    'nook-app/nook-platform/nook-core',
    'nook-app/nook-platform/nook-event-log',
    'nook-app/nook-platform/nook-replication',
    'nook-app/nook-platform/nook-wasm',
  ],
  [TeamKey.Security]: [],
  [TeamKey.Sre]: [
    ...SRE_EXACT_OPERATIONAL_FILES,
    'infra',
    'nook-app/ci',
    'nook-app/nook-platform/.cargo',
    'nook-app/nook-platform/.config',
    'nook-app/nook-platform/Taskfile.yml',
    'nook-app/nook-platform/docker',
    'nook-app/nook-platform/fuzz/.cargo',
    'nook-app/nook-platform/nook-core/Dockerfile.dockerignore',
    'nook-app/nook-platform/nook-core/coverage-floor.json',
    'nook-app/nook-platform/nook-core/docker-bake.hcl',
    'nook-app/nook-platform/nook-wasm/Dockerfile.dockerignore',
    'nook-app/nook-platform/nook-wasm/Taskfile.yml',
    'nook-app/nook-platform/nook-wasm/docker-bake.hcl',
    'nook-app/nook-web/Taskfile.yml',
    'nook-app/nook-web/docker',
    'nook-app/nook-web/nook-web-extension/Taskfile.yml',
    'nook-app/nook-web/nook-web-app/Dockerfile',
    'nook-app/nook-web/nook-web-app/docker-bake.hcl',
    'preflight',
    '.task',
    'agentic-ai/ci-agent',
  ],
  [TeamKey.WebDevelopment]: [
    'nook-app/nook-web',
    'agentic-ai/minds/hive-console',
  ],
} as const;

const ORDINARY_TASK_FILE_ROOTS = new Set<string>([
  ...SRE_EXACT_OPERATIONAL_FILES,
  '.task/agentic-ai.yml',
  'agentic-ai/minds/Cargo.lock',
  'agentic-ai/minds/Cargo.toml',
  'agentic-ai/minds/clippy.toml',
  'agentic-ai/minds/hive/Cargo.toml',
  'nook-app/nook-platform/Cargo.lock',
  'nook-app/nook-platform/Cargo.toml',
  'nook-app/nook-platform/nook-core/Dockerfile.dockerignore',
  'nook-app/nook-platform/nook-core/coverage-floor.json',
  'nook-app/nook-platform/nook-core/docker-bake.hcl',
  'nook-app/nook-platform/nook-wasm/Dockerfile.dockerignore',
  'nook-app/nook-platform/nook-wasm/Taskfile.yml',
  'nook-app/nook-platform/nook-wasm/docker-bake.hcl',
  'nook-app/nook-platform/Taskfile.yml',
  'nook-app/nook-web/nook-web-app/Dockerfile',
  'nook-app/nook-web/nook-web-app/docker-bake.hcl',
  'nook-app/nook-web/nook-web-extension/Taskfile.yml',
  'nook-app/nook-web/Taskfile.yml',
  'preflight/tests/loom_contracts.rs',
]);

export type ModuleDeliveryTaskTeamRequest = {
  readonly kind: ModuleDeliveryTaskKind;
  readonly moduleRoot: string;
  readonly expertContextPaths: readonly string[];
};

export function ordinaryTaskWriteTeam(write: string): TeamKey | false {
  if (ordinaryTaskFileRootShadows(write)) return false;
  if (!write.includes('*')) return ordinaryTaskPathTeam(write);
  let owner: TeamKey | false = false;
  for (const team of Object.values(TeamKey)) {
    const roots: readonly string[] = ORDINARY_TASK_WRITE_ROOTS[team];
    for (const root of roots)
      if (taskResourcePatternsOverlap({ first: write, second: root })) {
        if (owner !== false && owner !== team) return false;
        owner = team;
      }
  }
  return owner;
}

function ordinaryTaskPathTeam(path: string): TeamKey | false {
  let owner: TeamKey | false = false;
  let ownerRootLength = -1;
  for (const team of Object.values(TeamKey)) {
    const roots: readonly string[] = ORDINARY_TASK_WRITE_ROOTS[team];
    for (const root of roots)
      if (
        (path === root ||
          (!ORDINARY_TASK_FILE_ROOTS.has(root) &&
            path.startsWith(`${root}/`))) &&
        root.length > ownerRootLength
      ) {
        owner = team;
        ownerRootLength = root.length;
      }
  }
  return owner;
}

export type OrdinaryTaskWriteAuthorizationRequest = {
  readonly team: TeamKey;
  readonly moduleRoot: string;
  readonly write: string;
};

export function ordinaryTaskWriteAuthorized(
  request: OrdinaryTaskWriteAuthorizationRequest,
): boolean {
  return (
    (request.write.includes('*') ||
      request.write !== request.moduleRoot ||
      !ordinaryTaskDirectoryRoot(request.write)) &&
    (request.write === request.moduleRoot ||
      request.write.startsWith(`${request.moduleRoot}/`)) &&
    ordinaryTaskWriteTeam(request.write) === request.team
  );
}

function ordinaryTaskDirectoryRoot(path: string): boolean {
  for (const roots of Object.values(ORDINARY_TASK_WRITE_ROOTS))
    if (roots.includes(path as never) && !ORDINARY_TASK_FILE_ROOTS.has(path))
      return true;
  return false;
}

function ordinaryTaskFileRootShadows(write: string): boolean {
  for (const roots of Object.values(ORDINARY_TASK_WRITE_ROOTS))
    for (const root of roots)
      if (ORDINARY_TASK_FILE_ROOTS.has(root) && write.startsWith(`${root}/`))
        return true;
  return false;
}

export function moduleDeliveryTaskTeam(
  request: ModuleDeliveryTaskTeamRequest,
): TeamKey | false {
  if (request.kind === ModuleDeliveryTaskKind.Write) {
    return ordinaryTaskWriteTeam(request.moduleRoot);
  }
  if (request.expertContextPaths.includes('.cortex/teams/ai/AGENTS.md'))
    return TeamKey.Ai;
  if (request.expertContextPaths.includes('.cortex/teams/web-dev/AGENTS.md'))
    return TeamKey.WebDevelopment;
  if (request.expertContextPaths.includes('.cortex/teams/dev-core/AGENTS.md'))
    return TeamKey.DevelopmentCore;
  return false;
}

export enum ModuleDeliveryEvidenceInputSchema {
  AcceptedProviderEvidenceV1 = 'accepted-provider-evidence-v1',
}

export enum ModuleDeliveryWorkspaceKind {
  SharedCheckout = 'shared-checkout',
}

export enum ModuleDeliveryJoinKind {
  DirectCommits = 'direct-commits',
}

export enum ModuleDeliveryBaselineKind {
  SourceCommit = 'source-commit',
  IntegratedDependencies = 'integrated-dependencies',
}

export type SourceCommitBaseline = {
  readonly kind: ModuleDeliveryBaselineKind.SourceCommit;
  readonly sourceCommit: string;
};

export type IntegratedDependenciesBaseline = {
  readonly kind: ModuleDeliveryBaselineKind.IntegratedDependencies;
  readonly providerTaskIds: readonly string[];
};

export type ModuleDeliveryBaseline =
  SourceCommitBaseline | IntegratedDependenciesBaseline;

export type ModuleDeliveryResourceClaims = {
  readonly read: readonly string[];
  readonly write: readonly string[];
  readonly evidenceSurface: readonly string[];
};

export type ModuleDeliveryAcceptance = {
  readonly commands: readonly string[];
  readonly evidence: readonly string[];
};

export type ModuleDeliveryCortexAuthoring = {
  readonly selectedSkillPaths: readonly string[];
  readonly sharedWriteClaims: readonly string[];
};

export type ModuleDeliveryExpectedProducerIdentity = {
  readonly taskId: string;
  readonly team: TeamKey;
  readonly functionalOwner: ModuleDeliveryOwnerIdentity;
  readonly acceptanceOwner: ModuleDeliveryOwnerIdentity;
};

export type ModuleDeliveryEvidenceInputContract = {
  readonly schema: ModuleDeliveryEvidenceInputSchema;
  readonly expectedProducers: readonly ModuleDeliveryExpectedProducerIdentity[];
};

type ModuleDeliveryNodeFields = {
  readonly taskId: string;
  readonly team: TeamKey;
  readonly functionalOwner: ModuleDeliveryOwnerIdentity;
  readonly acceptanceOwner: ModuleDeliveryOwnerIdentity;
  readonly parentLineage: AgentAttemptParent;
  readonly expert: string;
  readonly moduleRoot: string;
  readonly consumerOutcome: string;
  readonly baseline: ModuleDeliveryBaseline;
  readonly agentDepthLimit: number;
  readonly dependencies: readonly string[];
  readonly resources: ModuleDeliveryResourceClaims;
  readonly parentOwnedExclusions: readonly string[];
  readonly acceptance: ModuleDeliveryAcceptance;
};

export type ModuleDeliveryReadOnlyNodeV2 = ModuleDeliveryNodeFields & {
  readonly kind: ModuleDeliveryTaskKind.ReadOnly;
};

export type ModuleDeliveryEvidenceSynthesisNodeV2 = ModuleDeliveryNodeFields & {
  readonly kind: ModuleDeliveryTaskKind.EvidenceSynthesis;
  readonly evidenceInput: ModuleDeliveryEvidenceInputContract;
};

export type ModuleDeliveryWriteNodeV2 = ModuleDeliveryNodeFields & {
  readonly kind: ModuleDeliveryTaskKind.Write;
  readonly cortexAuthoring?: ModuleDeliveryCortexAuthoring;
  readonly workspace: {
    readonly kind: ModuleDeliveryWorkspaceKind.SharedCheckout;
    readonly expectedCommitHandoff: true;
  };
};

export type ModuleDeliveryNodeV2 =
  | ModuleDeliveryReadOnlyNodeV2
  | ModuleDeliveryEvidenceSynthesisNodeV2
  | ModuleDeliveryWriteNodeV2;

export type ModuleDeliveryEdgeContract = {
  readonly providerTaskId: string;
  readonly consumerTaskId: string;
  readonly capability: string;
  readonly publicTypes: readonly string[];
  readonly errors: readonly string[];
  readonly behaviorInvariants: readonly string[];
  readonly securityInvariants: readonly string[];
  readonly compatibilityExpectations: readonly string[];
  readonly owningTests: readonly string[];
};

export type ModuleDeliveryParentJoin = {
  readonly kind: ModuleDeliveryJoinKind.DirectCommits;
  readonly owner: string;
  readonly validationCommands: readonly string[];
};

export type ModuleDeliveryPlanV3 = {
  readonly version: typeof MODULE_DELIVERY_PLAN_VERSION;
  readonly generation: number;
  readonly sourceCommit: string;
  readonly maxConcurrency: number;
  readonly maxAgentDepth: number;
  readonly maxAttempts: number;
  readonly parentOwnedResources: readonly string[];
  readonly parentJoin: ModuleDeliveryParentJoin;
  readonly nodes: readonly ModuleDeliveryNodeV2[];
  readonly edgeContracts: readonly ModuleDeliveryEdgeContract[];
};

export type LegacyModuleDeliveryResourceClaims = {
  readonly read: readonly string[];
  readonly write: readonly string[];
};

export type LegacyModuleDeliveryAcceptance = {
  readonly commands: readonly string[];
  readonly evidence: readonly string[];
};

type LegacyModuleDeliveryNodeFields = {
  readonly taskId: string;
  readonly expert: string;
  readonly moduleRoot: string;
  readonly consumerOutcome: string;
  readonly baseline: ModuleDeliveryBaseline;
  readonly agentDepthLimit: number;
  readonly dependencies: readonly string[];
  readonly resources: LegacyModuleDeliveryResourceClaims;
  readonly parentOwnedExclusions: readonly string[];
  readonly acceptance: LegacyModuleDeliveryAcceptance;
};

export type LegacyReadOnlyModuleDeliveryNode =
  LegacyModuleDeliveryNodeFields & {
    readonly kind: ModuleDeliveryTaskKind.ReadOnly;
  };

export type LegacyWriteModuleDeliveryNode = LegacyModuleDeliveryNodeFields & {
  readonly kind: ModuleDeliveryTaskKind.Write;
  readonly workspace: {
    readonly kind: ModuleDeliveryWorkspaceKind.SharedCheckout;
    readonly expectedCommitHandoff: true;
  };
};

export type LegacyModuleDeliveryNode =
  LegacyReadOnlyModuleDeliveryNode | LegacyWriteModuleDeliveryNode;

export type LegacyModuleDeliveryPlan = {
  readonly version: 1;
  readonly sourceCommit: string;
  readonly maxConcurrency: number;
  readonly maxAgentDepth: number;
  readonly maxAttempts: number;
  readonly parentOwnedResources: readonly string[];
  readonly parentJoin: ModuleDeliveryParentJoin;
  readonly nodes: readonly LegacyModuleDeliveryNode[];
  readonly edgeContracts: readonly ModuleDeliveryEdgeContract[];
};

export type ReadOnlyModuleDeliveryNode =
  LegacyReadOnlyModuleDeliveryNode | ModuleDeliveryReadOnlyNodeV2;
export type WriteModuleDeliveryNode =
  LegacyWriteModuleDeliveryNode | ModuleDeliveryWriteNodeV2;
export type ModuleDeliveryNode =
  LegacyModuleDeliveryNode | ModuleDeliveryNodeV2;

export type ModuleDeliveryPlanInput = ModuleDeliveryPlanV3;

export type ModuleDeliveryPlan = ModuleDeliveryPlanInput;

export enum ModuleDeliveryIssueCode {
  MalformedTransport = 'malformed-transport',
  InvalidField = 'invalid-field',
  DuplicateValue = 'duplicate-value',
  UnknownExpert = 'unknown-expert',
  ModuleOwnershipMismatch = 'module-ownership-mismatch',
  WriteScopeMismatch = 'write-scope-mismatch',
  BaselineMismatch = 'baseline-mismatch',
  MissingDependency = 'missing-dependency',
  SelfDependency = 'self-dependency',
  DependencyCycle = 'dependency-cycle',
  MissingEdgeContract = 'missing-edge-contract',
  UnexpectedEdgeContract = 'unexpected-edge-contract',
  ResourceConflict = 'resource-conflict',
  ParentOwnedWrite = 'parent-owned-write',
  MissingParentOwnedResource = 'missing-parent-owned-resource',
  LimitExceeded = 'limit-exceeded',
  EvidenceSurfaceMismatch = 'evidence-surface-mismatch',
  TeamOwnershipMismatch = 'team-ownership-mismatch',
  ParentLineageMismatch = 'parent-lineage-mismatch',
  EvidenceInputMismatch = 'evidence-input-mismatch',
  AcceptanceOwnershipMismatch = 'acceptance-ownership-mismatch',
}

export type ModuleDeliveryIssue = {
  readonly code: ModuleDeliveryIssueCode;
  readonly path: string;
  readonly message: string;
};

export enum ModuleDeliveryValidationStatus {
  Accepted = 'accepted',
  Rejected = 'rejected',
}

export enum ModuleDeliveryCompatibilityStatus {
  Decoded = 'decoded',
  Rejected = 'rejected',
}

export type DecodedCompatibleModuleDeliveryPlan = {
  readonly status: ModuleDeliveryCompatibilityStatus.Decoded;
  readonly inputVersion: ModuleDeliveryPlanInputVersion;
  readonly plan: ModuleDeliveryPlanV3;
};

export type RejectedCompatibleModuleDeliveryPlan = {
  readonly status: ModuleDeliveryCompatibilityStatus.Rejected;
  readonly issues: readonly ModuleDeliveryIssue[];
};

export type CompatibleModuleDeliveryPlanDecode =
  DecodedCompatibleModuleDeliveryPlan | RejectedCompatibleModuleDeliveryPlan;

export type ValidatedModuleDeliveryPlan = {
  readonly status: ModuleDeliveryValidationStatus.Accepted;
  readonly inputVersion: typeof MODULE_DELIVERY_PLAN_VERSION;
  readonly plan: ModuleDeliveryPlanV3;
  readonly planDigest: string;
  readonly topologicalOrder: readonly string[];
  readonly waves: readonly (readonly string[])[];
  readonly executionPrecedence: readonly ModuleDeliveryExecutionPrecedence[];
};

export enum ModuleDeliveryExecutionPrecedenceReason {
  DeclaredDependency = 'declared-dependency',
  EvidenceHazard = 'evidence-hazard',
  ResourceConflict = 'resource-conflict',
}

export type ModuleDeliveryExecutionPrecedence = {
  readonly predecessorTaskId: string;
  readonly successorTaskId: string;
  readonly reason: ModuleDeliveryExecutionPrecedenceReason;
  readonly requiresIntegratedWriterFrontier: boolean;
};

export type RejectedModuleDeliveryPlan = {
  readonly status: ModuleDeliveryValidationStatus.Rejected;
  readonly issues: readonly ModuleDeliveryIssue[];
};

export type ModuleDeliveryPlanValidation =
  ValidatedModuleDeliveryPlan | RejectedModuleDeliveryPlan;
