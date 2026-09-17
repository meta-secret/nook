/**
 * Exact source snapshots containing legacy findings from the
 * typed-success-contract audit.
 *
 * An entry is accepted only when the complete source file still has the
 * recorded Git blob identity and the typed rule still finds at least one
 * violation. Any edit invalidates suppression for every finding in that
 * file. A stale entry is an error, so fixed findings must be removed.
 * The source audit stores no unverified checker counts; a future verified
 * lint run can tighten the snapshots if finding-count precision is needed.
 *
 * @typedef {{ file: string, gitBlobSha1: string }} NamedSuccessContractBaselineEntry
 */

/** @type {readonly NamedSuccessContractBaselineEntry[]} */
export const namedSuccessContractBaseline = [
  { file: 'nook-web-extension/src/offscreen/session-vault-operations.ts', gitBlobSha1: 'daa0877ceeb87be78b81f106e2029624216f6c12' },
  { file: 'nook-web-shared/src/extension/event-log-bridge.ts', gitBlobSha1: '9c0ba97f5d2c67831846d56a250ec3daba854aac' },
  { file: 'nook-web-shared/src/vault-app/lib/app/browser-lifecycle.ts', gitBlobSha1: 'd4ecd09e578f84ca12eb11c77eac0c3520722938' },
  { file: 'nook-web-shared/src/vault-app/lib/app/workspace-route.ts', gitBlobSha1: 'facdf1acdd824d7bb799c5f1d7a5e656af3b1a6f' },
  { file: 'nook-web-shared/src/vault-app/lib/auth/google/oauth.ts', gitBlobSha1: '11638f312bd90609f104169ad98e29a3ce216fd9' },
  { file: 'nook-web-shared/src/vault-app/lib/auth/passkey-device-protection.ts', gitBlobSha1: 'dd2547f07c56eaebe7ec213fb0a14c6e754f54fb' },
  { file: 'nook-web-shared/src/vault-app/lib/auth/providers.ts', gitBlobSha1: '2bfcdb4b46a8457574f48cc3398f51f3e6c42fbf' },
  { file: 'nook-web-shared/src/vault-app/lib/components/AddSecretForm.svelte', gitBlobSha1: '74a60d20248c5ea3114b8eb1e2c3ec2a20a99658' },
  { file: 'nook-web-shared/src/vault-app/lib/components/DevicesAccessDashboard.svelte', gitBlobSha1: 'cc0207c2eff1a0dc1c9fb3a8daa631855716babb' },
  { file: 'nook-web-shared/src/vault-app/lib/components/SecretDetailRow.svelte', gitBlobSha1: '7af628457fff823858e26123d8dac6c3a4cf287c' },
  { file: 'nook-web-shared/src/vault-app/lib/components/SecretVault.svelte', gitBlobSha1: '433ea102f6fc11b4dd8814c5f3b171736c48c7a6' },
  { file: 'nook-web-shared/src/vault-app/lib/components/OnboardDevice.svelte', gitBlobSha1: 'd51b6807d064f9121d0bbd129e11b95c6cdef9fe' },
  { file: 'nook-web-shared/src/vault-app/lib/components/VaultAdmin.svelte', gitBlobSha1: '511ed18f37179d8951b4b5c939f96cdb33624e2e' },
  { file: 'nook-web-shared/src/vault-app/lib/components/VaultPasswordCard.svelte', gitBlobSha1: '2132bbe3146b21fddf30be66188980f48ca13d13' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/LoginCreateVaultChooser.svelte', gitBlobSha1: '655715853b43247717290c3804d5bd5b0e06ad25' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/SentinelGenesisJoinFlow.svelte', gitBlobSha1: '082c434976e4fe17e45183c4deb34270668aa53f' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/SentinelTerminalDashboard.svelte', gitBlobSha1: 'c99db64363b0b7ce415af6fb21bb39fea8490296' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/login-create-vault-chooser-contract.ts', gitBlobSha1: 'faecca9bd99aad4979e60f6b0a25f15331d6857e' },
  { file: 'nook-web-shared/src/vault-app/lib/components/onboard-device/OnboardDevicePasswordStep.svelte', gitBlobSha1: '24fe193872e9b9a51381c6c9ae4420ed3d13ed0f' },
  { file: 'nook-web-shared/src/vault-app/lib/components/settings/VaultDevicesCard.svelte', gitBlobSha1: '78efb06975cf7e1af4fde2f1ee4fc324ad4acd4a' },
  { file: 'nook-web-shared/src/vault-app/lib/components/settings/VaultSettingsAccordion.svelte', gitBlobSha1: 'cdabd104dc2de5ccccc3967d3712221f437fe077' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/sentinel-card-stack-contract.ts', gitBlobSha1: '48f3f75a34f131097d3e613e825c005745ee7588' },
  { file: 'nook-web-shared/src/vault-app/lib/runtime/browser-data.ts', gitBlobSha1: '3bdba3fca023aa57610bab43fe885b7afeb1975e' },
  { file: 'nook-web-shared/src/vault-app/lib/vault.svelte.ts', gitBlobSha1: 'c9206a0b4ed790b27730be190e5e71b70dce3237' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/action-contexts.ts', gitBlobSha1: 'cd6f6b522c7ca10f11a8bc6868113d8017fca5a5' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/architecture.ts', gitBlobSha1: 'f8423d47ea924b381c5ba1dd22b8a43077b7f9c8' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/device-protection.svelte.ts', gitBlobSha1: 'c49b08a3165a1682f105c089abe1ec083f9b3bf0' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/identity-handoff.ts', gitBlobSha1: 'bfb49a4e7a2a49629ab8a956baabb779da5c717e' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/lifecycle.ts', gitBlobSha1: '7ca8b3e840e79aeaa5e45eb7069e54891f88daa3' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/local-login.ts', gitBlobSha1: '6b6d69099eedf1863d85e5f83f30c534cca45506' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/login-unlock-capabilities.ts', gitBlobSha1: '23c173550f97b0017608511f7c806959414c890b' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/provider-selection.svelte.ts', gitBlobSha1: '8ebb17c2f2be5123da7e1f86f38cae3199952d79' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/provider-sync.svelte.ts', gitBlobSha1: '80609c2910e213a47683a2244f789b030607ad3d' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/multi-device.ts', gitBlobSha1: 'b45565a0721c49d24fff4cab4331f3e0ff85d657' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/password-enrollment-issue.ts', gitBlobSha1: 'b1a60427ce71c6c46092819358cf521d7f4c3005' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/password-unlock.ts', gitBlobSha1: '75aafb4c9291365dff2a01d98c2ed6259aef6481' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/providers.svelte.ts', gitBlobSha1: 'f18a7c0b0bd4dfee4f62198a153b4f5854a50ac7' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/runtime-state.svelte.ts', gitBlobSha1: '668807a960995f0ecaf42727bbfabcddfe3536f7' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/session.ts', gitBlobSha1: 'faa5b93548ff491e1e06063bd519bf47d7141e8d' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/secrets.ts', gitBlobSha1: '50911e7d0bd0cab2cda4fa46814c07c447dfb58c' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/sentinel-genesis.ts', gitBlobSha1: '144c4e48e228cdb25ddb9a1d2ed1f7bed4f1662a' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/sentinel-unlock.ts', gitBlobSha1: 'fc0110544d24b36ceb7d87128ad46333a6810a34' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/sync-resolution.ts', gitBlobSha1: 'ac0cb81e465477242c12d2c21c829c1605676f78' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/sync-extension-bridge.ts', gitBlobSha1: '78324f74811d90b6eead4ae509eba549851f6cfb' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/sync-runtime.ts', gitBlobSha1: '2b2df3b90a39975b31a3241ed3a1f8f053390e76' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/sync.svelte.ts', gitBlobSha1: '7e8a4af81b5c00694fbcf68ee0686197a1577801' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/ui.ts', gitBlobSha1: '6a8ba87e12276bdc94128a11d0d7a188b882cc99' },
  { file: 'nook-web-shared/src/vault-app/main.ts', gitBlobSha1: '6e0d9a3acb0a9d6e7b904d44c086261c0d93884d' },
]
