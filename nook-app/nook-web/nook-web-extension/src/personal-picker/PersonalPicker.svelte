<script lang="ts">
  import { I18N_KEYS } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { onMount, untrack } from 'svelte'
  import type { ExtensionI18n } from '../lib/i18n'
  import {
    PersonalPickerActivity,
    PersonalPickerController,
    type PersonalPickerDocumentRequest,
  } from './personal-picker-controller.svelte'

  let {
    i18n,
    requestId,
    parentOrigin,
  }: {
    i18n: ExtensionI18n
    requestId: string
    parentOrigin: string
  } = $props()
  const documentRequest: PersonalPickerDocumentRequest = untrack(() => ({
    i18n,
    requestId,
    parentOrigin,
  }))
  const picker = new PersonalPickerController(documentRequest)

  onMount(() => {
    picker.load()
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
  data-testid="personal-picker"
  aria-busy={picker.activity === PersonalPickerActivity.Selecting}
>
  <header class="login-picker-header">
    <h1>{picker.translate(I18N_KEYS.ExtensionPersonalPickerTitle)}</h1>
    <p class="destination-origin">
      {picker.translate(I18N_KEYS.ExtensionPersonalPickerDescription)}
    </p>
  </header>

  {#if picker.activity === PersonalPickerActivity.Failed}
    <p class="error-message" role="alert">
      {picker.translate(I18N_KEYS.ExtensionPersonalPickerFailed)}
    </p>
  {:else if picker.activity === PersonalPickerActivity.Loading}
    <p class="picker-status" role="status">
      {picker.translate(I18N_KEYS.ExtensionPersonalPickerLoading)}
    </p>
  {:else if picker.records.length === 0}
    <p class="picker-status" role="status">
      {picker.translate(I18N_KEYS.ExtensionPersonalPickerNoResults)}
    </p>
  {:else}
    <div class="authenticator-results" data-testid="personal-results">
      {#each picker.records as record (record.vaultStoreId + record.secretId)}
        <button
          type="button"
          class="authenticator-result secondary-button"
          disabled={picker.activity === PersonalPickerActivity.Selecting}
          onclick={() => picker.choose(record)}
        >
          <strong>{picker.primaryLabel(record)}</strong>
          <span>{record.summary}</span>
        </button>
      {/each}
    </div>
  {/if}
</main>
