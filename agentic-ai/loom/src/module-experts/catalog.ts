export const MODULE_EXPERT_AGENT_INSTRUCTIONS = `Act only as the assigned read-only Nook module expert.
This definition supplies expert identity. The active harness owns expert creation, communication, and lifecycle.
Read .cortex/knowledge-graph.md first, then load the knowledge graph for the assigned engineering team. Resolve your role in .cortex/architecture/module-experts.md, then load only the listed authority anchors and project skills. Verify every claim against source at the task's exact commit.
Report the external API, dependencies, consumers, invariants, tests, risks, and parent actions.
Do not edit files, apply patches, or mutate Git, GitHub, Workbench, CI, deployment, or other external state. Delegate only inside the assigned task and harness-enforced depth bound. Optional Markdown is human evidence, never lifecycle state.`;

export type ModuleExpertProfile = {
  readonly name: string;
  readonly description: string;
  readonly agentDefinitionPath: string;
  readonly boundaryScopePaths: readonly string[];
  readonly canonicalContextPaths: readonly string[];
  readonly moduleRoots: readonly string[];
  readonly scopePaths: readonly string[];
  readonly generatedScopePaths: readonly ModuleExpertGeneratedScope[];
  readonly excludedPaths: readonly string[];
  readonly publicEntryPoints: readonly string[];
  readonly authorityPaths: readonly string[];
  readonly skillPaths: readonly string[];
  readonly validationSelectors: readonly string[];
};

export type ModuleExpertGeneratedScope = {
  readonly path: string;
  readonly producerPath: string;
  readonly producerContains: string;
  readonly sealedSelector: string;
  readonly workspaceMaterializerSelector: string;
  readonly productionSelector: string;
  readonly requiredMarkers: readonly ModuleExpertGeneratedMarker[];
};

export type ModuleExpertGeneratedMarker = {
  readonly path: string;
  readonly producerEvidence: readonly string[];
};

const PACKAGE_AUTHORITY_PATH = '.cortex/architecture/packages.md';
const EXPERT_AUTHORITY_PATH = '.cortex/architecture/module-experts.md';
const MODULE_EXPERT_SKILL_PATH = '.agents/skills/module-expert/SKILL.md';
const INTERNAL_API_SKILL_PATH = '.agents/skills/internal-api-expert/SKILL.md';
const DESIGN_TASTE_FRONTEND_SKILL_PATH =
  '.agents/skills/design-taste-frontend/SKILL.md';
const EXTENSION_RELEASE_SECURITY_SKILL_PATH =
  '.agents/skills/browser-extension-release-security/SKILL.md';
const RESEARCH_ROOT = 'nook-app/nook-web/nook-web-research';
const APP_COMMON_ROOT = 'nook-app/nook-platform/nook-app-common';
const AUTH2_ROOT = 'nook-app/nook-platform/nook-auth2';
const AUTHENTICATOR_DOMAIN_ROOT =
  'nook-app/nook-platform/nook-authenticator-domain';
const COMPANION_CORE_ROOT = 'nook-app/nook-platform/nook-companion-core';
const CORE_ROOT = 'nook-app/nook-platform/nook-core';
const EVENT_LOG_ROOT = 'nook-app/nook-platform/nook-event-log';
const REPLICATION_ROOT = 'nook-app/nook-platform/nook-replication';

const MODULE_EXPERT_SHARED_CONTEXT_PATHS = [
  '.cortex/dynamic-skills/module-expert.md',
  '.cortex/workflows/module-oriented-development.md',
] as const;

export const MODULE_EXPERT_CANONICAL_CONTEXT_PATHS = [
  '.cortex/dev-core/knowledge-graph.md',
  ...MODULE_EXPERT_SHARED_CONTEXT_PATHS,
] as const;

export const INTERNAL_API_EXPERT_CANONICAL_CONTEXT_PATHS = [
  '.cortex/dev-core/knowledge-graph.md',
  '.cortex/web-dev/knowledge-graph.md',
  '.cortex/dynamic-skills/internal-api-expert.md',
  ...MODULE_EXPERT_SHARED_CONTEXT_PATHS,
] as const;

export const WEB_EXPERT_CANONICAL_CONTEXT_PATHS = [
  '.cortex/AGENTS.md',
  '.cortex/web-dev/knowledge-graph.md',
  '.cortex/dynamic-skills/browser-extension-release-security.md',
  ...MODULE_EXPERT_SHARED_CONTEXT_PATHS,
] as const;

export const WEB_EXPERT_SKILL_PATHS = [
  MODULE_EXPERT_SKILL_PATH,
  DESIGN_TASTE_FRONTEND_SKILL_PATH,
  EXTENSION_RELEASE_SECURITY_SKILL_PATH,
] as const;

export const WEB_EXPERT_SKILL_AUTHORITY_PATHS = [
  '.cortex/AGENTS.md',
  EXPERT_AUTHORITY_PATH,
  '.cortex/dynamic-skills/browser-extension-release-security.md',
  ...MODULE_EXPERT_SHARED_CONTEXT_PATHS,
] as const;

export const WEB_EXPERT_AUTHORITY_PATHS = [
  PACKAGE_AUTHORITY_PATH,
  EXPERT_AUTHORITY_PATH,
] as const;

export const WEB_EXPERT_PRODUCT_SPEC_PATHS = [
  '.cortex/dev-core/product-specs/authenticator-items.md',
  '.cortex/web-dev/product-specs/browser-extension.md',
  '.cortex/dev-core/product-specs/credit-card-items.md',
  '.cortex/dev-core/product-specs/decentralized-auth.md',
  '.cortex/dev-core/product-specs/devices-and-access.md',
  '.cortex/dev-core/product-specs/file-attachments.md',
  '.cortex/dev-core/product-specs/password-envelope.md',
  '.cortex/dev-core/product-specs/password-manager.md',
  '.cortex/dev-core/product-specs/secure-notes.md',
  '.cortex/dev-core/product-specs/slip39-recovery.md',
  '.cortex/web-dev/product-specs/vault-app-isolation.md',
] as const;

export const WEB_EXPERT_RELEASE_AUTHORITY_PATHS = [
  '.github/scripts/ci-release-verify-extension.sh',
  '.github/workflows/main.yml',
  '.github/workflows/pr.yml',
  '.github/workflows/release.yml',
  '.task/ci-workflows.yml',
  'Taskfile.yml',
  'nook-app/ci/Taskfile.yml',
] as const;

export const WEB_EXPERT_SCOPE_PATHS = [
  ...WEB_EXPERT_PRODUCT_SPEC_PATHS,
  ...WEB_EXPERT_RELEASE_AUTHORITY_PATHS,
] as const;

export const INTERNAL_API_EXPERT_RUST_BOUNDARY_SCOPE_PATHS = [
  APP_COMMON_ROOT,
  AUTH2_ROOT,
  AUTHENTICATOR_DOMAIN_ROOT,
  COMPANION_CORE_ROOT,
  CORE_ROOT,
  EVENT_LOG_ROOT,
  REPLICATION_ROOT,
] as const;

const INTERNAL_API_EXPERT_AUTHORED_CONSUMER_SCOPE_PATHS = [
  'nook-app/nook-web/nook-vault-sentinel/src/extension-connect-disabled.ts',
  'nook-app/nook-web/nook-vault-sentinel/src/main.ts',
  'nook-app/nook-web/nook-vault-sentinel/vite.config.ts',
  'nook-app/nook-web/nook-vault-simple/src/main.ts',
  'nook-app/nook-web/nook-vault-simple/vite.config.ts',
  'nook-app/nook-web/nook-web-app/scripts/verify-app-isolation.ts',
  'nook-app/nook-web/nook-web-app/src/main.ts',
  'nook-app/nook-web/nook-web-app/vite.config.ts',
  'nook-app/nook-web/nook-web-extension/scripts/build.ts',
  'nook-app/nook-web/nook-web-extension/src/background/pairing-grants.ts',
  'nook-app/nook-web/nook-web-extension/src/background/service-worker/login-session-response-adapter.ts',
  'nook-app/nook-web/nook-web-extension/src/background/service-worker/pairing-import.ts',
  'nook-app/nook-web/nook-web-extension/src/background/service-worker/session-lifecycle.ts',
  'nook-app/nook-web/nook-web-extension/src/background/vault-runtime.ts',
  'nook-app/nook-web/nook-web-extension/src/content/autofill.ts',
  'nook-app/nook-web/nook-web-extension/src/content/autofill/authenticator-actions.ts',
  'nook-app/nook-web/nook-web-extension/src/content/autofill/login-passkey-actions.ts',
  'nook-app/nook-web/nook-web-extension/src/content/autofill/login-save.ts',
  'nook-app/nook-web/nook-web-extension/src/content/autofill/runtime-message-adapter.ts',
  'nook-app/nook-web/nook-web-extension/src/content/autofill/widget-rendering.ts',
  'nook-app/nook-web/nook-web-extension/src/content/autofill/workflow-ui.ts',
  'nook-app/nook-web/nook-web-extension/src/content/enrollment-backup-flow.ts',
  'nook-app/nook-web/nook-web-extension/src/content/enrollment-flow-view.ts',
  'nook-app/nook-web/nook-web-extension/src/content/enrollment-flow.ts',
  'nook-app/nook-web/nook-web-extension/src/content/enrollment-outcome.ts',
  'nook-app/nook-web/nook-web-extension/src/lib/auth-workflow-messages.ts',
  'nook-app/nook-web/nook-web-extension/src/lib/backup-code-candidates.ts',
  'nook-app/nook-web/nook-web-extension/src/lib/extension-session-message-type.ts',
  'nook-app/nook-web/nook-web-extension/src/lib/i18n.ts',
  'nook-app/nook-web/nook-web-extension/src/lib/login-save-messages.ts',
  'nook-app/nook-web/nook-web-extension/src/lib/nook-wasm.ts',
  'nook-app/nook-web/nook-web-extension/src/lib/outcome-evidence-messages.ts',
  'nook-app/nook-web/nook-web-extension/src/lib/provider-credential-staging.ts',
  'nook-app/nook-web/nook-web-extension/src/lib/simple-vault-target.ts',
  'nook-app/nook-web/nook-web-extension/src/manifest.ts',
  'nook-app/nook-web/nook-web-extension/src/offscreen/authenticator-enrollment-session.ts',
  'nook-app/nook-web/nook-web-extension/src/offscreen/login-save-offers.ts',
  'nook-app/nook-web/nook-web-extension/src/offscreen/session-message-dispatch.ts',
  'nook-app/nook-web/nook-web-extension/src/offscreen/session-operations.ts',
  'nook-app/nook-web/nook-web-extension/src/offscreen/session-request-adapter.ts',
  'nook-app/nook-web/nook-web-extension/src/offscreen/session-vault-operations.ts',
  'nook-app/nook-web/nook-web-extension/src/offscreen/session-website-passkey-operations.ts',
  'nook-app/nook-web/nook-web-extension/src/offscreen/session.ts',
  'nook-app/nook-web/nook-web-shared/src/extension/companion-ready.ts',
  'nook-app/nook-web/nook-web-shared/src/extension/extension-connect-scope.ts',
  'nook-app/nook-web/nook-web-shared/src/extension/lifecycle-runtime-messages.ts',
  'nook-app/nook-web/nook-web-shared/src/extension/password-form-fields.ts',
  'nook-app/nook-web/nook-web-shared/src/extension/password-forms.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/App.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/extension-connect-runtime.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/app/browser-lifecycle.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/auth/google/oauth.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/auth/icloud/oauth.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/auth/oauth-origin.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/auth/passkey-device-protection.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/auth/provider-types.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/auth/providers.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/AuthStorage.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/DeviceModeSelect.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/DeviceProtectionGate.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/DevicesAccessDashboard.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/ExtensionConnectConsent.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/HeaderLanguageSelect.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/LocalFolderMultipleVaultsDialog.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/LoginGate.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/OnboardDevice.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/ProviderPicker.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/SecretDetailRow.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/SecretVault.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/SeedPhraseGrid.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/VaultAdmin.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/VaultPasswordCard.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/VaultStatusBar.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/VaultSwitcher.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/VaultSyncConflictDialog.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/add-secret/secret-form-state.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/app/AppHeader.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/app/AuthenticatedVaultWorkspace.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/app/VaultAccessGate.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/app/VaultDialogs.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/devices-access/IdentityBridgeGraph.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/devices-access/IdentityBridgeNode.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/devices-access/access-chain.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/devices-access/identity-access-list.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/devices-access/identity-bridge-elements.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/devices-access/identity-directory-view.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/devices-access/identity-key-inventory.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/devices-access/passkey-card.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/login/LoginAuthorizationStep.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/login/LoginCreateVaultChooser.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/login/LoginProviderManagement.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/login/LoginUnlockStep.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/login/LoginVaultCard.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/login/LoginVaultPicker.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/login/RemoteVaultRecoveryPanel.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/login/SentinelCardStackDashboard.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/login/SentinelCeremonyPanel.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/login/SentinelGenesisJoinFlow.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/login/SentinelTerminalDashboard.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/login/login-unlock-state.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/onboard-device-state.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/onboard-device/OnboardDevicePasswordStep.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/settings/VaultDevicesCard.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/settings/VaultSettingsAccordion.svelte',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/vault-admin-state.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/vault-password-card-state.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/vault-switcher-state.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/enrollment/code.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/enrollment/sentinel-genesis-link.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/extension/connect.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/runtime/log.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/runtime/wasm-bootstrap.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/action-contexts.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/architecture-model.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/architecture.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/connection.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/creation-queue.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/device-protection.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/existing-vault-import.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/existing-vault-provider.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/idle-session.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/lifecycle.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/local-login.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/locale.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/login-unlock-capabilities.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/multi-device.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/oauth.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/password-enrollment-flow.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/password-enrollment-issue.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/password-enrollment.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/password-unlock.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/provider-connection.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/provider-selection.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/provider-sync.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/providers.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/runtime-state.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/secrets.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/sentinel-genesis.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/sentinel-unlock.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/session.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/state/lifecycle.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/state/provider.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/state/runtime.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/state/secrets.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/state/sentinel.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/state/session.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/state/sync.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/sync-conflict-label.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/sync-operation-state.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/sync-resolution.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/sync-runtime.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/sync.svelte.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/ui.ts',
  'nook-app/nook-web/nook-web-shared/src/vault-app/main.ts',
  'nook-app/nook-web/nook-web-shared/vite-config.ts',
] as const;

export const INTERNAL_API_EXPERT_JSON_CONSUMER_SCOPE_PATHS = [
  'nook-app/nook-web/nook-vault-sentinel/tsconfig.json',
  'nook-app/nook-web/nook-vault-simple/tsconfig.json',
  'nook-app/nook-web/nook-web-app/knip.json',
  'nook-app/nook-web/nook-web-app/tsconfig.app.json',
  'nook-app/nook-web/nook-web-app/tsconfig.json',
  'nook-app/nook-web/nook-web-extension/tsconfig.json',
  'nook-app/nook-web/tsconfig.eslint.json',
] as const;

export const INTERNAL_API_EXPERT_CONSUMER_SCOPE_PATHS: readonly string[] = [
  ...INTERNAL_API_EXPERT_AUTHORED_CONSUMER_SCOPE_PATHS,
  ...INTERNAL_API_EXPERT_JSON_CONSUMER_SCOPE_PATHS,
].sort();

export const MODULE_EXPERT_CATALOG: readonly ModuleExpertProfile[] = [
  {
    name: 'internal_api_expert',
    description:
      'Read-only expert for inter-module APIs, both WASM crates, generated bindings, TypeScript adapters, and consumer contracts.',
    agentDefinitionPath:
      '.codex/agents/module-experts/internal_api_expert.toml',
    boundaryScopePaths: INTERNAL_API_EXPERT_RUST_BOUNDARY_SCOPE_PATHS,
    canonicalContextPaths: INTERNAL_API_EXPERT_CANONICAL_CONTEXT_PATHS,
    moduleRoots: [
      'nook-app/nook-platform/nook-companion-wasm',
      'nook-app/nook-platform/nook-wasm',
    ],
    scopePaths: INTERNAL_API_EXPERT_CONSUMER_SCOPE_PATHS,
    generatedScopePaths: [
      {
        path: 'nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm',
        producerPath: 'nook-app/nook-platform/nook-wasm/Taskfile.yml',
        producerContains:
          '../../nook-web/nook-web-shared/src/extension/nook-companion-wasm',
        sealedSelector: 'wasm:build',
        workspaceMaterializerSelector: 'wasm:build:fast',
        productionSelector: 'wasm:build:prod',
        requiredMarkers: [
          {
            path: '.wasm-source-sha256',
            producerEvidence: [
              'companion_stamp="{{.WEB_SHARED_ROOT}}/src/extension/nook-companion-wasm/.wasm-source-sha256"',
              'echo "$desired" > "$companion_stamp"',
            ],
          },
          {
            path: 'nook_companion_wasm.js',
            producerEvidence: [
              'wasm-pack build nook-companion-wasm --target web --out-dir "../../nook-web/nook-web-shared/src/extension/nook-companion-wasm" --out-name nook_companion_wasm',
            ],
          },
          {
            path: 'nook_companion_wasm_bg.wasm',
            producerEvidence: [
              'wasm-pack build nook-companion-wasm --target web --out-dir "../../nook-web/nook-web-shared/src/extension/nook-companion-wasm" --out-name nook_companion_wasm',
              'companion_output="{{.WEB_SHARED_ROOT}}/src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm"',
            ],
          },
        ],
      },
      {
        path: 'nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm',
        producerPath: 'nook-app/nook-platform/nook-wasm/Taskfile.yml',
        producerContains:
          '../../nook-web/nook-web-shared/src/vault-app/lib/nook-wasm',
        sealedSelector: 'wasm:build',
        workspaceMaterializerSelector: 'wasm:build:fast',
        productionSelector: 'wasm:build:prod',
        requiredMarkers: [
          {
            path: '.wasm-source-sha256',
            producerEvidence: [
              'vault_stamp="{{.WEB_SHARED_ROOT}}/src/vault-app/lib/nook-wasm/.wasm-source-sha256"',
              'echo "$desired" > "$vault_stamp"',
            ],
          },
          {
            path: 'nook-wasm-build-mode',
            producerEvidence: [
              'vault_build_mode="{{.WEB_SHARED_ROOT}}/src/vault-app/lib/nook-wasm/nook-wasm-build-mode"',
              'echo "$stamp_mode" > "$vault_build_mode"',
            ],
          },
          {
            path: 'nook_wasm.js',
            producerEvidence: [
              'wasm-pack build nook-wasm --target web --out-dir "../../nook-web/nook-web-shared/src/vault-app/lib/nook-wasm" --out-name nook_wasm',
            ],
          },
          {
            path: 'nook_wasm_bg.wasm',
            producerEvidence: [
              'wasm-pack build nook-wasm --target web --out-dir "../../nook-web/nook-web-shared/src/vault-app/lib/nook-wasm" --out-name nook_wasm',
              'vault_output="{{.WEB_SHARED_ROOT}}/src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm"',
            ],
          },
        ],
      },
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
    boundaryScopePaths: [],
    canonicalContextPaths: MODULE_EXPERT_CANONICAL_CONTEXT_PATHS,
    moduleRoots: [APP_COMMON_ROOT],
    scopePaths: [],
    generatedScopePaths: [],
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
    boundaryScopePaths: [],
    canonicalContextPaths: MODULE_EXPERT_CANONICAL_CONTEXT_PATHS,
    moduleRoots: [AUTH2_ROOT],
    scopePaths: [],
    generatedScopePaths: [],
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
    boundaryScopePaths: [],
    canonicalContextPaths: MODULE_EXPERT_CANONICAL_CONTEXT_PATHS,
    moduleRoots: [AUTHENTICATOR_DOMAIN_ROOT],
    scopePaths: [],
    generatedScopePaths: [],
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
    boundaryScopePaths: [],
    canonicalContextPaths: MODULE_EXPERT_CANONICAL_CONTEXT_PATHS,
    moduleRoots: [REPLICATION_ROOT],
    scopePaths: [],
    generatedScopePaths: [],
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
    boundaryScopePaths: [],
    canonicalContextPaths: MODULE_EXPERT_CANONICAL_CONTEXT_PATHS,
    moduleRoots: [EVENT_LOG_ROOT],
    scopePaths: [],
    generatedScopePaths: [],
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
    boundaryScopePaths: [],
    canonicalContextPaths: MODULE_EXPERT_CANONICAL_CONTEXT_PATHS,
    moduleRoots: [COMPANION_CORE_ROOT],
    scopePaths: [],
    generatedScopePaths: [],
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
    boundaryScopePaths: [],
    canonicalContextPaths: MODULE_EXPERT_CANONICAL_CONTEXT_PATHS,
    moduleRoots: [CORE_ROOT],
    scopePaths: [],
    generatedScopePaths: [],
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
    boundaryScopePaths: [],
    canonicalContextPaths: WEB_EXPERT_CANONICAL_CONTEXT_PATHS,
    moduleRoots: [
      'nook-app/nook-web/nook-vault-sentinel',
      'nook-app/nook-web/nook-vault-simple',
      'nook-app/nook-web/nook-web-app',
      'nook-app/nook-web/nook-web-extension',
      'nook-app/nook-web/nook-web-shared',
    ],
    scopePaths: WEB_EXPERT_SCOPE_PATHS,
    generatedScopePaths: [],
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
    authorityPaths: WEB_EXPERT_AUTHORITY_PATHS,
    skillPaths: WEB_EXPERT_SKILL_PATHS,
    validationSelectors: ['web:check', 'web:test', 'extension:check'],
  },
];

export const MODULE_EXPERT_RESEARCH_ROOT = RESEARCH_ROOT;
