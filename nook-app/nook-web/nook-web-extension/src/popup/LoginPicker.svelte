<script lang="ts">
  import { I18N_KEYS } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { Search } from '@lucide/svelte'
  import { onMount, untrack } from 'svelte'
  import type { ExtensionI18n } from '../lib/i18n'
  import {
    LoginPickerActivity,
    LoginPickerController,
  } from './login-picker-controller.svelte'

  let {
    i18n,
    requestId,
    parentOrigin,
  }: {
    i18n: ExtensionI18n
    requestId: string
    parentOrigin: string
  } = $props()
  const picker = untrack(() => {
    const documentRequest: ConstructorParameters<
      typeof LoginPickerController
    >[0] = { i18n, requestId, parentOrigin }
    return new LoginPickerController(documentRequest)
  })

  $effect(() => picker.load(picker.query))

  onMount(() => {
    const searchInput = document.getElementById('login-search')
    if (searchInput instanceof HTMLInputElement) {
      searchInput.focus()
    }
    const close = picker.close.bind(picker)
    window.addEventListener('pagehide', close)
    return () => {
      window.removeEventListener('pagehide', close)
      picker.close()
    }
  })
</script>

<main
  class="authenticator-picker login-picker"
  data-testid="login-picker"
  aria-busy={picker.activity === LoginPickerActivity.Selecting}
>
  <header class="login-picker-header">
    <h1>{picker.translate(I18N_KEYS.ExtensionLoginPickerTitle)}</h1>
    {#if picker.destinationOrigin}
      <p class="destination-origin" data-testid="login-destination">
        {picker.destinationLabel(picker.destinationOrigin)}
      </p>
    {/if}
  </header>

  <div class="login-picker-search">
    <div class="picker-filter">
      <Search aria-hidden="true" size={18} />
      <label for="login-search">
        {picker.translate(I18N_KEYS.ExtensionLoginPickerSearchLabel)}
      </label>
      <input
        id="login-search"
        data-testid="login-search"
        type="search"
        bind:value={picker.query}
        disabled={picker.activity === LoginPickerActivity.Selecting}
        maxlength="200"
        autocomplete="off"
        placeholder={picker.translate(
          I18N_KEYS.ExtensionLoginPickerSearchPlaceholder,
        )}
      />
    </div>
    <p class="filter-chip">
      {picker.translate(I18N_KEYS.ExtensionLoginPickerFilterLabel)}
    </p>
  </div>

  {#if picker.activity === LoginPickerActivity.Failed}
    <p class="error-message" role="alert">
      {picker.translate(I18N_KEYS.ExtensionLoginPickerFailed)}
    </p>
  {:else if picker.activity === LoginPickerActivity.Loading}
    <p class="picker-status" role="status">
      {picker.translate(I18N_KEYS.ExtensionLoginPickerLoading)}
    </p>
  {:else if picker.accounts.length === 0}
    <p class="picker-status" role="status">
      {picker.translate(I18N_KEYS.ExtensionLoginPickerNoResults)}
    </p>
  {:else}
    <div class="authenticator-results" data-testid="login-results">
      {#each picker.accounts as account (account.vaultStoreId + account.secretId)}
        <button
          type="button"
          class="authenticator-result secondary-button"
          disabled={picker.activity === LoginPickerActivity.Selecting}
          onclick={() => picker.choose(account)}
        >
          <strong>{picker.primaryLabel(account)}</strong>
          <span>{account.websiteHost}</span>
          <small>{account.vaultName}</small>
        </button>
      {/each}
    </div>
  {/if}
</main>
