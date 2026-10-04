import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  demoDomainEnumArgs,
  installDemoChromeStub,
  type DemoChromeStubArgs,
} from '../../../e2e/demos/static-chrome-stub'
import {
  decode_website_login_save_pending_response,
  decode_website_login_options,
  WebsiteLoginOptionsKind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm'

import {
  ExtensionPairingStateLoader,
  ExtensionSetupLoadKind,
} from '../../../../nook-web-extension/src/lib/pairing-state'

afterEach(() => vi.unstubAllGlobals())

describe('Pilot demo runtime wire contract', () => {
  test('paired and disconnected demo replies pass the owning structural setup decoder', async () => {
    for (const unavailableLoginPilotFlow of [false, true]) {
      vi.stubGlobal('chrome', {})
      const args: DemoChromeStubArgs = {
        ...demoDomainEnumArgs,
        localizedMessages: {},
        unavailableLoginPilotFlow,
      }
      installDemoChromeStub(args)
      const loaderArgs: ConstructorParameters<
        typeof ExtensionPairingStateLoader
      >[0] = {
        browser: globalThis,
      }
      const result = await new ExtensionPairingStateLoader(
        loaderArgs,
      ).loadExtensionSetupState()
      expect(result.kind).toBe(
        unavailableLoginPilotFlow
          ? ExtensionSetupLoadKind.NotConnected
          : ExtensionSetupLoadKind.Ready,
      )
      vi.unstubAllGlobals()
    }
  })
  test('initial pending-save replies from every Pilot flow pass the actual Rust decoder', async () => {
    for (const flow of [
      {},
      { loginPilotFlow: true },
      { authenticatorPickerFlow: true },
      { unavailableLoginPilotFlow: true },
      { savePilotFlow: true },
    ]) {
      vi.stubGlobal('chrome', {})
      const args: DemoChromeStubArgs = {
        ...demoDomainEnumArgs,
        localizedMessages: {},
        ...flow,
      }
      installDemoChromeStub(args)
      const message = { type: 'nook:website-login-save-pending' }
      const response = await new Promise<
        Parameters<typeof decode_website_login_save_pending_response>[0]
      >((resolve) => chrome.runtime.sendMessage(message, resolve))
      expect(decode_website_login_save_pending_response(response)).toEqual({
        ok: true,
        state: 'unavailable',
      })
      vi.unstubAllGlobals()
    }
  })

  test('neighboring locked and ready login options pass the actual Rust decoder', async () => {
    vi.stubGlobal('chrome', {})
    const args: DemoChromeStubArgs = {
      ...demoDomainEnumArgs,
      localizedMessages: {},
      loginPilotFlow: true,
    }
    installDemoChromeStub(args)
    const message = { type: 'nook:website-login-options' }
    for (const kind of [
      WebsiteLoginOptionsKind.Locked,
      WebsiteLoginOptionsKind.Ready,
    ]) {
      const response = await new Promise<
        Parameters<typeof decode_website_login_options>[0]
      >((resolve) => chrome.runtime.sendMessage(message, resolve))
      expect(decode_website_login_options(response).kind).toBe(kind)
    }
  })
})
