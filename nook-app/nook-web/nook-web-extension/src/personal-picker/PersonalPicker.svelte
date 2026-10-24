<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import {
    PersonalPickerActivity,
    PersonalPickerController,
    PersonalPickerMessage,
    type PersonalPickerDocumentRequest,
  } from './personal-picker-controller.svelte'

  let {
    requestId,
    parentOrigin,
  }: {
    requestId: string
    parentOrigin: string
  } = $props()
  const documentRequest: PersonalPickerDocumentRequest = untrack(() => ({
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
    <h1>{picker.translate(PersonalPickerMessage.Title)}</h1>
    <p class="destination-origin">
      {picker.translate(PersonalPickerMessage.Description)}
    </p>
  </header>

  {#if picker.activity === PersonalPickerActivity.Failed}
    <p class="error-message" role="alert">
      {picker.translate(PersonalPickerMessage.Failed)}
    </p>
  {:else if picker.activity === PersonalPickerActivity.Loading}
    <p class="picker-status" role="status">
      {picker.translate(PersonalPickerMessage.Loading)}
    </p>
  {:else if picker.records.length === 0}
    <p class="picker-status" role="status">
      {picker.translate(PersonalPickerMessage.NoResults)}
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
