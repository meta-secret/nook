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
  { file: 'nook-web-extension/src/background/service-worker/account-pickers.ts', gitBlobSha1: '65febe242a681e206f241048f0cd3ece6b4fb55f' },
  { file: 'nook-web-extension/src/background/service-worker/authenticator-session-adapter.ts', gitBlobSha1: '23bb5ba1e44d21e8d6bc645eece69f2570f3ab93' },
  { file: 'nook-web-extension/src/background/service-worker/extension-lifecycle-routing.ts', gitBlobSha1: 'efc028b74d41316a7d7d9418fa5577dc33dbaea9' },
  { file: 'nook-web-extension/src/background/service-worker/pairing-identity.ts', gitBlobSha1: '26187f0a5e9f5933e1e7a6db297aa407b09a3adc' },
  { file: 'nook-web-extension/src/background/service-worker/passkey-session-adapter.ts', gitBlobSha1: '5709d3a505bc904031feef75867f8cf408ce3f88' },
  { file: 'nook-web-extension/src/background/service-worker/session-document.ts', gitBlobSha1: '31b38c844da190774a2b260ef5b278a04910b9a7' },
  { file: 'nook-web-extension/src/background/service-worker/session-lifecycle.ts', gitBlobSha1: 'ef7be9223c1570c86140a8c52634b6c1aea73c03' },
  { file: 'nook-web-extension/src/content/autofill/login-passkey-actions.ts', gitBlobSha1: '633f3810e88ffacaf1cf0110277f161ff60f1ea2' },
  { file: 'nook-web-extension/src/content/autofill/widget-rendering.ts', gitBlobSha1: 'b1b97a836054f972f8f1e50f208179e21d202b5a' },
  { file: 'nook-web-extension/src/lib/provider-credential-staging.ts', gitBlobSha1: '9e33cbe42733e250e12b52db73d4357d6b3844f0' },
  { file: 'nook-web-extension/src/offscreen/authenticator-enrollment-session.ts', gitBlobSha1: '935866a8069ab5f0b08846b9bdd43dc17d4671a4' },
  { file: 'nook-web-extension/src/offscreen/session-lease.ts', gitBlobSha1: '31ace004ee84763da821ca435ec23cba1257dfb5' },
  { file: 'nook-web-extension/src/offscreen/session-operations.ts', gitBlobSha1: 'eb770e06c0a633a3959600790e52b679575490af' },
  { file: 'nook-web-extension/src/offscreen/session-vault-operations.ts', gitBlobSha1: '5a398613f9a10c4a6700c0340ed68acb6a74b183' },
  { file: 'nook-web-extension/src/offscreen/session-website-passkey-operations.ts', gitBlobSha1: 'a18f2c6ca41efe039eda35dcf64999304a3596dc' },
  { file: 'nook-web-extension/src/offscreen/session.ts', gitBlobSha1: '6a24837db1577bc2ea794bc626eb5ef3110bffae' },
  { file: 'nook-web-shared/src/extension/event-log-bridge.ts', gitBlobSha1: '9c0ba97f5d2c67831846d56a250ec3daba854aac' },
  { file: 'nook-web-shared/src/extension/runtime-messages.ts', gitBlobSha1: 'b6c41438183ddfd1de96086cee0bc16e0045eda6' },
  { file: 'nook-web-shared/src/vault-app/lib/app/workspace-route.ts', gitBlobSha1: 'facdf1acdd824d7bb799c5f1d7a5e656af3b1a6f' },
  { file: 'nook-web-shared/src/vault-app/lib/auth/google/oauth.ts', gitBlobSha1: 'c39c31f80c2e5994fc7dc683f6250ba2a09fbbbe' },
  { file: 'nook-web-shared/src/vault-app/lib/auth/icloud/auth-state.ts', gitBlobSha1: '622ed437bc74c1f552ddee3c8b70d609a7e8293d' },
  { file: 'nook-web-shared/src/vault-app/lib/auth/icloud/cloudkit-runtime.ts', gitBlobSha1: '69347207bfab566ee2f9445bf3c3ced8f9865a60' },
  { file: 'nook-web-shared/src/vault-app/lib/auth/icloud/oauth.ts', gitBlobSha1: 'f64a1694fa343b3315e3edee728e6226644b44d5' },
  { file: 'nook-web-shared/src/vault-app/lib/auth/icloud/web-auth-wait.ts', gitBlobSha1: 'a7e71796b01dc1c47e238ce870a6c8556bc1da9c' },
  { file: 'nook-web-shared/src/vault-app/lib/auth/passkey-device-protection.ts', gitBlobSha1: 'b9f16a802a269449fd6090ef7e6d659a5875e01d' },
  { file: 'nook-web-shared/src/vault-app/lib/auth/providers.ts', gitBlobSha1: '2bfcdb4b46a8457574f48cc3398f51f3e6c42fbf' },
  { file: 'nook-web-shared/src/vault-app/lib/components/AddSecretForm.svelte', gitBlobSha1: '74a60d20248c5ea3114b8eb1e2c3ec2a20a99658' },
  { file: 'nook-web-shared/src/vault-app/lib/components/DevicesAccessDashboard.svelte', gitBlobSha1: 'dd03adbba9c1ea85a4492ea6bb0b7a2d424c8077' },
  { file: 'nook-web-shared/src/vault-app/lib/components/SecretDetailRow.svelte', gitBlobSha1: '7af628457fff823858e26123d8dac6c3a4cf287c' },
  { file: 'nook-web-shared/src/vault-app/lib/components/SecretVault.svelte', gitBlobSha1: 'eb23016e5809a4392e61ce1d09e14da0c710fc95' },
  { file: 'nook-web-shared/src/vault-app/lib/components/devices-access/identity-directory-view.ts', gitBlobSha1: '31fefd5a23492caaa811a602ddc0ec86224abd15' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/LoginCreateVaultChooser.svelte', gitBlobSha1: '206806c2c5591da2398754d9d7953dab523ade51' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/SentinelGenesisJoinFlow.svelte', gitBlobSha1: '082c434976e4fe17e45183c4deb34270668aa53f' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/SentinelTerminalDashboard.svelte', gitBlobSha1: 'e92d35033670ee8c2596accb3ba7448ac204f96e' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/login-create-vault-chooser-contract.ts', gitBlobSha1: 'faecca9bd99aad4979e60f6b0a25f15331d6857e' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/login-vault-identity-context.ts', gitBlobSha1: 'a9cc1d23810d592e69f1fe043e1761616b4fd135' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/sentinel-card-stack-contract.ts', gitBlobSha1: '48f3f75a34f131097d3e613e825c005745ee7588' },
  { file: 'nook-web-shared/src/vault-app/lib/extension/connect.ts', gitBlobSha1: 'f6c3c159d05af6efa46c17e4c0df3ff34d91ae00' },
  { file: 'nook-web-shared/src/vault-app/lib/extension/vault-approval.ts', gitBlobSha1: '83fcddfc185c0404b51d33558a389496a4543b70' },
  { file: 'nook-web-shared/src/vault-app/lib/nook.ts', gitBlobSha1: '2a7dc37b4fb1c21827047d4f8779f6ebf2ca1017' },
  { file: 'nook-web-shared/src/vault-app/lib/runtime/browser-data.ts', gitBlobSha1: '1144f91978de089a554336bdbaf930ca89bc8c6b' },
  { file: 'nook-web-shared/src/vault-app/lib/runtime/wasm-bootstrap.ts', gitBlobSha1: '3984df440674aee7883678bb507e49b33981b477' },
  { file: 'nook-web-shared/src/vault-app/lib/vault.svelte.ts', gitBlobSha1: 'c115d6710f5ef4ead4fceb52662312d598c85f8c' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/action-contexts.ts', gitBlobSha1: 'cd6f6b522c7ca10f11a8bc6868113d8017fca5a5' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/architecture.ts', gitBlobSha1: 'dd751cb30ee3ca8c33b4a5a25b2dcbd7a642a2c6' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/device-protection.svelte.ts', gitBlobSha1: 'd646a48363c817756a77279d2335cafb7e90e9ae' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/existing-vault-provider.svelte.ts', gitBlobSha1: '3e4ee470169adf92e9521604eadde19bdb76f803' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/identity-handoff.ts', gitBlobSha1: 'bfb49a4e7a2a49629ab8a956baabb779da5c717e' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/lifecycle.ts', gitBlobSha1: '6c3d9615c419c59d53d4b8af99e68827e7965712' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/local-login.ts', gitBlobSha1: '1f26459d9e7515e4b07b8e386a4c4644b006e84a' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/locale.ts', gitBlobSha1: 'b867e3700481fd8080302bababdf3a22990d3871' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/login-unlock-capabilities.ts', gitBlobSha1: '59cc83909dc1f7f3fdeb1b1a7efc537b08ad3067' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/oauth.ts', gitBlobSha1: '08db30dd0e9fdf1d50499456102683dbd6f324bd' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/provider-selection.svelte.ts', gitBlobSha1: '8ebb17c2f2be5123da7e1f86f38cae3199952d79' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/provider-sync.svelte.ts', gitBlobSha1: '23d0a1aab8b46345b64dd48d59e4d7c5cdf9d23d' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/provider-vault-decision.ts', gitBlobSha1: '2154a26355b1d76c5c6a4a0b216c6fbcc5b182e9' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/providers.svelte.ts', gitBlobSha1: 'c70df7fa0dabb26207cd530fd08593516da487b5' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/runtime-state.svelte.ts', gitBlobSha1: '3dc7fd8d6134f90690f9fef4206e1e8cac37ef05' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/secret-exposure.ts', gitBlobSha1: '413834d63dddd4d22806fa7c9cb04facf4bc5c08' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/secrets.ts', gitBlobSha1: '4eab5e87df2e78e40705ead77858044e0954d5a4' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/sentinel-genesis.ts', gitBlobSha1: '8fb5641baf8529ad9c3a2f96610db27eec409dcd' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/sentinel-unlock.ts', gitBlobSha1: '5c4c958b4ccf1b20a42849b52f79f4ca75913abe' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/state/session.svelte.ts', gitBlobSha1: 'd311796bee96f406e42fb04128f8aae106b13fff' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/sync-extension-bridge.ts', gitBlobSha1: '13ee51a925ebbb41e71ea337d09793e9360abaa7' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/sync-runtime.ts', gitBlobSha1: '2b2df3b90a39975b31a3241ed3a1f8f053390e76' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/sync.svelte.ts', gitBlobSha1: 'b99d61ddbc8a2372fe40650981fa428691e94c65' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/ui.ts', gitBlobSha1: '7120b0b67626391fcff870b06303937b779c71ab' },
  { file: 'nook-web-shared/src/vault-app/main.ts', gitBlobSha1: '801cfd14053cb51325577b974bb74e08cb2f9537' },
]
