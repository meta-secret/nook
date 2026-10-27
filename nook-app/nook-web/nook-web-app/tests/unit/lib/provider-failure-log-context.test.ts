import { expect, test } from 'vitest'
import {
  NativeVaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { ProviderFailureLogContext } from '$lib/vault/provider-failure-log-context'

test('includes the rejected GitHub token status in provider warning logs', () => {
  const context = ProviderFailureLogContext.from({
    provider_type: 'github',
    failure_kind: VaultStorageFailureKind.GitHubTokenRejected,
    cause: 'unauthorized',
  })

  expect(context.serialize()).toBe(
    '{"provider_type":"github","failure_kind":"github-token-rejected","cause":"unauthorized","http_status":401}',
  )
})

test('omits the HTTP status for other provider failures', () => {
  const context = ProviderFailureLogContext.from({
    provider_type: 'github',
    failure_kind: VaultStorageFailureKind.OperationFailed,
    cause: 'network',
  })

  expect(context.serialize()).toBe(
    '{"provider_type":"github","failure_kind":"operation-failed","cause":"network"}',
  )
})

test('logs what broke a native provider failure without its message', () => {
  const failure = new NativeVaultStorageFailure(
    new Error(
      'Drive error: Google Drive API responded with status 403 Forbidden for passwords.yaml',
    ),
  )
  const context = ProviderFailureLogContext.from({
    provider_type: 'google_drive',
    failure_kind: failure.kind,
    cause: failure.cause,
  })

  expect(context.serialize()).toBe(
    '{"provider_type":"google_drive","failure_kind":"operation-failed","cause":"forbidden"}',
  )
})
