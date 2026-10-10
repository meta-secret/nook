import { afterEach, expect, test, vi } from 'vitest'
import { Effect } from 'effect'
import * as vaultWasm from '$app-wasm'
import { ExtensionVaultEventLogChannel } from '$lib/extension/vault-event-log'
import type {
  ExtensionBrowserHost,
  ChromeExtensionRuntimeResponse,
} from '$lib/extension/extension-message-channel'
import {
  decode_extension_vault_event_log_request_message,
  decode_extension_vault_event_log_response,
  decode_extension_vault_event_log_grant,
  type ExtensionVaultEventLogRequestMessage,
  type ExtensionVaultEventLogResponse,
  type ExtensionGrantAuthority,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

const vaultStoreId = 'store_abcdefghijk'
const responseDecoders = [
  {
    package: 'companion',
    decode_extension_vault_event_log_response,
  },
  {
    package: 'vault',
    decode_extension_vault_event_log_response:
      vaultWasm.decode_extension_vault_event_log_response,
  },
]
afterEach(() => vi.unstubAllGlobals())

test('generated WASM admits the public encrypted-event request and rejects malformed input with JsError', () => {
  const request: ExtensionVaultEventLogRequestMessage = {
    type: 'ExportVaultEventLog',
    payload: { vault_store_id: vaultStoreId },
  }
  expect(decode_extension_vault_event_log_request_message(request)).toEqual(
    request,
  )
  const malformedRequest = { type: request.type, payload: {} }
  // Deliberate raw host input verifies that the generated structural type does not replace runtime admission.
  expect(() =>
    decode_extension_vault_event_log_request_message(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Deliberate malformed host input verifies actual Rust admission despite structural generated typing.
      malformedRequest as Parameters<
        typeof decode_extension_vault_event_log_request_message
      >[0],
    ),
  ).toThrow(Error)
})

test.each(responseDecoders)(
  '$package generated WASM admits exported records only for the requested vault',
  ({ decode_extension_vault_event_log_response }) => {
    const response: ExtensionVaultEventLogResponse = {
      kind: 'Exported',
      vault_store_id: vaultStoreId,
      event_log_records: [],
    }
    const request = { response, vault_store_id: vaultStoreId }
    expect(decode_extension_vault_event_log_response(request)).toEqual(response)
    const foreignRequest = { response, vault_store_id: 'store_lmnopqrstuv' }
    expect(() =>
      decode_extension_vault_event_log_response(foreignRequest),
    ).toThrow(Error)
    const malformedRequest = {
      response: { kind: 'Exported' },
      vault_store_id: vaultStoreId,
    }
    // Deliberately incomplete raw response must still produce a real JS Error from Rust.
    expect(() =>
      decode_extension_vault_event_log_response(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Deliberate malformed host input verifies actual Rust admission despite structural generated typing.
        malformedRequest as Parameters<
          typeof decode_extension_vault_event_log_response
        >[0],
      ),
    ).toThrow(Error)
  },
)

test('generated WASM admits stored grant metadata and rejects malformed or foreign-vault authority', () => {
  const authority: ExtensionGrantAuthority = {
    kind: 'Authorized',
    grant: {
      vaultType: 'simple',
      vaultStoreId,
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      vaultName: 'Private vault',
      deviceLabel: 'Laptop',
      approvedAt: 1_786_320_000_000,
      scopes: ['password-filling'],
      syncProviderCount: 0,
      eventCount: 1,
      eventLogHeads: ['event-1'],
      lastLocalSyncAt: '2026-08-10T00:00:00Z',
    },
  }
  const request = {
    authority_response: JSON.stringify(authority),
    vault_store_id: vaultStoreId,
  }
  const expected: ReturnType<typeof decode_extension_vault_event_log_grant> = {
    kind: 'Authorized',
    grant: { grant: authority.grant },
  }
  expect(decode_extension_vault_event_log_grant(request)).toEqual(expected)
  const foreignRequest = { ...request, vault_store_id: 'store_lmnopqrstuv' }
  expect(() => decode_extension_vault_event_log_grant(foreignRequest)).toThrow(
    Error,
  )
  const malformedRequest = {
    authority_response: '{',
    vault_store_id: vaultStoreId,
  }
  expect(() =>
    decode_extension_vault_event_log_grant(malformedRequest),
  ).toThrow(Error)
})

test('the website retains the original admitted wire array and rejects another vault before import', async () => {
  const wire: ChromeExtensionRuntimeResponse = {
    kind: 'Exported',
    vault_store_id: vaultStoreId,
    event_log_records: [],
  }
  type ContractSendMessage = NonNullable<
    NonNullable<ExtensionBrowserHost['chrome']>['runtime']
  >['sendMessage']
  const sendMessage = (...request: Parameters<ContractSendMessage>) =>
    request[2](wire)
  const chrome = { runtime: { sendMessage } }
  vi.stubGlobal('chrome', chrome)
  const channel = new ExtensionVaultEventLogChannel(globalThis)
  const request: Parameters<typeof channel.pull>[0] = {
    extensionId: 'extension-runtime',
    vault_store_id: vaultStoreId,
  }
  const response = await Effect.runPromise(channel.pull(request))
  switch (response.kind) {
    case 'Exported':
      expect(response.event_log_records).toBe(wire.event_log_records)
      break
    case 'NotPaired':
    case 'Rejected':
      throw new Error('expected admitted export')
  }
  const foreignRequest: Parameters<typeof channel.pull>[0] = {
    ...request,
    vault_store_id: 'store_lmnopqrstuv',
  }
  const rejected = await Effect.runPromise(
    Effect.result(channel.pull(foreignRequest)),
  )
  expect(rejected._tag).toBe('Failure')
})

test('only genuine absence of a matching grant is classified as not paired', () => {
  const absent: ExtensionGrantAuthority = { kind: 'NoMatchingAuthority' }
  const noGrant: Parameters<typeof decode_extension_vault_event_log_grant>[0] =
    {
      authority_response: JSON.stringify(absent),
      vault_store_id: vaultStoreId,
    }
  const expectedAbsent: ReturnType<
    typeof decode_extension_vault_event_log_grant
  > = { kind: 'NotPaired' }
  expect(decode_extension_vault_event_log_grant(noGrant)).toEqual(
    expectedAbsent,
  )
  const broken: ExtensionGrantAuthority = { kind: 'MissingActiveAuthority' }
  const brokenGrant: Parameters<
    typeof decode_extension_vault_event_log_grant
  >[0] = {
    authority_response: JSON.stringify(broken),
    vault_store_id: vaultStoreId,
  }
  const expectedBroken: ReturnType<
    typeof decode_extension_vault_event_log_grant
  > = { kind: 'Rejected', reason: 'MissingActiveAuthority' }
  expect(decode_extension_vault_event_log_grant(brokenGrant)).toEqual(
    expectedBroken,
  )
})
