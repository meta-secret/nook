<script lang="ts">
  import { I18N_KEYS } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { Search } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import type { WebsiteLoginAccountOption } from '../lib/login-fill-messages'
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
  let accounts = $state<WebsiteLoginAccountOption[]>([])
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
    accounts?: WebsiteLoginAccountOption[]
  } {
    return (
      isOkResponse(response) &&
      'origin' in response &&
      typeof response.origin === 'string'
    )
  }

  function accountPrimaryLabel(account: WebsiteLoginAccountOption): string {
    const username = account.username.trim()
    if (username.length > 0) return username
    const host = account.websiteHost.trim()
    if (host.length > 0) return host
    return translatePlain(I18N_KEYS.ExtensionLoginPickerUnnamed)
  }

  function destinationLabel(origin: string): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionLoginPickerDestination,
      replacements: { origin },
    }
    return i18n.t(request)
  }

  async function loadAccounts(searchQuery: string): Promise<void> {
    const sequence = ++querySequence
    loading = true
    error = ''
    const response = await sendRuntimeMessage({
      type: 'nook:login-picker-query',
      payload: { requestId, query: searchQuery },
    })
    if (sequence !== querySequence) return
    loading = false
    if (!isAccountQueryResponse(response)) {
      accounts = []
      destinationOrigin = ''
      error = translatePlain(I18N_KEYS.ExtensionLoginPickerFailed)
      return
    }
    destinationOrigin = response.origin
    accounts = response.accounts ?? []
  }

  async function choose(account: WebsiteLoginAccountOption): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    const response = await sendRuntimeMessage({
      type: 'nook:login-picker-select',
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
    error = translatePlain(I18N_KEYS.ExtensionLoginPickerFailed)
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
        type: 'nook:login-picker-cancel',
        payload: { requestId },
      })
    }
    window.addEventListener('pagehide', cancelPendingPicker)
    return () => window.removeEventListener('pagehide', cancelPendingPicker)
  })
</script>

<main class="authenticator-picker" data-testid="login-picker">
  <p class="step-label">
    {translatePlain(I18N_KEYS.ExtensionLoginPickerStepLabel)}
  </p>
  <NookIcon src="../icons/nook.png" alt="" class="popup-logo companion-logo" />
  <h1>{translatePlain(I18N_KEYS.ExtensionLoginPickerTitle)}</h1>
  <p class="description">
    {translatePlain(I18N_KEYS.ExtensionLoginPickerDescription)}
  </p>
  {#if destinationOrigin}
    <p class="destination-origin" data-testid="login-destination">
      {destinationLabel(destinationOrigin)}
    </p>
  {/if}

  <div class="picker-filter">
    <Search aria-hidden="true" size={18} />
    <label for="login-search">
      {translatePlain(I18N_KEYS.ExtensionLoginPickerSearchLabel)}
    </label>
    <input
      id="login-search"
      data-testid="login-search"
      type="search"
      bind:this={searchInput}
      bind:value={query}
      maxlength="200"
      autocomplete="off"
      placeholder={translatePlain(
        I18N_KEYS.ExtensionLoginPickerSearchPlaceholder,
      )}
    />
  </div>
  <p class="filter-chip">
    {translatePlain(I18N_KEYS.ExtensionLoginPickerFilterLabel)}
  </p>

  {#if error}
    <p class="error-message" role="alert">{error}</p>
  {:else if loading}
    <p class="picker-status">
      {translatePlain(I18N_KEYS.ExtensionLoginPickerLoading)}
    </p>
  {:else if accounts.length === 0}
    <p class="picker-status">
      {translatePlain(I18N_KEYS.ExtensionLoginPickerNoResults)}
    </p>
  {:else}
    <div class="authenticator-results" data-testid="login-results">
      {#each accounts as account (account.vaultStoreId + account.secretId)}
        <button
          type="button"
          class="authenticator-result secondary-button"
          disabled={busy}
          onclick={() => choose(account)}
        >
          <strong>{accountPrimaryLabel(account)}</strong>
          <span>{account.websiteHost}</span>
          <small>{account.vaultName}</small>
        </button>
      {/each}
    </div>
  {/if}
</main>
