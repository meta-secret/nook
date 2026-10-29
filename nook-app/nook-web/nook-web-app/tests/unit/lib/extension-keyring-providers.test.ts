import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { err, ok } from 'neverthrow'
import initNookWasm, {
  NookVaultManager,
  type NookKeyringProviderShares,
} from '$app-wasm'
import {
  KeyringProvidersHandOver,
  KeyringProvidersHandOverOutcome,
} from '$lib/extension/keyring-providers'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import {
  ProviderPersistenceOutcome,
  VaultProviderActions,
} from '$lib/vault/providers.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => {
  document.documentElement.removeAttribute('data-nook-extension-runtime-id')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const sealedToExtension: NookKeyringProviderShares = {
  apps: [{ appId: 'app-extension', providers: [] }],
}

type ExtensionAnswer = (
  extensionId: string,
  message: unknown,
  callback: (response: unknown) => void,
) => void

/** An open vault whose engine answers with these shares. */
function vaultSharing(shares: NookKeyringProviderShares): {
  vault: VaultState
  asked: ReturnType<typeof vi.fn>
} {
  const vault = VaultStateTestFixture.create()
  const manager = new NookVaultManager()
  const asked = vi.fn(async () => shares)
  vi.spyOn(manager, 'keyring_provider_shares').mockImplementation(asked)
  vi.spyOn(vault, 'admitManager').mockReturnValue(ok(manager))
  VaultStateTestFixture.runStorageImmediately(vault)
  return { vault, asked }
}

function installExtension(answer: ExtensionAnswer): ReturnType<typeof vi.fn> {
  document.documentElement.setAttribute(
    'data-nook-extension-runtime-id',
    'extension-123',
  )
  const sendMessage = vi.fn(answer)
  vi.stubGlobal('chrome', { runtime: { sendMessage } })
  return sendMessage
}

describe('handing the keyring providers to the extension', () => {
  test('asks and sends nothing when no extension is installed', async () => {
    const { vault, asked } = vaultSharing(sealedToExtension)
    const sendMessage = vi.fn()
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    const handed = await new KeyringProvidersHandOver(vault).deliver()

    expect(handed._unsafeUnwrap()).toBe(
      KeyringProvidersHandOverOutcome.NotRequired,
    )
    expect(asked).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test('sends nothing when the keyring has no other app', async () => {
    const { vault } = vaultSharing({ apps: [] })
    const sendMessage = installExtension(() => {})

    const handed = await new KeyringProvidersHandOver(vault).deliver()

    expect(handed._unsafeUnwrap()).toBe(
      KeyringProvidersHandOverOutcome.NotRequired,
    )
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test("sends the other apps' sealed copies to the installed extension", async () => {
    const { vault } = vaultSharing(sealedToExtension)
    const sendMessage = installExtension((extensionId, message, callback) => {
      expect(extensionId).toBe('extension-123')
      expect(message).toEqual({
        type: 'nook:extension-keyring-providers',
        payload: sealedToExtension,
      })
      callback({ ok: true })
    })

    const handed = await new KeyringProvidersHandOver(vault).deliver()

    expect(handed._unsafeUnwrap()).toBe(
      KeyringProvidersHandOverOutcome.Delivered,
    )
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  test('reports copies the extension did not take', async () => {
    const { vault } = vaultSharing(sealedToExtension)
    installExtension((_extensionId, _message, callback) =>
      callback({ ok: false, reason: 'keyring-providers-not-taken' }),
    )

    const handed = await new KeyringProvidersHandOver(vault).deliver()

    expect(handed._unsafeUnwrapErr().kind).toBe(
      VaultStorageFailureKind.ExtensionProvidersHandOverFailed,
    )
  })
})

describe('saving sync providers', () => {
  test('keeps a save the extension missed and shows that it missed it', async () => {
    const vault = VaultStateTestFixture.create()
    vi.spyOn(
      VaultProviderActions.prototype,
      'persistProviders',
    ).mockResolvedValue(ok(ProviderPersistenceOutcome.Persisted))
    vi.spyOn(KeyringProvidersHandOver.prototype, 'deliver').mockResolvedValue(
      err(
        new VaultStorageFailure(
          VaultStorageFailureKind.ExtensionProvidersHandOverFailed,
        ),
      ),
    )

    const persisted = await vault.persistProviders({ replace: false })

    expect(persisted.isOk()).toBe(true)
    expect(vault.errorMsg).toBe(
      vault.t(I18N_KEYS.ExtensionProvidersHandoverFailed),
    )
  })

  test('hands nothing over when the save fails', async () => {
    const vault = VaultStateTestFixture.create()
    vi.spyOn(
      VaultProviderActions.prototype,
      'persistProviders',
    ).mockResolvedValue(
      err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
    )
    const handOver = vi.spyOn(KeyringProvidersHandOver.prototype, 'deliver')

    const persisted = await vault.persistProviders({ replace: false })

    expect(persisted.isErr()).toBe(true)
    expect(handOver).not.toHaveBeenCalled()
  })
})
