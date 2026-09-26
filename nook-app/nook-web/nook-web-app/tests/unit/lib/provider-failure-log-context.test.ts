import { expect, test } from 'vitest'
import { VaultStorageFailureKind } from '$lib/runtime/storage-failure'
import { ProviderFailureLogContext } from '$lib/vault/provider-failure-log-context'

test('includes the rejected GitHub token status in provider warning logs', () => {
  const context = ProviderFailureLogContext.from({
    provider_type: 'github',
    failure_kind: VaultStorageFailureKind.GitHubTokenRejected,
  })

  expect(context.serialize()).toBe(
    '{"provider_type":"github","failure_kind":"github-token-rejected","http_status":401}',
  )
})

test('omits the HTTP status for other provider failures', () => {
  const context = ProviderFailureLogContext.from({
    provider_type: 'github',
    failure_kind: VaultStorageFailureKind.OperationFailed,
  })

  expect(context.serialize()).toBe(
    '{"provider_type":"github","failure_kind":"operation-failed"}',
  )
})
