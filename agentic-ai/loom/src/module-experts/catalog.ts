export const MODULE_EXPERT_AGENT_INSTRUCTIONS = `Act only as the assigned read-only Nook module expert.
Read .cortex/knowledge-graph.md first. Resolve your role in .cortex/architecture/module-experts.md, then load only the listed authority anchors and project skills. Verify every claim against source at the task's exact commit.
Report the external API, dependencies, consumers, invariants, tests, risks, and parent actions.
Do not edit files, apply patches, delegate, schedule work, write workflow processing, or mutate Git, GitHub, Workbench, CI, deployment, or other external state. Markdown is evidence, never scheduler state.`;

export type ModuleExpertProfile = {
  readonly name: string;
  readonly description: string;
  readonly agentDefinitionPath: string;
  readonly moduleRoots: readonly string[];
  readonly scopePaths: readonly string[];
  readonly excludedPaths: readonly string[];
  readonly publicEntryPoints: readonly string[];
  readonly authorityPaths: readonly string[];
  readonly skillPaths: readonly string[];
  readonly validationSelectors: readonly string[];
};

const PACKAGE_AUTHORITY_PATH = '.cortex/architecture/packages.md';
const EXPERT_AUTHORITY_PATH = '.cortex/architecture/module-experts.md';
const MODULE_EXPERT_SKILL_PATH = '.agents/skills/module-expert/SKILL.md';
const INTERNAL_API_SKILL_PATH = '.agents/skills/internal-api-expert/SKILL.md';
const RESEARCH_ROOT = 'nook-app/nook-web/nook-web-research';

export const MODULE_EXPERT_CATALOG: readonly ModuleExpertProfile[] = [
  {
    name: 'internal_api_expert',
    description:
      'Read-only expert for inter-module APIs, both WASM crates, generated bindings, TypeScript adapters, and consumer contracts.',
    agentDefinitionPath:
      '.codex/agents/module-experts/internal_api_expert.toml',
    moduleRoots: [
      'nook-app/nook-platform/nook-companion-wasm',
      'nook-app/nook-platform/nook-wasm',
    ],
    scopePaths: [
      'nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm',
      'nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm',
    ],
    excludedPaths: [RESEARCH_ROOT],
    publicEntryPoints: [
      'nook-app/nook-platform/nook-companion-wasm/src/lib.rs',
      'nook-app/nook-platform/nook-wasm/src/lib.rs',
    ],
    authorityPaths: [PACKAGE_AUTHORITY_PATH, EXPERT_AUTHORITY_PATH],
    skillPaths: [MODULE_EXPERT_SKILL_PATH, INTERNAL_API_SKILL_PATH],
    validationSelectors: ['rust:lint', 'web:check', 'web:test'],
  },
  {
    name: 'app_common_expert',
    description:
      'Read-only expert for nook-app-common localization and dependency-light shared primitives.',
    agentDefinitionPath: '.codex/agents/module-experts/app_common_expert.toml',
    moduleRoots: ['nook-app/nook-platform/nook-app-common'],
    scopePaths: [],
    excludedPaths: [],
    publicEntryPoints: ['nook-app/nook-platform/nook-app-common/src/lib.rs'],
    authorityPaths: [PACKAGE_AUTHORITY_PATH, EXPERT_AUTHORITY_PATH],
    skillPaths: [MODULE_EXPERT_SKILL_PATH],
    validationSelectors: ['rust:test', 'rust:lint'],
  },
  {
    name: 'auth2_expert',
    description:
      'Read-only expert for nook-auth2 identity, authorization, app-key protection, and recovery contracts.',
    agentDefinitionPath: '.codex/agents/module-experts/auth2_expert.toml',
    moduleRoots: ['nook-app/nook-platform/nook-auth2'],
    scopePaths: [],
    excludedPaths: [],
    publicEntryPoints: ['nook-app/nook-platform/nook-auth2/src/lib.rs'],
    authorityPaths: [PACKAGE_AUTHORITY_PATH, EXPERT_AUTHORITY_PATH],
    skillPaths: [MODULE_EXPERT_SKILL_PATH],
    validationSelectors: ['rust:test', 'rust:lint'],
  },
  {
    name: 'authenticator_domain_expert',
    description:
      'Read-only expert for nook-authenticator-domain portable authenticator policy and value types.',
    agentDefinitionPath:
      '.codex/agents/module-experts/authenticator_domain_expert.toml',
    moduleRoots: ['nook-app/nook-platform/nook-authenticator-domain'],
    scopePaths: [],
    excludedPaths: [],
    publicEntryPoints: [
      'nook-app/nook-platform/nook-authenticator-domain/src/lib.rs',
    ],
    authorityPaths: [PACKAGE_AUTHORITY_PATH, EXPERT_AUTHORITY_PATH],
    skillPaths: [MODULE_EXPERT_SKILL_PATH],
    validationSelectors: ['rust:test', 'rust:lint'],
  },
  {
    name: 'replication_expert',
    description:
      'Read-only expert for nook-replication provider-neutral causal and replica mechanics.',
    agentDefinitionPath: '.codex/agents/module-experts/replication_expert.toml',
    moduleRoots: ['nook-app/nook-platform/nook-replication'],
    scopePaths: [],
    excludedPaths: [],
    publicEntryPoints: ['nook-app/nook-platform/nook-replication/src/lib.rs'],
    authorityPaths: [PACKAGE_AUTHORITY_PATH, EXPERT_AUTHORITY_PATH],
    skillPaths: [MODULE_EXPERT_SKILL_PATH],
    validationSelectors: ['rust:test', 'rust:lint'],
  },
  {
    name: 'event_log_expert',
    description:
      'Read-only expert for nook-event-log signed history, authorization graph, projection, and storage bytes.',
    agentDefinitionPath: '.codex/agents/module-experts/event_log_expert.toml',
    moduleRoots: ['nook-app/nook-platform/nook-event-log'],
    scopePaths: [],
    excludedPaths: [],
    publicEntryPoints: ['nook-app/nook-platform/nook-event-log/src/lib.rs'],
    authorityPaths: [PACKAGE_AUTHORITY_PATH, EXPERT_AUTHORITY_PATH],
    skillPaths: [MODULE_EXPERT_SKILL_PATH],
    validationSelectors: ['rust:test', 'rust:lint'],
  },
  {
    name: 'companion_core_expert',
    description:
      'Read-only expert for nook-companion-core extension companion policy and protocol-domain contracts.',
    agentDefinitionPath:
      '.codex/agents/module-experts/companion_core_expert.toml',
    moduleRoots: ['nook-app/nook-platform/nook-companion-core'],
    scopePaths: [],
    excludedPaths: [],
    publicEntryPoints: [
      'nook-app/nook-platform/nook-companion-core/src/lib.rs',
    ],
    authorityPaths: [PACKAGE_AUTHORITY_PATH, EXPERT_AUTHORITY_PATH],
    skillPaths: [MODULE_EXPERT_SKILL_PATH],
    validationSelectors: ['rust:test', 'rust:lint'],
  },
  {
    name: 'core_expert',
    description:
      'Read-only expert for nook-core vault, secrets, sync, crypto, and application-service contracts.',
    agentDefinitionPath: '.codex/agents/module-experts/core_expert.toml',
    moduleRoots: ['nook-app/nook-platform/nook-core'],
    scopePaths: [],
    excludedPaths: [],
    publicEntryPoints: ['nook-app/nook-platform/nook-core/src/lib.rs'],
    authorityPaths: [PACKAGE_AUTHORITY_PATH, EXPERT_AUTHORITY_PATH],
    skillPaths: [MODULE_EXPERT_SKILL_PATH],
    validationSelectors: ['rust:test', 'rust:lint'],
  },
  {
    name: 'web_expert',
    description:
      'Read-only expert for production Nook Svelte and TypeScript packages; excludes research and generated-binding adaptation.',
    agentDefinitionPath: '.codex/agents/module-experts/web_expert.toml',
    moduleRoots: [
      'nook-app/nook-web/nook-vault-sentinel',
      'nook-app/nook-web/nook-vault-simple',
      'nook-app/nook-web/nook-web-app',
      'nook-app/nook-web/nook-web-extension',
      'nook-app/nook-web/nook-web-shared',
    ],
    scopePaths: [],
    excludedPaths: [
      RESEARCH_ROOT,
      'nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm',
      'nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm',
    ],
    publicEntryPoints: [
      'nook-app/nook-web/nook-vault-sentinel/package.json',
      'nook-app/nook-web/nook-vault-simple/package.json',
      'nook-app/nook-web/nook-web-app/package.json',
      'nook-app/nook-web/nook-web-extension/package.json',
      'nook-app/nook-web/nook-web-shared/package.json',
    ],
    authorityPaths: [PACKAGE_AUTHORITY_PATH, EXPERT_AUTHORITY_PATH],
    skillPaths: [MODULE_EXPERT_SKILL_PATH],
    validationSelectors: ['web:check', 'web:test', 'extension:check'],
  },
];

export const MODULE_EXPERT_RESEARCH_ROOT = RESEARCH_ROOT;
