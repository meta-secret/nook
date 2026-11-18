import { expect, test, vi } from 'vitest'
import { ok } from 'neverthrow'
import type { NookEncryptedSearchCatalogHint } from '$app-wasm'
import { ExtensionSyncPublication } from '$lib/vault/sync-extension-bridge'
import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'
import { ExtensionLocalEventLogUpdatedMessageType } from '$web-shared/extension/lifecycle-runtime-messages'

import {
  extensionEventLogFixtureStoreId as vaultStoreId,
  extensionEventLogRecordsFixture as eventLogRecords,
} from './extension-connect-test-support'

enum CatalogExportScenario {
  Sealed = 'sealed',
  Absent = 'absent',
  Rejected = 'rejected',
}

enum StorageOperationStage {
  Idle = 'idle',
  Running = 'running',
}

type CatalogExportRead = {
  expectedStoreId: string
  stage: StorageOperationStage
  releasedRecords: number
}

class LocalEventPublicationFixture {
  readonly releaseRecords = vi.fn()
  readonly catalogReads: CatalogExportRead[] = []
  private stage = StorageOperationStage.Idle

  constructor(private readonly scenario: CatalogExportScenario) {}

  publication(): ExtensionSyncPublication {
    const manager: PublicationManager = {
      vaultStoreId,
      export_event_log_records_js: async () => {
        expect(this.stage).toBe(StorageOperationStage.Running)
        return {
          to_array: () => eventLogRecords,
          free: this.releaseRecords,
          [Symbol.dispose]: this.releaseRecords,
        }
      },
      export_extension_search_catalog_hint_js: (expectedStoreId) =>
        this.exportCatalog(expectedStoreId),
    }
    const state: PublicationContext = {
      activeVault: { kind: ActiveVaultKind.Open, storeId: vaultStoreId },
      admitManager: () => ok(manager),
      enqueueStorage: async (operation) => {
        this.stage = StorageOperationStage.Running
        try {
          return await operation()
        } finally {
          this.stage = StorageOperationStage.Idle
        }
      },
    }
    return new ExtensionSyncPublication(state)
  }

  private async exportCatalog(
    expectedStoreId: string,
  ): Promise<NookEncryptedSearchCatalogHint> {
    this.catalogReads.push({
      expectedStoreId,
      stage: this.stage,
      releasedRecords: this.releaseRecords.mock.calls.length,
    })
    switch (this.scenario) {
      case CatalogExportScenario.Sealed:
        return { kind: 'sealed', encoded: 'sealed-catalog-fixture' }
      case CatalogExportScenario.Absent:
        return { kind: 'absent' }
      case CatalogExportScenario.Rejected:
        throw new Error('catalog is unavailable')
    }
  }
}

type PublicationContext = ConstructorParameters<
  typeof ExtensionSyncPublication
>[0]
type PublicationManager = ReturnType<
  ReturnType<PublicationContext['admitManager']>['_unsafeUnwrap']
>

test.each(Object.values(CatalogExportScenario))(
  'publishes the signed event snapshot for a queued catalog export that is %s',
  async (scenario) => {
    const fixture = new LocalEventPublicationFixture(scenario)
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    try {
      const result = await fixture
        .publication()
        .publishExtensionEventLogUpdateForVault()
      expect(result._unsafeUnwrap()).toEqual({
        vaultStoreId,
        publishedRecordCount: 1,
      })
      expect(fixture.catalogReads).toEqual([
        {
          expectedStoreId: vaultStoreId,
          stage: StorageOperationStage.Running,
          releasedRecords: 1,
        },
      ])
      const payload = { vaultStoreId, eventLogRecords }
      switch (scenario) {
        case CatalogExportScenario.Sealed:
          expect(post).toHaveBeenCalledWith(
            {
              type: ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated,
              payload: {
                ...payload,
                encryptedSearchCatalog: 'sealed-catalog-fixture',
              },
            },
            window.location.origin,
          )
          break
        case CatalogExportScenario.Absent:
        case CatalogExportScenario.Rejected:
          expect(post).toHaveBeenCalledWith(
            {
              type: ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated,
              payload,
            },
            window.location.origin,
          )
          break
      }
    } finally {
      post.mockRestore()
    }
  },
)
