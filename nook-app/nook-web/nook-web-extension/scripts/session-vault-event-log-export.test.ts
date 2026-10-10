import { expect, test, mock } from 'bun:test'
import { Effect } from 'effect'
import { DeviceProtectionStatus } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { ExtensionVaultEventLogResponse } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { SessionVaultEventLogExport } from '../src/offscreen/session-vault-event-log-export'

class SessionVaultEventLogExportFixture {
  readonly order: string[] = []
  readonly free = mock(() => {})
  readonly open = mock(async () => {
    this.order.push('admit')
  })
  readonly exportRecords = mock(async () => {
    this.order.push('export')
    return { to_array: () => [], free: this.free }
  })
  readonly manager: ConstructorParameters<
    typeof SessionVaultEventLogExport
  >[0]['manager'] = {
    device_protection_status: async () => DeviceProtectionStatus.Unlocked,
    open_extension_passkey_vault_js: this.open,
    export_event_log_records_js: this.exportRecords,
  }

  operation(): SessionVaultEventLogExport {
    const request: ConstructorParameters<typeof SessionVaultEventLogExport>[0] =
      {
        manager: this.manager,
        payload: {
          vault_store_id: 'store_website_passkeys',
          app_id: 'app_extension',
          app_public_key: 'extension-encryption-key',
          app_signing_public_key: 'extension-signing-key',
          queue: { kind: 'message-default' },
        },
      }
    return new SessionVaultEventLogExport(request)
  }
}

test('exports committed encrypted vault events only after current device access admission', async () => {
  const fixture = new SessionVaultEventLogExportFixture()
  const result = await Effect.runPromise(fixture.operation().run())
  const order: string[] = ['admit', 'export']
  expect(fixture.order).toEqual(order)
  expect(fixture.open).toHaveBeenCalledWith(
    'store_website_passkeys',
    'app_extension',
    'extension-encryption-key',
    'extension-signing-key',
  )
  const expected: ExtensionVaultEventLogResponse = {
    kind: 'Exported',
    vault_store_id: 'store_website_passkeys',
    event_log_records: [],
  }
  expect(result).toEqual(expected)
  expect(fixture.free).toHaveBeenCalledTimes(1)
})

test('rejects a locked extension without exporting its vault', async () => {
  const fixture = new SessionVaultEventLogExportFixture()
  fixture.manager.device_protection_status = async () =>
    DeviceProtectionStatus.Passkey
  const result = await Effect.runPromise(fixture.operation().run())
  const expected: ExtensionVaultEventLogResponse = {
    kind: 'Rejected',
    reason: 'Locked',
  }
  expect(result).toEqual(expected)
  expect(fixture.open).not.toHaveBeenCalled()
  expect(fixture.exportRecords).not.toHaveBeenCalled()
})

test('rejects revoked or mismatched device access without returning encrypted records', async () => {
  const fixture = new SessionVaultEventLogExportFixture()
  fixture.open.mockImplementation(async () => {
    throw new Error('access denied')
  })
  const result = await Effect.runPromise(fixture.operation().run())
  const expected: ExtensionVaultEventLogResponse = {
    kind: 'Rejected',
    reason: 'AccessDenied',
  }
  expect(result).toEqual(expected)
  expect(fixture.exportRecords).not.toHaveBeenCalled()
})

test('frees the exported record resource if conversion fails and reports failure', async () => {
  const fixture = new SessionVaultEventLogExportFixture()
  fixture.exportRecords.mockImplementation(async () => ({
    to_array: () => {
      throw new Error('conversion failed')
    },
    free: fixture.free,
  }))
  const result = await Effect.runPromise(fixture.operation().run())
  const expected: ExtensionVaultEventLogResponse = {
    kind: 'Rejected',
    reason: 'Failed',
  }
  expect(result).toEqual(expected)
  expect(fixture.free).toHaveBeenCalledTimes(1)
})
