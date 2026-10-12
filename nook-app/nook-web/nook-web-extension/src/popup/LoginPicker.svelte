<script lang="ts">
  import { I18N_KEYS } from '../../../nook-web-shared/src/generated/i18n-keys'
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
  const documentRequest: ConstructorParameters<
    typeof LoginPickerController
  >[0] = untrack(() => ({ i18n, requestId, parentOrigin }))
  const picker = new LoginPickerController(documentRequest)

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
  data-testid="login-picker"
  class="picker-page"
  aria-busy={picker.activity === LoginPickerActivity.Selecting}
>
  <header>
    <h1>{picker.translate(I18N_KEYS.ExtensionLoginPickerTitle)}</h1>
    {#if picker.destinationOrigin}<p data-testid="login-destination">
        {picker.destinationLabel(picker.destinationOrigin)}
      </p>{/if}
  </header>
  <label for="login-search"
    >{picker.translate(I18N_KEYS.ExtensionLoginPickerSearchLabel)}</label
  ><input
    data-testid="login-search"
    id="login-search"
    type="search"
    bind:value={picker.query}
    autocomplete="off"
    disabled={picker.activity === LoginPickerActivity.Selecting}
  />
  {#if picker.activity === LoginPickerActivity.Failed}<p
      class="error"
      role="alert"
    >
      {picker.translate(I18N_KEYS.ExtensionLoginPickerFailed)}
    </p>{:else if picker.activity === LoginPickerActivity.Loading}<p
      role="status"
    >
      {picker.translate(I18N_KEYS.ExtensionLoginPickerLoading)}
    </p>{:else if !picker.accounts.length}<p>
      {picker.translate(I18N_KEYS.ExtensionLoginPickerNoResults)}
    </p>{:else}<div class="picker-results" data-testid="login-results">
      {#each picker.accounts as account (account.vaultStoreId + account.secretId)}<button
          data-testid="login-account"
          class="picker-row"
          disabled={picker.activity === LoginPickerActivity.Selecting}
          onclick={() => picker.choose(account)}
          ><strong>{picker.primaryLabel(account)}</strong><span
            >{account.websiteHost}</span
          ><small>{account.vaultName}</small></button
        >{/each}
    </div>{/if}
</main>
