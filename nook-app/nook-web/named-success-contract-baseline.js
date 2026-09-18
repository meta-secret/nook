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
  {
    file: "nook-web-shared/src/vault-app/lib/app/workspace-route.ts",
    gitBlobSha1: "facdf1acdd824d7bb799c5f1d7a5e656af3b1a6f",
  },
  {
    file: "nook-web-shared/src/vault-app/lib/vault/identity-handoff.ts",
    gitBlobSha1: "bfb49a4e7a2a49629ab8a956baabb779da5c717e",
  },
  {
    file: "nook-web-shared/src/vault-app/lib/vault/provider-selection.svelte.ts",
    gitBlobSha1: "8ebb17c2f2be5123da7e1f86f38cae3199952d79",
  },
  {
    file: "nook-web-shared/src/vault-app/lib/vault/session.ts",
    gitBlobSha1: "faa5b93548ff491e1e06063bd519bf47d7141e8d",
  },
];
