<script lang="ts">
  import { Search } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import type { WebsiteLoginAccountOption } from '../lib/login-fill-messages'
  import type { ExtensionI18n } from '../lib/i18n'

  let {
    i18n,
    requestId,
  }: {
    i18n: ExtensionI18n
    requestId: string
  } = $props()

  let query = $state('')
  let accounts = $state<WebsiteLoginAccountOption[]>([])
  let destinationOrigin = $state('')
  let loading = $state(true)
  let busy = $state(false)
  let error = $state('')
  let searchInput = $state<HTMLInputElement>()
  let querySequence = 0
  let completed = false

  function sendRuntimeMessage<T>(message: unknown): Promise<T | void> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response: T | void) => {
        if (chrome.runtime.lastError) {
          resolve()
          return
        }
        resolve(response)
      })
    })
  }

  function accountPrimaryLabel(account: WebsiteLoginAccountOption): string {
    const username = account.username.trim()
    if (username.length > 0) return username
    const host = account.websiteHost.trim()
    if (host.length > 0) return host
    return i18n.t('extension.login_picker.unnamed')
  }

  async function loadAccounts(searchQuery: string): Promise<void> {
    const sequence = ++querySequence
    loading = true
    error = ''
    const response = await sendRuntimeMessage<{
      ok?: boolean
      origin?: string
      accounts?: WebsiteLoginAccountOption[]
    }>({
      type: 'nook:login-picker-query',
      payload: { requestId, query: searchQuery },
    })
    if (sequence !== querySequence) return
    loading = false
    if (!response?.ok || typeof response.origin !== 'string') {
      accounts = []
      destinationOrigin = ''
      error = i18n.t('extension.login_picker.failed')
      return
    }
    destinationOrigin = response.origin
    accounts = response.accounts ?? []
  }

  async function choose(account: WebsiteLoginAccountOption): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    const response = await sendRuntimeMessage<{ ok?: boolean }>({
      type: 'nook:login-picker-select',
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
    error = i18n.t('extension.login_picker.failed')
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
    {i18n.t('extension.login_picker.step_label')}
  </p>
  <NookIcon src="../icons/nook.png" alt="" class="popup-logo companion-logo" />
  <h1>{i18n.t('extension.login_picker.title')}</h1>
  <p class="description">
    {i18n.t('extension.login_picker.description')}
  </p>
  {#if destinationOrigin}
    <p class="destination-origin" data-testid="login-destination">
      {i18n.t('extension.login_picker.destination', {
        origin: destinationOrigin,
      })}
    </p>
  {/if}

  <div class="picker-filter">
    <Search aria-hidden="true" size={18} />
    <label for="login-search">
      {i18n.t('extension.login_picker.search_label')}
    </label>
    <input
      id="login-search"
      data-testid="login-search"
      type="search"
      bind:this={searchInput}
      bind:value={query}
      maxlength="200"
      autocomplete="off"
      placeholder={i18n.t('extension.login_picker.search_placeholder')}
    />
  </div>
  <p class="filter-chip">
    {i18n.t('extension.login_picker.filter_label')}
  </p>

  {#if error}
    <p class="error-message" role="alert">{error}</p>
  {:else if loading}
    <p class="picker-status">
      {i18n.t('extension.login_picker.loading')}
    </p>
  {:else if accounts.length === 0}
    <p class="picker-status">
      {i18n.t('extension.login_picker.no_results')}
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
