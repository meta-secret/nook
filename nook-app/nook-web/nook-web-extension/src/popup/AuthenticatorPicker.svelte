<script lang="ts">
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { Search } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import type { WebsiteAuthenticatorOption } from '../lib/login-fill-messages'
  type AuthenticatorPickerRuntimeMessage =
    | { type: 'nook:authenticator-picker-query'; payload: { requestId: string; query: string } }
    | { type: 'nook:authenticator-picker-select'; payload: { requestId: string; vaultStoreId: string; secretId: string } }
    | { type: 'nook:authenticator-picker-cancel'; payload: { requestId: string } }
  type AuthenticatorPickerRuntimeResponse =
    | { ok: true; origin: string; accounts?: WebsiteAuthenticatorOption[] }
    | { ok: true }
    | { ok: false; reason?: string }
  type AuthenticatorPickerAccountQueryResponse = Extract<
    AuthenticatorPickerRuntimeResponse,
    { ok: true; origin: string }
  >
  type AuthenticatorPickerRuntimeResponseDecode =
    | { kind: 'account-query'; response: AuthenticatorPickerAccountQueryResponse }
    | { kind: 'success'; response: { ok: true } }
    | { kind: 'rejected' }
  import {
    ExtensionTranslationRequestKind,
    type ExtensionI18n,
    type ExtensionTranslationRequest,
    extensionLocaleCatalog,
  } from '../lib/i18n'

  let {
    i18n,
    requestId,
  }: {
    i18n: ExtensionI18n
    requestId: string
  } = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  let query = $state('')
  let accounts = $state<WebsiteAuthenticatorOption[]>([])
  let destinationOrigin = $state('')
  let loading = $state(true)
  let busy = $state(false)
  let error = $state('')
  let searchInput = $state<HTMLInputElement>()
  let querySequence = 0
  let completed = false

  function sendRuntimeMessage(
    message: AuthenticatorPickerRuntimeMessage,
  ): Promise<AuthenticatorPickerRuntimeResponse | undefined> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response: AuthenticatorPickerRuntimeResponse | undefined) => {
        resolve(response)
      })
    })
  }

  function decodeAuthenticatorPickerRuntimeResponse(
    response: AuthenticatorPickerRuntimeResponse | undefined,
  ): AuthenticatorPickerRuntimeResponseDecode {
    if (
      !response ||
      typeof response !== 'object' ||
      !('ok' in response) ||
      response.ok !== true
    ) {
      return { kind: 'rejected' }
    }
    if ('origin' in response && typeof response.origin === 'string') {
      return { kind: 'account-query', response }
    }
    return { kind: 'success', response }
  }

  function destinationLabel(origin: string): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionAuthenticatorPickerDestination,
      replacements: { origin },
    }
    return i18n.t(request)
  }

  async function loadAccounts(searchQuery: string): Promise<void> {
    const sequence = ++querySequence
    loading = true
    error = ''
    const message: Parameters<typeof sendRuntimeMessage>[0] = {
      type: 'nook:authenticator-picker-query',
      payload: { requestId, query: searchQuery },
    }
    const response = await sendRuntimeMessage(message)
    if (sequence !== querySequence) return
    loading = false
    const responseDecode = decodeAuthenticatorPickerRuntimeResponse(response)
    if (responseDecode.kind !== 'account-query') {
      accounts = []
      destinationOrigin = ''
      error = translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerFailed)
      return
    }
    destinationOrigin = responseDecode.response.origin
    accounts = ((v) => (v ? v : []))(responseDecode.response.accounts)
  }

  async function choose(account: WebsiteAuthenticatorOption): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    const message: Parameters<typeof sendRuntimeMessage>[0] = {
      type: 'nook:authenticator-picker-select',
      payload: {
        requestId,
        vaultStoreId: account.vaultStoreId,
        secretId: account.secretId,
      },
    }
    const response = await sendRuntimeMessage(message)
    if (
      decodeAuthenticatorPickerRuntimeResponse(response).kind !== 'rejected'
    ) {
      completed = true
      window.close()
      return
    }
    busy = false
    error = translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerFailed)
  }

  $effect(() => {
    void loadAccounts(query)
  })

  onMount(() => {
    searchInput?.focus()
    const cancelPendingPicker = () => {
      if (completed) return
      completed = true
      const message: AuthenticatorPickerRuntimeMessage = {
        type: 'nook:authenticator-picker-cancel',
        payload: { requestId },
      }
      void chrome.runtime.sendMessage(message)
    }
    window.addEventListener('pagehide', cancelPendingPicker)
    return () => window.removeEventListener('pagehide', cancelPendingPicker)
  })
</script>

<main class="authenticator-picker" data-testid="authenticator-picker">
  <p class="step-label">
    {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerStepLabel)}
  </p>
  <NookIcon src="../icons/nook.png" alt="" class="popup-logo companion-logo" />
  <h1>{translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerTitle)}</h1>
  <p class="description">
    {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerDescription)}
  </p>
  {#if destinationOrigin}
    <p class="destination-origin" data-testid="authenticator-destination">
      {destinationLabel(destinationOrigin)}
    </p>
  {/if}

  <div class="picker-filter">
    <Search aria-hidden="true" size={18} />
    <label for="authenticator-search">
      {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerSearchLabel)}
    </label>
    <input
      id="authenticator-search"
      data-testid="authenticator-search"
      type="search"
      bind:this={searchInput}
      bind:value={query}
      maxlength="200"
      autocomplete="off"
      placeholder={translatePlain(
        I18N_KEYS.ExtensionAuthenticatorPickerSearchPlaceholder,
      )}
    />
  </div>
  <p class="filter-chip">
    {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerFilterLabel)}
  </p>

  {#if error}
    <p class="error-message" role="alert">{error}</p>
  {:else if loading}
    <p class="picker-status">
      {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerLoading)}
    </p>
  {:else if accounts.length === 0}
    <p class="picker-status">
      {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerNoResults)}
    </p>
  {:else}
    <div class="authenticator-results" data-testid="authenticator-results">
      {#each accounts as account (account.vaultStoreId + account.secretId)}
        <button
          type="button"
          class="authenticator-result secondary-button"
          disabled={busy}
          onclick={() => choose(account)}
        >
          <strong>{account.issuer}</strong>
          <span>{account.account}</span>
          <small>{account.vaultName}</small>
        </button>
      {/each}
    </div>
  {/if}
</main>
