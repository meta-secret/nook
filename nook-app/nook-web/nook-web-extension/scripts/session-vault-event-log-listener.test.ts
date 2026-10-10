import { beforeAll, expect, mock, test } from 'bun:test'
import { Effect } from 'effect'
import { err, ok } from 'neverthrow'
import {
  ExtensionSessionMessageDispatcher,
  ExtensionSessionMessageType,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  decodeProviders,
} from './session-message-dispatch-test-support'
import {
  NookVaultManager,
  DeviceProtectionStatus,
  configure_vault_application,
  VaultApplication,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  ExtensionEventLogRecord,
  ExtensionVaultEventLogResponse,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { SessionMessageDispatchContext } from '../src/offscreen/session-message-dispatch'
import type { ExtensionSessionRequest } from '../src/offscreen/session-request-adapter'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../src/lib/session-operation-queue'
import { SessionVaultEventLogExport } from '../src/offscreen/session-vault-event-log-export'

type RuntimeListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]
type RuntimeResponse = Parameters<Parameters<RuntimeListener>[2]>[0]
type RejectedSessionListenerResponse = {
  readonly ok: false
  readonly error: string
}

beforeAll(() => configure_vault_application(VaultApplication.Extension))

class InstalledVaultEventLogListenerFixture {
  readonly registered = Promise.withResolvers<RuntimeListener>()
  readonly blocked = Promise.withResolvers<void>()
  readonly started = Promise.withResolvers<void>()
  readonly queued = Promise.withResolvers<void>()
  readonly order: string[] = []
  readonly records: ExtensionEventLogRecord[] = [
    {
      eventId: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
      path: 'events/passkey.json',
      event: {
        schema_version: 2,
        store_id: 'store_abcdefghijk',
        actor_id: `key_${'0'.repeat(64)}`,
        actor_signing_public_key: '0'.repeat(64),
        parents: [],
        created_at: '2026-10-10T00:00:00Z',
        key_epoch: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
        operations: [
          {
            type: 'secret-created',
            secret: {
              id: 'secret_abcdefghijk',
              type: 'passkey',
              ciphertext: 'opaque-encrypted-passkey-record',
              identity_fingerprint: 'credential-fingerprint',
              fingerprint: 'encrypted-revision-fingerprint',
            },
          },
        ],
        signature: `ed25519:${'0'.repeat(128)}`,
      },
    },
  ]
  readonly open = mock(async () => {
    this.order.push('open')
  })
  readonly free = mock(() => {})
  readonly manager: ConstructorParameters<
    typeof SessionVaultEventLogExport
  >[0]['manager'] = {
    device_protection_status: async () => DeviceProtectionStatus.Unlocked,
    open_extension_passkey_vault_js: this.open,
    export_event_log_records_js: async () => {
      this.order.push('export')
      const resource = { to_array: () => this.records, free: this.free }
      return resource
    },
  }
  readonly context: SessionMessageDispatchContext<ExtensionVaultEventLogResponse> =
    {
      decodeProviders,
      handleMessage: this.handle.bind(this),
      handleCompanionIdentityDiscovery: this.reject.bind(this),
      handleCompanionIdentityHandoff: this.reject.bind(this),
    }
  readonly dispatcher = new ExtensionSessionMessageDispatcher(this.context)
  private readonly enqueue = this.dispatcher.enqueue.bind(this.dispatcher)
  readonly message: Extract<
    ExtensionSessionRequest,
    { type: typeof ExtensionSessionMessageType.ExportVaultEventLog }
  >

  constructor() {
    const source = new NookVaultManager()
    const handoff = source.begin_extension_identity_handoff()
    try {
      this.message = {
        type: ExtensionSessionMessageType.ExportVaultEventLog,
        payload: {
          vault_store_id: 'store_abcdefghijk',
          app_id: '1234567890abcdef',
          app_public_key: handoff.recipient_public_key,
          app_signing_public_key: '24'.repeat(32),
          queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
        },
      }
    } finally {
      handoff.free()
      source.free()
    }
    const host = {
      chrome: {
        runtime: {
          id: 'nook-extension',
          getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
          onMessage: { addListener: this.registered.resolve },
        },
      },
    }
    Object.assign(globalThis, host)
    this.dispatcher.enqueue = this.captureQueue.bind(this)
    chrome.runtime.onMessage.addListener(this.dispatcher.listener())
  }

  private captureQueue(message: ExtensionSessionRequest) {
    switch (message.type) {
      case ExtensionSessionMessageType.ExportVaultEventLog:
        this.queued.resolve()
        break
      case ExtensionSessionMessageType.ClassifyGrantAuthority:
      case ExtensionSessionMessageType.Reset:
      case ExtensionSessionMessageType.MigrateAuthProviders:
      case ExtensionSessionMessageType.Status:
      case ExtensionSessionMessageType.BeginPasskeySetup:
      case ExtensionSessionMessageType.FinishPasskeySetup:
      case ExtensionSessionMessageType.RecoverPasskey:
      case ExtensionSessionMessageType.UnlockOptions:
      case ExtensionSessionMessageType.UnlockPasskey:
      case ExtensionSessionMessageType.CreatePin:
      case ExtensionSessionMessageType.UnlockPin:
      case ExtensionSessionMessageType.SealIdentityHandoff:
      case ExtensionSessionMessageType.ImportVault:
      case ExtensionSessionMessageType.UpdateVault:
      case ExtensionSessionMessageType.VaultSummary:
      case ExtensionSessionMessageType.ListPasskeys:
      case ExtensionSessionMessageType.ListLogins:
      case ExtensionSessionMessageType.RevealLogin:
      case ExtensionSessionMessageType.RevealFocusedLogin:
      case ExtensionSessionMessageType.ListAuthenticators:
      case ExtensionSessionMessageType.AuthenticatorCode:
      case ExtensionSessionMessageType.AuthenticatorEnrollPreview:
      case ExtensionSessionMessageType.AuthenticatorEnrollCode:
      case ExtensionSessionMessageType.AuthenticatorEnrollConfirm:
      case ExtensionSessionMessageType.AuthenticatorBackupAttach:
      case ExtensionSessionMessageType.PlanLoginSave:
      case ExtensionSessionMessageType.PendingLoginSave:
      case ExtensionSessionMessageType.CommitLoginSave:
      case ExtensionSessionMessageType.DismissLoginSave:
      case ExtensionSessionMessageType.CancelPasskey:
      case ExtensionSessionMessageType.RegisterPasskey:
      case ExtensionSessionMessageType.AssertPasskey:
      case ExtensionSessionMessageType.Lock:
        break
    }
    return this.enqueue(message)
  }
  private async reject() {
    return err(
      new SessionOperationFailure(SessionOperationFailureKind.InvalidRequest),
    )
  }
  private async handle(message: ExtensionSessionRequest) {
    switch (message.type) {
      case ExtensionSessionMessageType.Status: {
        this.started.resolve()
        await this.blocked.promise
        this.order.push('blocked-finished')
        const skipped: ExtensionVaultEventLogResponse = { kind: 'NotPaired' }
        return ok(skipped)
      }
      case ExtensionSessionMessageType.ExportVaultEventLog: {
        this.order.push('queued-export')
        const request: ConstructorParameters<
          typeof SessionVaultEventLogExport
        >[0] = { manager: this.manager, payload: message.payload }
        return ok(
          await Effect.runPromise(
            new SessionVaultEventLogExport(request).run(),
          ),
        )
      }
      case ExtensionSessionMessageType.ClassifyGrantAuthority:
      case ExtensionSessionMessageType.Reset:
      case ExtensionSessionMessageType.MigrateAuthProviders:
      case ExtensionSessionMessageType.BeginPasskeySetup:
      case ExtensionSessionMessageType.FinishPasskeySetup:
      case ExtensionSessionMessageType.RecoverPasskey:
      case ExtensionSessionMessageType.UnlockOptions:
      case ExtensionSessionMessageType.UnlockPasskey:
      case ExtensionSessionMessageType.CreatePin:
      case ExtensionSessionMessageType.UnlockPin:
      case ExtensionSessionMessageType.SealIdentityHandoff:
      case ExtensionSessionMessageType.ImportVault:
      case ExtensionSessionMessageType.UpdateVault:
      case ExtensionSessionMessageType.VaultSummary:
      case ExtensionSessionMessageType.ListPasskeys:
      case ExtensionSessionMessageType.ListLogins:
      case ExtensionSessionMessageType.RevealLogin:
      case ExtensionSessionMessageType.RevealFocusedLogin:
      case ExtensionSessionMessageType.ListAuthenticators:
      case ExtensionSessionMessageType.AuthenticatorCode:
      case ExtensionSessionMessageType.AuthenticatorEnrollPreview:
      case ExtensionSessionMessageType.AuthenticatorEnrollCode:
      case ExtensionSessionMessageType.AuthenticatorEnrollConfirm:
      case ExtensionSessionMessageType.AuthenticatorBackupAttach:
      case ExtensionSessionMessageType.PlanLoginSave:
      case ExtensionSessionMessageType.PendingLoginSave:
      case ExtensionSessionMessageType.CommitLoginSave:
      case ExtensionSessionMessageType.DismissLoginSave:
      case ExtensionSessionMessageType.CancelPasskey:
      case ExtensionSessionMessageType.RegisterPasskey:
      case ExtensionSessionMessageType.AssertPasskey:
      case ExtensionSessionMessageType.Lock:
        return this.reject()
    }
  }
}

test('installed offscreen listener admits canonical export, queues it, and returns committed ciphertext', async () => {
  const fixture = new InstalledVaultEventLogListenerFixture()
  const listener = await fixture.registered.promise
  const block: ExtensionSessionRequest = {
    type: ExtensionSessionMessageType.Status,
    payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
  }
  const pending = fixture.dispatcher.enqueue(block)
  await fixture.started.promise
  const response = Promise.withResolvers<RuntimeResponse>()
  const sender: chrome.runtime.MessageSender = {
    id: 'nook-extension',
    url: 'chrome-extension://nook-extension/background/service-worker.js',
  }
  expect(Boolean(listener(fixture.message, sender, response.resolve))).toBe(
    true,
  )
  await fixture.queued.promise
  expect(fixture.open).not.toHaveBeenCalled()
  fixture.blocked.resolve()
  await pending
  const expected: ExtensionVaultEventLogResponse = {
    kind: 'Exported',
    vault_store_id: fixture.message.payload.vault_store_id,
    event_log_records: fixture.records,
  }
  expect(await response.promise).toEqual(expected)
  const order = ['blocked-finished', 'queued-export', 'open', 'export']
  expect(fixture.order).toEqual(order)
  expect(fixture.free).toHaveBeenCalledTimes(1)
})

test('installed export listener ignores a foreign extension and refuses a same-extension nonworker sender', async () => {
  const fixture = new InstalledVaultEventLogListenerFixture()
  const listener = await fixture.registered.promise
  const foreignResponse = mock(() => {})
  const foreign: chrome.runtime.MessageSender = { id: 'foreign-extension' }
  expect(Boolean(listener(fixture.message, foreign, foreignResponse))).toBe(
    false,
  )
  expect(foreignResponse).not.toHaveBeenCalled()
  const response = Promise.withResolvers<RuntimeResponse>()
  const popup: chrome.runtime.MessageSender = {
    id: 'nook-extension',
    url: 'chrome-extension://nook-extension/popup/index.html',
  }
  expect(Boolean(listener(fixture.message, popup, response.resolve))).toBe(true)
  const expected: RejectedSessionListenerResponse = {
    ok: false,
    error: 'Forbidden extension session request.',
  }
  expect(await response.promise).toEqual(expected)
  expect(fixture.open).not.toHaveBeenCalled()
})

test('installed canonical export listener leaves malformed identity rejection to the real Rust decoder', async () => {
  const fixture = new InstalledVaultEventLogListenerFixture()
  const listener = await fixture.registered.promise
  const malformed = {
    type: fixture.message.type,
    payload: {
      vault_store_id: fixture.message.payload.vault_store_id,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const response = Promise.withResolvers<RuntimeResponse>()
  const sender: chrome.runtime.MessageSender = {
    id: 'nook-extension',
    url: 'chrome-extension://nook-extension/background/service-worker.js',
  }
  expect(Boolean(listener(malformed, sender, response.resolve))).toBe(true)
  const expected: RejectedSessionListenerResponse = {
    ok: false,
    error: 'Invalid extension session request.',
  }
  expect(await response.promise).toEqual(expected)
  expect(fixture.open).not.toHaveBeenCalled()
})
