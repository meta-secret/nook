<!-- Create/edit inputs for a person, address, identity document or bank account. -->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { SecretType } from '$lib/nook'
  import type { VaultState } from '$lib/vault.svelte'
  import DocumentKindPicker from './DocumentKindPicker.svelte'
  import PersonalTextField from './PersonalTextField.svelte'
  import {
    ADDRESS_FIELDS,
    DOMESTIC_ACCOUNT_FIELDS,
    INTERNATIONAL_ACCOUNT_FIELDS,
    PERSON_FIELDS,
    documentFields,
  } from './personal-data-fields'
  import type {
    PersonalDataFormState,
    PersonalDataFormType,
  } from './personal-data-form-state.svelte'

  let {
    vault,
    state,
    selectedType,
  }: {
    vault: VaultState
    state: PersonalDataFormState
    selectedType: PersonalDataFormType
  } = $props()
</script>

<div class="grid gap-4 sm:grid-cols-2" data-testid="personal-data-fields">
  {#if selectedType === SecretType.Person}
    {#each PERSON_FIELDS as field (field.key)}
      <PersonalTextField {vault} {field} bind:value={state.person[field.key]} />
    {/each}
  {:else if selectedType === SecretType.Address}
    {#each ADDRESS_FIELDS as field (field.key)}
      <PersonalTextField {vault} {field} bind:value={state.address[field.key]} />
    {/each}
  {:else if selectedType === SecretType.IdentityDocument}
    <div class="space-y-1.5 sm:col-span-2">
      <span class="nk-field-label" id="identity-document-kind-label"
        >{vault.t(I18N_KEYS.VaultFieldsDocumentKind)}</span
      >
      <DocumentKindPicker
        {vault}
        labelId="identity-document-kind-label"
        bind:kind={state.document.kind}
      />
    </div>
    {#each documentFields(state.document.kind) as field (field.key)}
      <PersonalTextField
        {vault}
        {field}
        bind:value={state.document[field.key]}
        bind:shown={state.showDocumentNumber}
      />
    {/each}
  {:else if selectedType === SecretType.InternationalAccount}
    {#each INTERNATIONAL_ACCOUNT_FIELDS as field (field.key)}
      <PersonalTextField
        {vault}
        {field}
        bind:value={state.internationalAccount[field.key]}
        bind:shown={state.showIban}
      />
    {/each}
  {:else}
    {#each DOMESTIC_ACCOUNT_FIELDS as field (field.key)}
      <PersonalTextField
        {vault}
        {field}
        bind:value={state.domesticAccount[field.key]}
        bind:shown={state.showAccountNumber}
      />
    {/each}
  {/if}
</div>
