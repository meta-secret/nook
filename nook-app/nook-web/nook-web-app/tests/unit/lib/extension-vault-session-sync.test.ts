import { expect, test, vi } from 'vitest'
import { Deferred, Effect } from 'effect'
import { err, ok } from 'neverthrow'
import {
  ExtensionVaultSessionSynchronization,
  ExtensionVaultSessionPublication,
} from '$lib/vault/sync-extension-session'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { InstalledExtensionRuntimeKind } from '$lib/extension/connect'
import { VaultType } from '$lib/vault/architecture-model'
import type { ExtensionVaultEventLogResponse } from '$app-wasm'
import type { SecretPageRefreshSnapshot } from '$lib/vault/action-contexts'
import { NookExternalEventLogRecords } from '$app-wasm'

class ExtensionVaultSessionSyncFixture {
  readonly order: string[] = []
  readonly resource = { free: vi.fn() }
  readonly merge = vi.fn(async (records: NookExternalEventLogRecords) => {
    records.free()
    this.order.push('merge')
    return this.resource
  })
  readonly refresh = vi.fn(async () => {
    this.order.push('refresh')
    const summary: SecretPageRefreshSnapshot = {
      displayedSecretCount: 1,
      totalSecretCount: 1,
      pageOffset: 0,
      query: '',
    }
    return ok(summary)
  })
  readonly manager = {
    vaultStoreId: 'store_local',
    sync_external_event_log_records_js: this.merge,
  }
  readonly state: ConstructorParameters<
    typeof ExtensionVaultSessionSynchronization
  >[0]['state'] = {
    isAuthenticated: true,
    sessionEpoch: 1,
    vaultArchitecture: { vault_type: VaultType.Simple },
    admitManager: () => ok(this.manager),
    enqueueStorage: (operation) => operation(),
    refreshSecretsFromSession: this.refresh,
  }
  readonly pull = vi.fn(() => {
    this.order.push('pull')
    const response: ExtensionVaultEventLogResponse = {
      kind: 'Exported',
      vault_store_id: 'store_local',
      event_log_records: [],
    }
    return Effect.succeed(response)
  })

  operation(): ExtensionVaultSessionSynchronization {
    const request: ConstructorParameters<
      typeof ExtensionVaultSessionSynchronization
    >[0] = {
      state: this.state,
      channel: { pull: this.pull },
      installedRuntime: () => ({
        kind: InstalledExtensionRuntimeKind.Installed,
        extensionRuntimeId: 'extension-runtime',
      }),
      from_array: NookExternalEventLogRecords.from_array,
    }
    return new ExtensionVaultSessionSynchronization(request)
  }
}

test('imports extension events and refreshes the local website vault even without remote providers', async () => {
  const fixture = new ExtensionVaultSessionSyncFixture()
  await Effect.runPromise(fixture.operation().run())
  const order: string[] = ['pull', 'merge', 'refresh']
  expect(fixture.order).toEqual(order)
  expect(fixture.resource.free).toHaveBeenCalledTimes(1)
})

test('rejects a lock that occurs while the extension response is outstanding', async () => {
  const fixture = new ExtensionVaultSessionSyncFixture()
  fixture.pull.mockImplementation(() => {
    fixture.state.sessionEpoch += 1
    fixture.state.isAuthenticated = false
    const response: ExtensionVaultEventLogResponse = {
      kind: 'Exported',
      vault_store_id: 'store_local',
      event_log_records: [],
    }
    return Effect.succeed(response)
  })
  const result = await Effect.runPromise(
    Effect.result(fixture.operation().run()),
  )
  expect(result._tag).toBe('Failure')
  expect(fixture.merge).not.toHaveBeenCalled()
  expect(fixture.refresh).not.toHaveBeenCalled()
})

test('checks the requested store again inside queued import after a vault switch', async () => {
  const fixture = new ExtensionVaultSessionSyncFixture()
  fixture.state.enqueueStorage = (operation) => {
    fixture.manager.vaultStoreId = 'store_other'
    return operation()
  }
  const result = await Effect.runPromise(
    Effect.result(fixture.operation().run()),
  )
  expect(result._tag).toBe('Failure')
  expect(fixture.merge).not.toHaveBeenCalled()
  expect(fixture.refresh).not.toHaveBeenCalled()
})

test('a failed extension export stays observable and never refreshes a misleading empty page', async () => {
  const fixture = new ExtensionVaultSessionSyncFixture()
  const rejected: ExtensionVaultEventLogResponse = {
    kind: 'Rejected',
    reason: 'AccessDenied',
  }
  const channel: ConstructorParameters<
    typeof ExtensionVaultSessionSynchronization
  >[0]['channel'] = {
    pull: () => Effect.succeed(rejected),
  }
  const installedRuntime: ConstructorParameters<
    typeof ExtensionVaultSessionSynchronization
  >[0]['installedRuntime'] = () => ({
    kind: InstalledExtensionRuntimeKind.Installed,
    extensionRuntimeId: 'extension-runtime',
  })
  const failedRequest: ConstructorParameters<
    typeof ExtensionVaultSessionSynchronization
  >[0] = {
    state: fixture.state,
    channel,
    installedRuntime,
    from_array: NookExternalEventLogRecords.from_array,
  }
  const result = await Effect.runPromise(
    Effect.result(
      new ExtensionVaultSessionSynchronization(failedRequest).run(),
    ),
  )
  expect(result._tag).toBe('Failure')
  expect(fixture.merge).not.toHaveBeenCalled()
  expect(fixture.refresh).not.toHaveBeenCalled()
})

test('a delayed publication failure cannot write an old session error after lock or switch', async () => {
  type PublicationResult = Awaited<
    ReturnType<
      ConstructorParameters<
        typeof ExtensionVaultSessionPublication
      >[0]['state']['publishExtensionEventLogUpdate']
    >
  >
  const completion = Deferred.makeUnsafe<PublicationResult>()
  const state: ConstructorParameters<
    typeof ExtensionVaultSessionPublication
  >[0]['state'] = {
    sessionEpoch: 1,
    errorMsg: '',
    t: () => 'sync failed',
    publishExtensionEventLogUpdate: () =>
      Effect.runPromise(Deferred.await(completion)),
  }
  const request: ConstructorParameters<
    typeof ExtensionVaultSessionPublication
  >[0] = { state, epoch: 1 }
  const publication = Effect.runPromise(
    new ExtensionVaultSessionPublication(request).run(),
  )
  state.sessionEpoch = 2
  const failure = new VaultStorageFailure(
    VaultStorageFailureKind.ExtensionPublicationFailed,
  )
  await Effect.runPromise(Deferred.succeed(completion, err(failure)))
  await publication
  expect(state.errorMsg).toBe('')
})

test('a publication failure remains visible in the requesting session', async () => {
  const failure = new VaultStorageFailure(
    VaultStorageFailureKind.ExtensionPublicationFailed,
  )
  const state: ConstructorParameters<
    typeof ExtensionVaultSessionPublication
  >[0]['state'] = {
    sessionEpoch: 1,
    errorMsg: '',
    t: () => 'sync failed',
    publishExtensionEventLogUpdate: () =>
      Effect.runPromise(Effect.succeed(err(failure))),
  }
  const request: ConstructorParameters<
    typeof ExtensionVaultSessionPublication
  >[0] = { state, epoch: 1 }
  await Effect.runPromise(new ExtensionVaultSessionPublication(request).run())
  expect(state.errorMsg).toBe('sync failed')
})
