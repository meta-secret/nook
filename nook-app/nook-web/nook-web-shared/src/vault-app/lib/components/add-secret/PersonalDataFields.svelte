<!-- Create/edit inputs for a person, address, identity document or bank account. -->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { SecretType } from '$lib/nook'
  import type { VaultState } from '$lib/vault.svelte'
  import PersonalTextField from './PersonalTextField.svelte'
  import {
    ADDRESS_FIELDS,
    BANK_ACCOUNT_FIELDS,
    DOCUMENT_FIELDS,
    IDENTITY_DOCUMENT_KINDS,
    PERSON_FIELDS,
    documentKindLabelKey,
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
    <div class="space-y-1.5">
      <label class="nk-field-label" for="identity-document-kind"
        >{vault.t(I18N_KEYS.VaultFieldsDocumentKind)}</label
      >
      <select
        id="identity-document-kind"
        data-testid="identity-document-kind"
        bind:value={state.document.kind}
        class="flex h-10 w-full rounded-none border border-input bg-background px-3 text-sm focus:outline-hidden focus:border-foreground/40 focus:ring-2 focus:ring-ring"
      >
        {#each IDENTITY_DOCUMENT_KINDS as kind (kind)}
          <option value={kind}>{vault.t(documentKindLabelKey(kind))}</option>
        {/each}
      </select>
    </div>
    {#each DOCUMENT_FIELDS as field (field.key)}
      <PersonalTextField
        {vault}
        {field}
        bind:value={state.document[field.key]}
        bind:shown={state.showDocumentNumber}
      />
    {/each}
  {:else}
    {#each BANK_ACCOUNT_FIELDS as field (field.key)}
      <PersonalTextField
        {vault}
        {field}
        bind:value={state.bankAccount[field.key]}
        bind:shown={state.showAccountNumber}
      />
    {/each}
  {/if}
</div>
