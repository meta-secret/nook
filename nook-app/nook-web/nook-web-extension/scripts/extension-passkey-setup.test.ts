import './session-message-dispatch-test-support'
import { beforeAll, expect, spyOn, test } from 'bun:test'
import {
  configure_vault_application,
  DeviceMode,
  NookVaultManager,
  VaultApplication,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  handleSessionMessage,
  type HandleSessionMessageArgs,
  type SessionOperationContext,
} from '../src/offscreen/session-operations'
import { ExtensionSessionGeneration } from '../src/offscreen/session-lease'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import {
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  type ExtensionSessionRequest,
} from '../src/offscreen/session-request-adapter'
import { SessionOperationFailureKind } from '../src/lib/session-operation-queue'

beforeAll(() => {
  configure_vault_application(VaultApplication.Extension)
})

class ExtensionPasskeySetupFixture {
  readonly manager = new NookVaultManager()
  readonly events: string[] = []

  context(): SessionOperationContext {
    return {
      ensureWasm: async () => {
        throw new Error('Setup must use the retained manager')
      },
      getManager: async () => this.manager,
      activateSession: async () => {
        this.events.push('activated')
        return {
          deviceId: 'app_extension',
          devicePublicKey: 'public',
          deviceSigningPublicKey: 'signer',
        }
      },
      deviceResult: async () => {
        throw new Error('Setup must activate the session')
      },
      currentGeneration: () => ExtensionSessionGeneration.initial(),
      renewSessionExpiry: () => {
        throw new Error('Setup must not renew a lease')
      },
      resetOperations: () => {
        throw new Error('Setup must not reset unrelated state')
      },
    }
  }

  request(): ExtensionSessionRequest {
    return {
      type: ExtensionSessionMessageType.FinishPasskeySetup,
      payload: {
        passkeyLabel: 'Extension passkey',
        credentialId: [1],
        userHandle: [2],
        prfInput: [3],
        prfOutput: [4],
        deviceMode: DeviceMode.Standard,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
  }

  async run() {
    const request: HandleSessionMessageArgs = {
      message: this.request(),
      context: this.context(),
    }
    return handleSessionMessage(request)
  }
}

test('records the extension-created passkey before reporting setup success', async () => {
  const fixture = new ExtensionPasskeySetupFixture()
  const finish = spyOn(
    fixture.manager,
    'finish_device_protection_with_mode',
  ).mockImplementation(async () => {
    fixture.events.push('protected')
  })
  const record = spyOn(
    fixture.manager,
    'record_extension_passkey_creation',
  ).mockImplementation(async (label) => {
    fixture.events.push(label)
  })
  try {
    const outcome = await fixture.run()
    expect(outcome.isOk()).toBe(true)
    expect(fixture.events).toEqual([
      'protected',
      'Extension passkey',
      'activated',
    ])
    expect(record).toHaveBeenCalledTimes(1)
  } finally {
    finish.mockRestore()
    record.mockRestore()
    fixture.manager.free()
  }
})

test('returns failed setup when passkey association persistence fails', async () => {
  const fixture = new ExtensionPasskeySetupFixture()
  const finish = spyOn(
    fixture.manager,
    'finish_device_protection_with_mode',
  ).mockImplementation(async () => {
    fixture.events.push('protected')
  })
  const record = spyOn(
    fixture.manager,
    'record_extension_passkey_creation',
  ).mockImplementation(async () => {
    throw new Error('Association persistence rejected')
  })
  try {
    const outcome = await fixture.run()
    expect(outcome.isErr()).toBe(true)
    outcome.match(
      () => {
        throw new Error('Setup unexpectedly succeeded')
      },
      (failure) =>
        expect(failure.kind).toBe(SessionOperationFailureKind.Failed),
    )
    expect(fixture.events).toEqual(['protected'])
  } finally {
    finish.mockRestore()
    record.mockRestore()
    fixture.manager.free()
  }
})

test('generated recorder rejects an unprotected manager with a JavaScript error', async () => {
  const manager = new NookVaultManager()
  try {
    await expect(
      manager.record_extension_passkey_creation('Extension passkey'),
    ).rejects.toBeInstanceOf(Error)
  } finally {
    manager.free()
  }
})
