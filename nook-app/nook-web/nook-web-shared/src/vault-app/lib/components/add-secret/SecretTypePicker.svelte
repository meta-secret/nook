<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { ChevronRight } from '@lucide/svelte'
  import type { SecretCategory } from '$app-wasm'
  import { SecretType } from '$lib/nook'
  import type { VaultState } from '$lib/vault.svelte'
  import { VaultSections } from '$lib/vault/secret-sections'
  import { SecretTypePresentation } from '../vault/secret-item-view'

  let {
    vault,
    section,
    onSelect,
  }: {
    vault: VaultState
    /** Only this vault section's types are offered. */
    section: SecretCategory
    onSelect: (type: SecretType) => void
  } = $props()

  const entries = $derived(VaultSections.definition(section).types)

  function descriptionKey(type: SecretType): string {
    switch (type) {
      case SecretType.Login:
        return I18N_KEYS.AddSecretWebsiteAccountDesc
      case SecretType.Authenticator:
        return I18N_KEYS.AddSecretAuthenticatorDesc
      case SecretType.ApiKey:
        return I18N_KEYS.AddSecretTokenDesc
      case SecretType.SeedPhrase:
        return I18N_KEYS.AddSecretBip39Desc
      case SecretType.SecureNote:
        return I18N_KEYS.AddSecretPrivateTextDesc
      case SecretType.CreditCard:
        return I18N_KEYS.AddSecretCreditCardDesc
      case SecretType.FileAttachment:
        return I18N_KEYS.AddSecretFileAttachmentDesc
      case SecretType.Passkey:
        return I18N_KEYS.AddSecretPasskeyDesc
      case SecretType.Person:
        return I18N_KEYS.AddSecretPersonDesc
      case SecretType.Address:
        return I18N_KEYS.AddSecretAddressDesc
      case SecretType.IdentityDocument:
        return I18N_KEYS.AddSecretIdentityDocumentDesc
      case SecretType.InternationalAccount:
        return I18N_KEYS.AddSecretInternationalAccountDesc
      case SecretType.DomesticAccount:
        return I18N_KEYS.AddSecretDomesticAccountDesc
    }
  }
</script>

<div class="space-y-5">
  <div class="space-y-1">
    <h3 class="text-base font-semibold text-foreground">
      {vault.t(I18N_KEYS.AddSecretWhatSaving)}
    </h3>
    <p class="text-sm text-muted-foreground text-pretty">
      {vault.t(I18N_KEYS.AddSecretChooseTypeDesc)}
    </p>
  </div>
  <div
    class="grid grid-cols-1 gap-2 sm:grid-cols-2"
    data-testid="item-type-picker"
  >
    {#each entries as entry (entry.type)}
      {@const Icon = SecretTypePresentation.icon(entry.type)}
      <button
        type="button"
        class="nk-frame-nick nk-frame-interactive group flex min-h-20 items-center gap-3 px-3.5 py-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid={`item-type-${entry.testId}`}
        onclick={() => onSelect(entry.type)}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center border border-border text-foreground"
        >
          <Icon class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(entry.labelKey)}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t(descriptionKey(entry.type))}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      </button>
    {/each}
  </div>
</div>
