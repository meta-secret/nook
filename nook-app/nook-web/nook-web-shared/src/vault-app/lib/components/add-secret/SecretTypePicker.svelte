<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import {
    Globe,
    Braces,
    Sprout,
    StickyNote,
    ShieldCheck,
    KeyRound,
    ChevronRight,
    CreditCard,
    Paperclip,
  } from "@lucide/svelte";
  import { SecretType } from "$lib/nook";
  import type { VaultState } from "$lib/vault.svelte";

  let {
    vault,
    onSelect,
  }: {
    vault: VaultState;
    onSelect: (type: SecretType) => void;
  } = $props();
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
      <button
        type="button"
        class="nk-frame-nick nk-frame-interactive group flex min-h-20 items-center gap-3 px-3.5 py-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-login"
        onclick={() => onSelect(SecretType.Login)}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center border border-border text-foreground"
        >
          <Globe class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.VaultTypesLogin)}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t(I18N_KEYS.AddSecretWebsiteAccountDesc)}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      </button>
      <button
        type="button"
        class="nk-frame-nick nk-frame-interactive group flex min-h-20 items-center gap-3 px-3.5 py-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-authenticator"
        onclick={() => onSelect(SecretType.Authenticator)}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center border border-border text-foreground"
        >
          <ShieldCheck class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.VaultTypesAuthenticator)}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t(I18N_KEYS.AddSecretAuthenticatorDesc)}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      </button>
      <button
        type="button"
        class="nk-frame-nick nk-frame-interactive group flex min-h-20 items-center gap-3 px-3.5 py-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-api-key"
        onclick={() => onSelect(SecretType.ApiKey)}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center border border-border text-foreground"
        >
          <Braces class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.VaultTypesApiKey)}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t(I18N_KEYS.AddSecretTokenDesc)}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      </button>
      <button
        type="button"
        class="nk-frame-nick nk-frame-interactive group flex min-h-20 items-center gap-3 px-3.5 py-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-seed-phrase"
        onclick={() => onSelect(SecretType.SeedPhrase)}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center border border-border text-foreground"
        >
          <Sprout class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.VaultTypesSeedPhrase)}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t(I18N_KEYS.AddSecretBip39Desc)}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      </button>
      <button
        type="button"
        class="nk-frame-nick nk-frame-interactive group flex min-h-20 items-center gap-3 px-3.5 py-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-secure-note"
        onclick={() => onSelect(SecretType.SecureNote)}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center border border-border text-foreground"
        >
          <StickyNote class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.VaultTypesSecureNote)}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t(I18N_KEYS.AddSecretPrivateTextDesc)}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      </button>
      <button
        type="button"
        class="nk-frame-nick nk-frame-interactive group flex min-h-20 items-center gap-3 px-3.5 py-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-credit-card"
        onclick={() => onSelect(SecretType.CreditCard)}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center border border-border text-foreground"
        >
          <CreditCard class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.VaultTypesCreditCard)}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t(I18N_KEYS.AddSecretCreditCardDesc)}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      </button>
      <button
        type="button"
        class="nk-frame-nick nk-frame-interactive group flex min-h-20 items-center gap-3 px-3.5 py-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-file-attachment"
        onclick={() => onSelect(SecretType.FileAttachment)}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center border border-border text-foreground"
        >
          <Paperclip class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.VaultTypesFileAttachment)}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t(I18N_KEYS.AddSecretFileAttachmentDesc)}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      </button>
      <button
        type="button"
        class="nk-frame-nick nk-frame-interactive group flex min-h-20 items-center gap-3 px-3.5 py-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-passkey"
        onclick={() => onSelect(SecretType.Passkey)}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center border border-border text-foreground"
        >
          <KeyRound class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.VaultTypesPasskey)}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t(I18N_KEYS.AddSecretPasskeyDesc)}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      </button>
    </div>
</div>
