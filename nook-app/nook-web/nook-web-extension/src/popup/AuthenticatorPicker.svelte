<script lang="ts">
  import { Search } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import type { WebsiteAuthenticatorOption } from '../lib/login-fill-messages'
  import type { ExtensionI18n } from '../lib/i18n'

  let {
    i18n,
    requestId,
  }: {
    i18n: ExtensionI18n
    requestId: string
  } = $props()

  let query = $state('')
  let accounts = $state<WebsiteAuthenticatorOption[]>([])
  let loading = $state(true)
  let busy = $state(false)
  let error = $state('')
  let searchInput = $state<HTMLInputElement>()
  let querySequence = 0
  let completed = false

  function sendRuntimeMessage<T>(message: unknown): Promise<T | undefined> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response: T | undefined) => {
        if (chrome.runtime.lastError) {
          resolve(undefined)
          return
        }
        resolve(response)
      })
    })
  }

  async function loadAccounts(searchQuery: string): Promise<void> {
    const sequence = ++querySequence
    loading = true
    error = ''
    const response = await sendRuntimeMessage<{
      ok?: boolean
      accounts?: WebsiteAuthenticatorOption[]
    }>({
      type: 'nook:authenticator-picker-query',
      payload: { requestId, query: searchQuery },
    })
    if (sequence !== querySequence) return
    loading = false
    if (!response?.ok) {
      accounts = []
      error = i18n.t('extension.authenticator_picker.failed')
      return
    }
    accounts = response.accounts ?? []
  }

  async function choose(account: WebsiteAuthenticatorOption): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    const response = await sendRuntimeMessage<{ ok?: boolean }>({
      type: 'nook:authenticator-picker-select',
      payload: {
        requestId,
        vaultStoreId: account.vaultStoreId,
        secretId: account.secretId,
      },
    })
    if (response?.ok) {
      completed = true
      window.close()
      return
    }
    busy = false
    error = i18n.t('extension.authenticator_picker.failed')
  }

  $effect(() => {
    void loadAccounts(query)
  })

  onMount(() => {
    searchInput?.focus()
    const cancelPendingPicker = () => {
      if (completed) return
      completed = true
      chrome.runtime.sendMessage({
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
    {i18n.t('extension.authenticator_picker.step_label')}
  </p>
  <NookIcon src="../icons/nook.png" alt="" class="popup-logo companion-logo" />
  <h1>{i18n.t('extension.authenticator_picker.title')}</h1>
  <p class="description">
    {i18n.t('extension.authenticator_picker.description')}
  </p>

  <div class="picker-filter">
    <Search aria-hidden="true" size={18} />
    <label for="authenticator-search">
      {i18n.t('extension.authenticator_picker.search_label')}
    </label>
    <input
      id="authenticator-search"
      data-testid="authenticator-search"
      type="search"
      bind:this={searchInput}
      bind:value={query}
      maxlength="200"
      autocomplete="off"
      placeholder={i18n.t('extension.authenticator_picker.search_placeholder')}
    />
  </div>
  <p class="filter-chip">
    {i18n.t('extension.authenticator_picker.filter_label')}
  </p>

  {#if error}
    <p class="error-message" role="alert">{error}</p>
  {:else if loading}
    <p class="picker-status">
      {i18n.t('extension.authenticator_picker.loading')}
    </p>
  {:else if accounts.length === 0}
    <p class="picker-status">
      {i18n.t('extension.authenticator_picker.no_results')}
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
