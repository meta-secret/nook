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
  { file: 'nook-web-shared/src/extension/event-log-bridge.ts', gitBlobSha1: '9c0ba97f5d2c67831846d56a250ec3daba854aac' },
  { file: 'nook-web-shared/src/vault-app/lib/app/workspace-route.ts', gitBlobSha1: 'facdf1acdd824d7bb799c5f1d7a5e656af3b1a6f' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/SentinelGenesisJoinFlow.svelte', gitBlobSha1: '082c434976e4fe17e45183c4deb34270668aa53f' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/login-create-vault-chooser-contract.ts', gitBlobSha1: 'faecca9bd99aad4979e60f6b0a25f15331d6857e' },
  { file: 'nook-web-shared/src/vault-app/lib/components/settings/VaultSettingsAccordion.svelte', gitBlobSha1: 'cdabd104dc2de5ccccc3967d3712221f437fe077' },
  { file: 'nook-web-shared/src/vault-app/lib/components/login/sentinel-card-stack-contract.ts', gitBlobSha1: '48f3f75a34f131097d3e613e825c005745ee7588' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/identity-handoff.ts', gitBlobSha1: 'bfb49a4e7a2a49629ab8a956baabb779da5c717e' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/provider-selection.svelte.ts', gitBlobSha1: '8ebb17c2f2be5123da7e1f86f38cae3199952d79' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/multi-device.ts', gitBlobSha1: 'b45565a0721c49d24fff4cab4331f3e0ff85d657' },
  { file: 'nook-web-shared/src/vault-app/lib/vault/session.ts', gitBlobSha1: 'faa5b93548ff491e1e06063bd519bf47d7141e8d' },
]
