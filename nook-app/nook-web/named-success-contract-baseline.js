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
  { file: 'nook-web-extension/src/offscreen/session-vault-operations.ts', gitBlobSha1: '5a398613f9a10c4a6700c0340ed68acb6a74b183' },
  { file: 'nook-web-shared/src/extension/event-log-bridge.ts', gitBlobSha1: '9c0ba97f5d2c67831846d56a250ec3daba854aac' },
  { file: 'nook-web-shared/src/vault-app/lib/app/workspace-route.ts', gitBlobSha1: 'facdf1acdd824d7bb799c5f1d7a5e656af3b1a6f' },
  { file: 'nook-web-shared/src/vault-app/lib/auth/google/oauth.ts', gitBlobSha1: 'c39c31f80c2e5994fc7dc683f6250ba2a09fbbbe' },
  { file: 'nook-web-shared/src/vault-app/lib/auth/passkey-device-protection.ts', gitBlobSha1: 'b9f16a802a269449fd6090ef7e6d659a5875e01d' },
  { file: 'nook-web-shared/src/vault-app/lib/components/DevicesAccessDashboard.svelte', gitBlobSha1: 'dd03adbba9c1ea85a4492ea6bb0b7a2d424c8077' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/LoginCreateVaultChooser.svelte', gitBlobSha1: '206806c2c5591da2398754d9d7953dab523ade51' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/SentinelGenesisJoinFlow.svelte', gitBlobSha1: '082c434976e4fe17e45183c4deb34270668aa53f' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/SentinelTerminalDashboard.svelte', gitBlobSha1: 'e92d35033670ee8c2596accb3ba7448ac204f96e' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/login-create-vault-chooser-contract.ts', gitBlobSha1: 'faecca9bd99aad4979e60f6b0a25f15331d6857e' },
  { file: 'nook-web-shared/src/vault-app/lib/components/settings/VaultDevicesCard.svelte', gitBlobSha1: '76336e5a57d02082d51f213c70fc8913e76900b8' },
  { file: 'nook-web-shared/src/vault-app/lib/components/settings/VaultSettingsAccordion.svelte', gitBlobSha1: 'cdabd104dc2de5ccccc3967d3712221f437fe077' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/sentinel-card-stack-contract.ts', gitBlobSha1: '48f3f75a34f131097d3e613e825c005745ee7588' },
  { file: 'nook-web-shared/src/vault-app/lib/runtime/browser-data.ts', gitBlobSha1: '1144f91978de089a554336bdbaf930ca89bc8c6b' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/device-protection.svelte.ts', gitBlobSha1: 'd646a48363c817756a77279d2335cafb7e90e9ae' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/identity-handoff.ts', gitBlobSha1: 'bfb49a4e7a2a49629ab8a956baabb779da5c717e' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/locale.ts', gitBlobSha1: 'b867e3700481fd8080302bababdf3a22990d3871' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/login-unlock-capabilities.ts', gitBlobSha1: '59cc83909dc1f7f3fdeb1b1a7efc537b08ad3067' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/provider-selection.svelte.ts', gitBlobSha1: '8ebb17c2f2be5123da7e1f86f38cae3199952d79' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/provider-sync.svelte.ts', gitBlobSha1: '23d0a1aab8b46345b64dd48d59e4d7c5cdf9d23d' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/multi-device.ts', gitBlobSha1: 'b45565a0721c49d24fff4cab4331f3e0ff85d657' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/session.ts', gitBlobSha1: 'faa5b93548ff491e1e06063bd519bf47d7141e8d' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/sentinel-genesis.ts', gitBlobSha1: '8fb5641baf8529ad9c3a2f96610db27eec409dcd' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/sentinel-unlock.ts', gitBlobSha1: '5c4c958b4ccf1b20a42849b52f79f4ca75913abe' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/ui.ts', gitBlobSha1: '7120b0b67626391fcff870b06303937b779c71ab' },
  { file: 'nook-web-shared/src/vault-app/main.ts', gitBlobSha1: '801cfd14053cb51325577b974bb74e08cb2f9537' },
]
