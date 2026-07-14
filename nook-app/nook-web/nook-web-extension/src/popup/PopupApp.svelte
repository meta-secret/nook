<script lang="ts">
  import { onMount } from 'svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import type {
    PasswordFormSummary,
    ScanPasswordFieldsResponse,
  } from '../../../nook-web-shared/src/extension/runtime-messages'
  import type { ExtensionI18n } from '../lib/i18n'
  import {
    generateSuggestedPassword,
    setupExtensionDeviceProtection,
  } from '../lib/nook-wasm'

  const setupStorageKey = 'nook:extension-setup'
  const extensionConnectUrl = 'https://simple.nokey.sh/extension-connect'

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
        deviceSigningPublicKey: string
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
        syncProviderCount: number
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

  let { i18n }: { i18n: ExtensionI18n } = $props()

  let setupState = $state<ExtensionSetupState>({
    status: 'not-set-up',
    deviceLabel: defaultDeviceLabel(),
  })
  let scanState = $state<ScanState>({
    status: 'loading',
    tabTitle: '',
  })
  let setupAttemptId = 0

  const statusText = $derived(
    i18n.t(`extension.setup.status_${setupState.status.replaceAll('-', '_')}`),
  )

  function defaultDeviceLabel() {
    return i18n.t('extension.setup.profile_title')
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
    return ['vault-access', 'password-filling', 'sync-provider-credentials']
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
    deviceSigningPublicKey: string
    extensionRuntimeId: string
    deviceLabel: string
    requestNonce: string
    requestedScopes: ExtensionConsentScope[]
  }) {
    const url = new URL(extensionConnectUrl)
    url.searchParams.set('device_id', input.deviceId)
    url.searchParams.set('device_public_key', input.devicePublicKey)
    url.searchParams.set(
      'device_signing_public_key',
      input.deviceSigningPublicKey,
    )
    url.searchParams.set('extension_id', input.extensionRuntimeId)
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
        typeof candidate.deviceSigningPublicKey === 'string' &&
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
        typeof candidate.syncProviderCount === 'number'
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
      tabTitle: i18n.t('extension.popup.checking_this_page'),
    }

    const activeTab = await queryActiveTab()
    const tabTitle = activeTab?.title ?? i18n.t('extension.popup.current_page')

    if (typeof activeTab?.id !== 'number') {
      scanState = {
        status: 'unavailable',
        tabTitle,
        message: i18n.t('extension.popup.open_web_page'),
      }
      return
    }

    const response = await scanTab(activeTab.id)

    if (!response.ok || !response.summary) {
      scanState = {
        status: 'unavailable',
        tabTitle,
        message: i18n.t('extension.popup.cannot_inspect_page'),
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
        deviceSigningPublicKey: device.deviceSigningPublicKey,
        requestNonce,
        requestUrl: extensionConnectRequestUrl({
          ...device,
          extensionRuntimeId: chrome.runtime.id,
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
            : i18n.t('extension.setup.passkey_setup_failed'),
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
      <p>
        {setupState.status === 'ready'
          ? scanState.tabTitle || i18n.t('extension.popup.checking_this_page')
          : setupState.deviceLabel}
      </p>
    </div>
    {#if setupState.status === 'ready'}
      <button
        class="scan-button"
        type="button"
        data-testid="scan-active-tab"
        aria-label={i18n.t('extension.popup.scan_active_tab')}
        onclick={() => {
          void loadPopup()
        }}
      >
        {i18n.t('extension.popup.scan')}
      </button>
    {/if}
  </header>

  <section class="extension-state" aria-live="polite">
    <div>
      <span class="metric-label">{i18n.t('extension.setup.state')}</span>
      <strong data-testid="extension-setup-state">{statusText}</strong>
    </div>
    {#if setupState.status === 'ready' || setupState.status === 'locked'}
      <div>
        <span class="metric-label">{i18n.t('extension.setup.vaults')}</span>
        <strong>{setupState.pairedVaults.length}</strong>
      </div>
    {/if}
  </section>

  {#if setupState.status === 'not-set-up'}
    <section class="setup-panel">
      <h2>{i18n.t('extension.setup.connect_nook')}</h2>
      <p>{i18n.t('extension.setup.simple_device_description')}</p>
      <button
        class="primary-button"
        type="button"
        data-testid="set-up-extension-btn"
        onclick={() => {
          void startExtensionSetup()
        }}
      >
        {i18n.t('extension.setup.set_up_extension')}
      </button>
    </section>
  {:else if setupState.status === 'protecting'}
    <section class="setup-panel">
      <h2>{i18n.t('extension.setup.protect_title')}</h2>
      <p>{i18n.t('extension.setup.protect_description')}</p>
      <button class="primary-button" type="button" disabled>
        {i18n.t('extension.setup.waiting_for_passkey')}
      </button>
      <button class="secondary-button" type="button" onclick={resetSetup}>
        {i18n.t('extension.setup.start_over')}
      </button>
    </section>
  {:else if setupState.status === 'pairing'}
    <section class="setup-panel">
      <h2>{i18n.t('extension.setup.pair_simple_title')}</h2>
      <p>{i18n.t('extension.setup.pair_simple_description')}</p>
      <p class="request-detail">
        {i18n.t('extension.setup.device_request')}: <code>{setupState.deviceId}</code>
      </p>
      <ul class="scope-list">
        {#each setupState.requestedScopes as scope}
          <li>{i18n.t(`extension.setup.scope_${scope.replaceAll('-', '_')}`)}</li>
        {/each}
      </ul>
      <button
        class="primary-button"
        type="button"
        data-testid="open-extension-connect-btn"
        onclick={openExtensionConnect}
      >
        {i18n.t('extension.setup.open_simple_vault')}
      </button>
    </section>
  {:else if setupState.status === 'pairing-failed'}
    <section class="setup-panel warning">
      <h2>{i18n.t('extension.setup.pairing_failed')}</h2>
      <p>{setupState.message}</p>
      <button class="secondary-button" type="button" onclick={resetSetup}>
        {i18n.t('extension.setup.reset_setup')}
      </button>
    </section>
  {:else if setupState.status === 'locked'}
    <section class="setup-panel">
      <h2>{i18n.t('extension.setup.locked_title')}</h2>
      <p>{i18n.t('extension.setup.locked_description')}</p>
      <button class="primary-button" type="button" disabled>
        {i18n.t('extension.setup.unlock_pending')}
      </button>
    </section>
  {:else if setupState.status === 'revoked'}
    <section class="setup-panel warning">
      <h2>{i18n.t('extension.setup.revoked_title')}</h2>
      <p>{setupState.message}</p>
      <button class="primary-button" type="button" onclick={resetSetup}>
        {i18n.t('extension.setup.pair_again')}
      </button>
    </section>
  {:else}
    <section class="vault-panel">
      <div>
        <span class="metric-label">{i18n.t('extension.setup.selected_vault')}</span>
        <strong>{setupState.selectedVaultName ?? i18n.t('extension.setup.default_vault')}</strong>
      </div>
      <div>
        <span class="metric-label">{i18n.t('extension.setup.sync')}</span>
        <strong>
          {setupState.syncProviderCount === 0
            ? i18n.t('extension.setup.vault_access_granted')
            : setupState.syncProviderCount === 1
              ? i18n.t('extension.setup.one_sync_provider_granted')
              : i18n.t('extension.setup.sync_providers_granted', {
                  count: String(setupState.syncProviderCount),
                })}
        </strong>
      </div>
    </section>

    <section class="status-panel" aria-live="polite">
      <div>
        <span class="metric-label"
          >{i18n.t('extension.popup.password_fields')}</span
        >
        <strong
          data-testid="password-field-count"
          >{scanState.status === 'ready'
            ? scanState.summary.passwordFieldCount
            : '-'}</strong
        >
      </div>
      <div>
        <span class="metric-label"
          >{i18n.t('extension.popup.login_fields')}</span
        >
        <strong
          data-testid="username-field-count"
          >{scanState.status === 'ready'
            ? scanState.summary.usernameFieldCount
            : '-'}</strong
        >
      </div>
      <div>
        <span class="metric-label">{i18n.t('extension.popup.forms')}</span>
        <strong data-testid="form-count"
          >{scanState.status === 'ready'
            ? scanState.summary.formCount
            : '-'}</strong
        >
      </div>
    </section>

    {#if scanState.status === 'loading'}
      <p class="status-message">
        {i18n.t('extension.popup.scanning_active_tab')}
      </p>
    {:else if scanState.status === 'unavailable'}
      <p class="status-message">{scanState.message}</p>
    {:else if scanState.summary.passwordFieldCount > 0}
      <p class="status-message">
        {i18n.t('extension.popup.found_password_fields')}
      </p>
      {#if scanState.generatedPassword}
        <section class="password-suggestion">
          <span>{i18n.t('extension.popup.suggested_password')}</span>
          <code data-testid="suggested-password"
            >{scanState.generatedPassword}</code
          >
        </section>
      {/if}
    {:else}
      <p class="status-message">
        {i18n.t('extension.popup.no_password_fields')}
      </p>
    {/if}
  {/if}
</main>
