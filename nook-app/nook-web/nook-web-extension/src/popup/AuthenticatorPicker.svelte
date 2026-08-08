<script lang="ts">
  import { I18N_KEYS } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { Search } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import type { WebsiteAuthenticatorOption } from '../lib/login-fill-messages'
  import {
    ExtensionTranslationRequestKind,
    plainExtensionTranslation,
    type ExtensionI18n,
    type ExtensionTranslationRequest,
  } from '../lib/i18n'

  let {
    i18n,
    requestId,
  }: {
    i18n: ExtensionI18n
    requestId: string
  } = $props()

  function translatePlain(key: string): string {
    return i18n.t(plainExtensionTranslation(key))
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

  function sendRuntimeMessage(message: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response: unknown) => {
        resolve(response)
      })
    })
  }

  function isOkResponse(response: unknown): response is { ok: true } {
    return Boolean(
      response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true,
    )
  }

  function isAccountQueryResponse(response: unknown): response is {
    ok: true
    origin: string
    accounts?: WebsiteAuthenticatorOption[]
  } {
    return (
      isOkResponse(response) &&
      'origin' in response &&
      typeof response.origin === 'string'
    )
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
    const response = await sendRuntimeMessage({
      type: 'nook:authenticator-picker-query',
      payload: { requestId, query: searchQuery },
    })
    if (sequence !== querySequence) return
    loading = false
    if (!isAccountQueryResponse(response)) {
      accounts = []
      destinationOrigin = ''
      error = translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerFailed)
      return
    }
    destinationOrigin = response.origin
    accounts = response.accounts ?? []
  }

  async function choose(account: WebsiteAuthenticatorOption): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    const response = await sendRuntimeMessage({
      type: 'nook:authenticator-picker-select',
      payload: {
        requestId,
        vaultStoreId: account.vaultStoreId,
        secretId: account.secretId,
      },
    })
    if (isOkResponse(response)) {
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
      void chrome.runtime.sendMessage({
        type: 'nook:authenticator-picker-cancel',
        payload: { requestId },
      })
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
