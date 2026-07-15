<script lang="ts">
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import type { ExtensionI18n } from '../lib/i18n'
  import { setupExtensionDeviceProtection } from '../lib/nook-wasm'

  type ProtectionState =
    | { status: 'idle' }
    | { status: 'protecting' }
    | { status: 'failed'; message: string }

  let { i18n }: { i18n: ExtensionI18n } = $props()
  let state = $state<ProtectionState>({ status: 'idle' })

  function requestedScopes() {
    return ['vault-access', 'password-filling']
  }

  function randomNonce() {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    )
  }

  function pairingUrl(device: {
    deviceId: string
    devicePublicKey: string
    deviceSigningPublicKey: string
  }) {
    const url = new URL('https://simple.nokey.sh/extension-connect')
    url.searchParams.set('device_id', device.deviceId)
    url.searchParams.set('device_public_key', device.devicePublicKey)
    url.searchParams.set(
      'device_signing_public_key',
      device.deviceSigningPublicKey,
    )
    url.searchParams.set('extension_id', chrome.runtime.id)
    url.searchParams.set(
      'device_label',
      i18n.t('extension.setup.profile_title'),
    )
    url.searchParams.set('nonce', randomNonce())
    url.searchParams.set('scopes', requestedScopes().join(','))
    return url.toString()
  }

  async function protectBrowserAccess() {
    state = { status: 'protecting' }
    try {
      const device = await setupExtensionDeviceProtection()
      window.location.assign(pairingUrl(device))
    } catch (error) {
      state = {
        status: 'failed',
        message:
          error instanceof Error
            ? error.message
            : i18n.t('extension.setup.passkey_setup_failed'),
      }
    }
  }
</script>

<main class="connect-shell">
  <header>
    <NookIcon src="../icons/nook.png" alt="" class="logo" />
    <div>
      <h1>{i18n.t('extension.setup.browser_access_title')}</h1>
      <p>{i18n.t('extension.setup.browser_access_description')}</p>
    </div>
  </header>

  {#if state.status === 'failed'}
    <p class="error" role="alert">{state.message}</p>
  {/if}

  <button
    type="button"
    data-testid="protect-browser-access-btn"
    disabled={state.status === 'protecting'}
    onclick={() => void protectBrowserAccess()}
  >
    {state.status === 'protecting'
      ? i18n.t('extension.setup.waiting_for_passkey')
      : i18n.t('extension.setup.protect_browser_access')}
  </button>
</main>
