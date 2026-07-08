<script lang="ts">
  import { onMount } from 'svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import type {
    PasswordFormSummary,
    ScanPasswordFieldsResponse,
  } from '../../../nook-web-shared/src/extension/runtime-messages'
  import {
    generateSuggestedPassword,
    setupExtensionDeviceProtection,
  } from '../lib/nook-wasm'

  const setupStorageKey = 'nook:extension-setup'
  const extensionConnectUrl = 'https://nokey.sh/extension-connect'

  type ExtensionConsentScope =
    | 'vault-access'
    | 'password-filling'
    | 'sync-provider-credentials'

  type ExtensionSetupState =
    | { status: 'not-set-up'; deviceLabel: string }
    | { status: 'protecting'; deviceLabel: string }
    | {
        status: 'pairing'
        deviceLabel: string
        deviceId: string
        devicePublicKey: string
        requestNonce: string
        requestUrl: string
        requestedScopes: ExtensionConsentScope[]
      }
    | {
        status: 'pairing-failed'
        deviceLabel: string
        message: string
      }
    | {
        status: 'locked'
        deviceLabel: string
        pairedVaults: string[]
        selectedVaultName?: string | undefined
      }
    | {
        status: 'ready'
        deviceLabel: string
        pairedVaults: string[]
        selectedVaultName?: string | undefined
        syncStatus: string
      }
    | {
        status: 'revoked'
        deviceLabel: string
        message: string
      }

  type ScanState =
    | { status: 'loading'; tabTitle: string }
    | { status: 'unavailable'; tabTitle: string; message: string }
    | {
        status: 'ready'
        tabTitle: string
        summary: PasswordFormSummary
        generatedPassword?: string | undefined
      }

  let setupState = $state<ExtensionSetupState>({
    status: 'not-set-up',
    deviceLabel: defaultDeviceLabel(),
  })
  let scanState = $state<ScanState>({
    status: 'loading',
    tabTitle: 'Checking this page',
  })
  let setupAttemptId = 0

  const statusText = $derived(setupState.status.replaceAll('-', ' '))

  function defaultDeviceLabel() {
    return 'Nook Extension - this browser profile'
  }

  function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
  }

  function isConsentScope(value: unknown): value is ExtensionConsentScope {
    return (
      value === 'vault-access' ||
      value === 'password-filling' ||
      value === 'sync-provider-credentials'
    )
  }

  function isConsentScopeArray(value: unknown): value is ExtensionConsentScope[] {
    return Array.isArray(value) && value.every(isConsentScope)
  }

  function requestedConsentScopes(): ExtensionConsentScope[] {
    return [
      'vault-access',
      'password-filling',
      'sync-provider-credentials',
    ]
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

  function extensionConnectRequestUrl(input: {
    deviceId: string
    devicePublicKey: string
    deviceLabel: string
    requestNonce: string
    requestedScopes: ExtensionConsentScope[]
  }) {
    const url = new URL(extensionConnectUrl)
    url.searchParams.set('device_id', input.deviceId)
    url.searchParams.set('device_public_key', input.devicePublicKey)
    url.searchParams.set('device_label', input.deviceLabel)
    url.searchParams.set('nonce', input.requestNonce)
    url.searchParams.set('scopes', input.requestedScopes.join(','))
    return url.toString()
  }

  function isExtensionSetupState(
    value: unknown,
  ): value is ExtensionSetupState {
    if (typeof value !== 'object' || !value || !('status' in value)) {
      return false
    }

    const candidate = value as Record<string, unknown>
    if (typeof candidate.deviceLabel !== 'string') {
      return false
    }

    if (
      candidate.status === 'not-set-up' ||
      candidate.status === 'protecting'
    ) {
      return true
    }

    if (candidate.status === 'pairing') {
      return (
        typeof candidate.deviceId === 'string' &&
        typeof candidate.devicePublicKey === 'string' &&
        typeof candidate.requestNonce === 'string' &&
        typeof candidate.requestUrl === 'string' &&
        isConsentScopeArray(candidate.requestedScopes)
      )
    }

    if (
      candidate.status === 'pairing-failed' ||
      candidate.status === 'revoked'
    ) {
      return typeof candidate.message === 'string'
    }

    if (candidate.status === 'locked') {
      return (
        isStringArray(candidate.pairedVaults) &&
        (candidate.selectedVaultName === undefined ||
          typeof candidate.selectedVaultName === 'string')
      )
    }

    if (candidate.status === 'ready') {
      return (
        isStringArray(candidate.pairedVaults) &&
        (candidate.selectedVaultName === undefined ||
          typeof candidate.selectedVaultName === 'string') &&
        typeof candidate.syncStatus === 'string'
      )
    }

    return false
  }

  function readSetupState(): Promise<ExtensionSetupState> {
    return new Promise((resolve) => {
      chrome.storage.local.get(setupStorageKey, (items) => {
        const value = items[setupStorageKey]
        resolve(
          isExtensionSetupState(value)
            ? value
            : { status: 'not-set-up', deviceLabel: defaultDeviceLabel() },
        )
      })
    })
  }

  function writeSetupState(nextState: ExtensionSetupState) {
    setupState = nextState
    chrome.storage.local.set({ [setupStorageKey]: nextState })
  }

  function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs[0])
      })
    })
  }

  function scanTab(tabId: number): Promise<ScanPasswordFieldsResponse> {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage<ScanPasswordFieldsResponse>(
        tabId,
        { type: 'nook:scan-password-fields' },
        (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve({ ok: false })
            return
          }

          resolve(response)
        },
      )
    })
  }

  async function loadPopup() {
    scanState = {
      status: 'loading',
      tabTitle: 'Checking this page',
    }

    const activeTab = await queryActiveTab()
    const tabTitle = activeTab?.title ?? 'Current page'

    if (typeof activeTab?.id !== 'number') {
      scanState = {
        status: 'unavailable',
        tabTitle,
        message: 'Open a web page to scan for password fields.',
      }
      return
    }

    const response = await scanTab(activeTab.id)

    if (!response.ok || !response.summary) {
      scanState = {
        status: 'unavailable',
        tabTitle,
        message: 'Nook cannot inspect this page.',
      }
      return
    }

    scanState = {
      status: 'ready',
      tabTitle,
      summary: response.summary,
    }

    if (response.summary.passwordFieldCount > 0) {
      scanState = {
        ...scanState,
        generatedPassword: await generateSuggestedPassword(),
      }
    }
  }

  async function startExtensionSetup() {
    const attemptId = setupAttemptId + 1
    setupAttemptId = attemptId
    writeSetupState({
      status: 'protecting',
      deviceLabel: setupState.deviceLabel,
    })

    try {
      const device = await setupExtensionDeviceProtection()
      if (attemptId !== setupAttemptId) return
      const requestedScopes = requestedConsentScopes()
      const requestNonce = randomNonce()
      writeSetupState({
        status: 'pairing',
        deviceLabel: setupState.deviceLabel,
        deviceId: device.deviceId,
        devicePublicKey: device.devicePublicKey,
        requestNonce,
        requestUrl: extensionConnectRequestUrl({
          ...device,
          deviceLabel: setupState.deviceLabel,
          requestNonce,
          requestedScopes,
        }),
        requestedScopes,
      })
    } catch (error) {
      if (attemptId !== setupAttemptId) return
      writeSetupState({
        status: 'pairing-failed',
        deviceLabel: setupState.deviceLabel,
        message:
          error instanceof Error
            ? error.message
            : 'Passkey setup failed before the extension could pair.',
      })
    }
  }

  function resetSetup() {
    setupAttemptId += 1
    writeSetupState({
      status: 'not-set-up',
      deviceLabel: defaultDeviceLabel(),
    })
  }

  function openExtensionConnect() {
    chrome.tabs.create({
      url:
        setupState.status === 'pairing'
          ? setupState.requestUrl
          : extensionConnectUrl,
    })
  }

  onMount(() => {
    void (async () => {
      setupState = await readSetupState()
      if (setupState.status === 'ready') {
        await loadPopup()
      }
    })()
  })
</script>

<main class="popup-shell">
  <header class="popup-header">
    <NookIcon src="../icons/nook.png" alt="" class="popup-logo" />
    <div>
      <h1>Nook</h1>
      <p>{setupState.deviceLabel}</p>
    </div>
    {#if setupState.status === 'ready'}
      <button
        class="scan-button"
        type="button"
        data-testid="scan-active-tab"
        aria-label="Scan active tab"
        onclick={() => {
          void loadPopup()
        }}
      >
        Scan
      </button>
    {/if}
  </header>

  <section class="extension-state" aria-live="polite">
    <div>
      <span class="metric-label">Extension state</span>
      <strong data-testid="extension-setup-state">{statusText}</strong>
    </div>
    {#if setupState.status === 'ready' || setupState.status === 'locked'}
      <div>
        <span class="metric-label">Vaults</span>
        <strong>{setupState.pairedVaults.length}</strong>
      </div>
    {/if}
  </section>

  {#if setupState.status === 'not-set-up'}
    <section class="setup-panel">
      <h2>Connect Nook</h2>
      <p>
        This creates a separate passkey-protected extension device for this
        browser profile. The extension will not reuse the device key from an open
        nokey.sh tab.
      </p>
      <button
        class="primary-button"
        type="button"
        data-testid="set-up-extension-btn"
        onclick={() => {
          void startExtensionSetup()
        }}
      >
        Set up extension
      </button>
    </section>
  {:else if setupState.status === 'protecting'}
    <section class="setup-panel">
      <h2>Protect this extension</h2>
      <p>
        Creating this extension's own device key and protecting it with this
        browser profile's passkey before pairing with nokey.sh.
      </p>
      <button
        class="primary-button"
        type="button"
        disabled
      >
        Waiting for passkey
      </button>
      <button class="secondary-button" type="button" onclick={resetSetup}>
        Start over
      </button>
    </section>
  {:else if setupState.status === 'pairing'}
    <section class="setup-panel">
      <h2>Pair with nokey.sh</h2>
      <p>
        Open nokey.sh with this extension device request, unlock your vault, then
        approve vault access, password filling, and sync-provider credential
        access.
      </p>
      <p class="request-detail">
        Device request: <code>{setupState.deviceId}</code>
      </p>
      <ul class="scope-list">
        {#each setupState.requestedScopes as scope}
          <li>{scope.replaceAll('-', ' ')}</li>
        {/each}
      </ul>
      <button
        class="primary-button"
        type="button"
        data-testid="open-extension-connect-btn"
        onclick={openExtensionConnect}
      >
        Open nokey.sh
      </button>
    </section>
  {:else if setupState.status === 'pairing-failed'}
    <section class="setup-panel warning">
      <h2>Pairing failed</h2>
      <p>{setupState.message}</p>
      <button class="secondary-button" type="button" onclick={resetSetup}>
        Reset setup
      </button>
    </section>
  {:else if setupState.status === 'locked'}
    <section class="setup-panel">
      <h2>Extension locked</h2>
      <p>
        This extension is paired as a durable Nook device. Unlock with passkey
        before vaults, sync providers, or filling actions are available.
      </p>
      <button class="primary-button" type="button" disabled>
        Unlock pending
      </button>
    </section>
  {:else if setupState.status === 'revoked'}
    <section class="setup-panel warning">
      <h2>Extension revoked</h2>
      <p>{setupState.message}</p>
      <button class="primary-button" type="button" onclick={resetSetup}>
        Pair again
      </button>
    </section>
  {:else}
    <section class="vault-panel">
      <div>
        <span class="metric-label">Selected vault</span>
        <strong>{setupState.selectedVaultName ?? 'Default vault'}</strong>
      </div>
      <div>
        <span class="metric-label">Sync</span>
        <strong>{setupState.syncStatus}</strong>
      </div>
    </section>

    <section class="status-panel" aria-live="polite">
      <div>
        <span class="metric-label">Password fields</span>
        <strong data-testid="password-field-count"
          >{scanState.status === 'ready'
            ? scanState.summary.passwordFieldCount
            : '-'}</strong
        >
      </div>
      <div>
        <span class="metric-label">Login fields</span>
        <strong data-testid="username-field-count"
          >{scanState.status === 'ready'
            ? scanState.summary.usernameFieldCount
            : '-'}</strong
        >
      </div>
      <div>
        <span class="metric-label">Forms</span>
        <strong data-testid="form-count"
          >{scanState.status === 'ready' ? scanState.summary.formCount : '-'}</strong
        >
      </div>
    </section>

    {#if scanState.status === 'loading'}
      <p class="status-message">Scanning the active tab.</p>
    {:else if scanState.status === 'unavailable'}
      <p class="status-message">{scanState.message}</p>
    {:else if scanState.summary.passwordFieldCount > 0}
      <p class="status-message">Nook found password fields on this page.</p>
      {#if scanState.generatedPassword}
        <section class="password-suggestion">
          <span>Suggested password</span>
          <code data-testid="suggested-password"
            >{scanState.generatedPassword}</code
          >
        </section>
      {/if}
    {:else}
      <p class="status-message">No password fields detected on this page.</p>
    {/if}
  {/if}
</main>
