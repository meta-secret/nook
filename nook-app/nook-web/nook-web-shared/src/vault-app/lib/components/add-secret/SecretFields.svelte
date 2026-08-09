<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import {
    ChevronDown,
    Eye,
    EyeOff,
    KeyRound,
    RefreshCw,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { SecretType, type PasswordGenerationOptions } from "$lib/nook";
  import type { VaultState } from "$lib/vault.svelte";
  import MarkdownEditor from "../MarkdownEditor.svelte";
  import SeedPhraseGrid from "../SeedPhraseGrid.svelte";
  import type { SecretFormState } from "./secret-form-state.svelte";

  let {
    vault,
    state,
    selectedType,
    onGeneratePassword,
  }: {
    vault: VaultState;
    state: SecretFormState;
    selectedType: SecretType;
    onGeneratePassword: (options: PasswordGenerationOptions) => string;
  } = $props();

  /** Must match `FILE_ATTACHMENT_MAX_BYTES` in nook-core. */
  const FILE_ATTACHMENT_MAX_BYTES = 1_048_576;

  function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return btoa(binary);
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleFileSelected(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    state.fileInputError = "";
    if (!file) return;
    if (file.size === 0) {
      state.fileInputError = vault.t(I18N_KEYS.AddSecretFileEmpty);
      input.value = "";
      return;
    }
    if (file.size > FILE_ATTACHMENT_MAX_BYTES) {
      const tArgs: Parameters<typeof vault.t>[1] = {
        max: formatFileSize(FILE_ATTACHMENT_MAX_BYTES),
      };
      state.fileInputError = vault.t(I18N_KEYS.AddSecretFileTooLarge, tArgs);
      input.value = "";
      return;
    }
    const buffer = new Uint8Array(await file.arrayBuffer());
    state.fileName = file.name;
    state.fileMimeType = file.type || "application/octet-stream";
    state.fileSizeBytes = buffer.byteLength;
    state.fileContentBase64 = bytesToBase64(buffer);
    if (!state.fileTitle.trim()) {
      state.fileTitle = file.name;
    }
  }

  function generatePassword() {
    const onGeneratePasswordArgs: Parameters<typeof onGeneratePassword>[0] = {
      length: state.generationLength,
      lowercase: state.generationLowercase,
      uppercase: state.generationUppercase,
      numbers: state.generationNumbers,
      symbols: state.generationSymbols,
    };
    state.password = onGeneratePassword(onGeneratePasswordArgs);
  }
</script>

    {#if selectedType === SecretType.Login}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t(I18N_KEYS.AddSecretWebsiteLabel)}</label
        >
        <input
          id="secret-label"
          type="text"
          data-testid="secret-label"
          bind:value={state.websiteUrl}
          placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderWebsite)}
          required
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
    {:else if selectedType === SecretType.ApiKey}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t(I18N_KEYS.AddSecretWebsiteLabel)}</label
        >
        <input
          id="secret-label"
          type="text"
          data-testid="secret-label"
          bind:value={state.websiteUrl}
          placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderWebsite)}
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
        <p class="text-xs text-muted-foreground text-pretty">
          {vault.t(I18N_KEYS.AddSecretApiKeyWebsiteHint)}
        </p>
      </div>
    {/if}

    {#if selectedType === SecretType.Login}
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="login-username"
            >{vault.t(I18N_KEYS.VaultFieldsUsername)}</label
          >
          <input
            id="login-username"
            data-testid="login-username"
            bind:value={state.username}
            autocomplete="username"
            required
            class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="secret-value"
            >{vault.t(I18N_KEYS.VaultFieldsPassword)}</label
          >
          <div class="relative">
            <input
              id="secret-value"
              type={state.showPasswordValue ? 'text' : 'password'}
              data-testid="secret-value"
              bind:value={state.password}
              autocomplete="new-password"
              required
              class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 py-2 pl-3 pr-10 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
            />
            <button
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={state.showPasswordValue
                ? vault.t(I18N_KEYS.VaultHideValue)
                : vault.t(I18N_KEYS.VaultShowValue)}
              data-testid="toggle-password-visibility"
              onclick={() => (state.showPasswordValue = !state.showPasswordValue)}
            >
              {#if state.showPasswordValue}
                <EyeOff class="size-4" />
              {:else}
                <Eye class="size-4" />
              {/if}
            </button>
          </div>
        </div>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="login-notes"
          >{vault.t(I18N_KEYS.AddSecretNotesLabel)}</label
        >
        <textarea
          id="login-notes"
          data-testid="login-notes"
          bind:value={state.notes}
          rows="3"
          class="flex w-full rounded-md border border-border/45 bg-background/80 px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        ></textarea>
      </div>

      <div
        class="rounded-xl border border-border/40 bg-muted/15 sm:border-border"
      >
        <button
          type="button"
          class="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
          data-testid="password-generator-toggle"
          aria-expanded={state.showPasswordOptions}
          onclick={() => (state.showPasswordOptions = !state.showPasswordOptions)}
        >
          <span class="inline-flex items-center gap-2">
            <KeyRound class="size-4" />
            {vault.t(I18N_KEYS.AddSecretGeneratePassword)}
          </span>
          <ChevronDown
            class="size-4 transition-transform {state.showPasswordOptions
              ? 'rotate-180'
              : ''}"
          />
        </button>
        {#if state.showPasswordOptions}
          <div
            class="space-y-3 border-t border-border/35 px-4 py-3 sm:border-border"
          >
            <div class="flex items-center gap-3">
              <label class="text-xs text-muted-foreground" for="password-length"
                >{vault.t(I18N_KEYS.AddSecretLength)}</label
              >
              <input
                id="password-length"
                type="range"
                min="8"
                max="64"
                bind:value={state.generationLength}
                class="h-1 flex-1 accent-primary"
              />
              <span class="w-6 text-right text-xs">{state.generationLength}</span>
            </div>
            <div class="grid grid-cols-4 gap-2 text-xs">
              <label
                ><input type="checkbox" bind:checked={state.generationLowercase} /> a-z</label
              >
              <label
                ><input type="checkbox" bind:checked={state.generationUppercase} /> A-Z</label
              >
              <label
                ><input type="checkbox" bind:checked={state.generationNumbers} /> 0-9</label
              >
              <label
                ><input type="checkbox" bind:checked={state.generationSymbols} />
                {vault.t(I18N_KEYS.AddSecretSymbols)}</label
              >
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="w-full"
              data-testid="generate-password-btn"
              onclick={generatePassword}
            >
              <RefreshCw class="size-3.5" />
              {vault.t(I18N_KEYS.AddSecretGenerateBtn)}
            </Button>
          </div>
        {/if}
      </div>
    {:else if selectedType === SecretType.ApiKey}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-value"
          >{vault.t(I18N_KEYS.VaultFieldsKey)}</label
        >
        <textarea
          id="secret-value"
          data-testid="secret-value"
          bind:value={state.apiKey}
          rows="4"
          placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderKey)}
          required
          spellcheck="false"
          class="flex w-full rounded-md border border-border/45 bg-background/80 px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        ></textarea>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="api-key-expiration"
          >{vault.t(I18N_KEYS.VaultFieldsExpiresAt)}</label
        >
        <input
          id="api-key-expiration"
          type="date"
          data-testid="api-key-expiration"
          bind:value={state.expiresAt}
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
    {:else if selectedType === SecretType.SeedPhrase}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t(I18N_KEYS.VaultFieldsAccount)}</label
        >
        <input
          id="secret-label"
          data-testid="secret-label"
          bind:value={state.accountName}
          placeholder="Main wallet"
          required
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
      <div class="space-y-1.5">
        <span class="text-xs font-medium"
          >{vault.t(I18N_KEYS.VaultTypesSeedPhrase)}</span
        >
        <SeedPhraseGrid
          {vault}
          bind:value={state.seedPhrase}
          bind:valid={state.seedPhraseValid}
        />
      </div>
    {:else if selectedType === SecretType.Authenticator}
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="authenticator-issuer"
            >{vault.t(I18N_KEYS.VaultFieldsIssuer)}</label
          >
          <input
            id="authenticator-issuer"
            data-testid="authenticator-issuer"
            bind:value={state.authenticatorIssuer}
            placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderIssuer)}
            class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="authenticator-account"
            >{vault.t(I18N_KEYS.VaultFieldsAccount)}</label
          >
          <input
            id="authenticator-account"
            data-testid="authenticator-account"
            bind:value={state.authenticatorAccount}
            placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderAuthenticatorAccount)}
            class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
          />
        </div>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="authenticator-website"
          >{vault.t(I18N_KEYS.VaultFieldsWebsite)}</label
        >
        <input
          id="authenticator-website"
          type="text"
          data-testid="authenticator-website"
          bind:value={state.websiteUrl}
          placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderAuthenticatorWebsite)}
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
        <p class="text-xs text-muted-foreground text-pretty">
          {vault.t(I18N_KEYS.AddSecretAuthenticatorWebsiteHint)}
        </p>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="authenticator-secret"
          >{vault.t(I18N_KEYS.VaultFieldsAuthenticatorSecret)}</label
        >
        <textarea
          id="authenticator-secret"
          data-testid="authenticator-secret"
          bind:value={state.authenticatorSecret}
          rows="3"
          required
          spellcheck="false"
          placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderAuthenticatorSecret)}
          class="flex w-full rounded-md border border-border/45 bg-background/80 px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        ></textarea>
        <p class="text-xs text-muted-foreground text-pretty">
          {vault.t(I18N_KEYS.AddSecretAuthenticatorSecretHint)}
        </p>
      </div>
    {:else if selectedType === SecretType.CreditCard}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t(I18N_KEYS.VaultFieldsTitle)}</label
        >
        <input
          id="secret-label"
          type="text"
          data-testid="secret-label"
          bind:value={state.cardTitle}
          placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderTitle)}
          required
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="credit-card-cardholder"
          >{vault.t(I18N_KEYS.VaultFieldsCardholderName)}</label
        >
        <input
          id="credit-card-cardholder"
          type="text"
          data-testid="credit-card-cardholder"
          bind:value={state.cardholderName}
          placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderCardholder)}
          autocomplete="cc-name"
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="credit-card-number"
          >{vault.t(I18N_KEYS.VaultFieldsCardNumber)}</label
        >
        <div class="relative">
          <input
            id="credit-card-number"
            type={state.showCardNumber ? 'text' : 'password'}
            data-testid="credit-card-number"
            bind:value={state.cardNumber}
            placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderCardNumber)}
            autocomplete="cc-number"
            inputmode="numeric"
            required
            spellcheck="false"
            class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 py-2 pl-3 pr-10 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
          />
          <button
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={state.showCardNumber
              ? vault.t(I18N_KEYS.VaultHideValue)
              : vault.t(I18N_KEYS.VaultShowValue)}
            data-testid="toggle-card-number-visibility"
            onclick={() => (state.showCardNumber = !state.showCardNumber)}
          >
            {#if state.showCardNumber}
              <EyeOff class="size-4" />
            {:else}
              <Eye class="size-4" />
            {/if}
          </button>
        </div>
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <div class="space-y-1.5 sm:col-span-2">
          <span class="text-xs font-medium"
            >{vault.t(I18N_KEYS.VaultFieldsExpiration)}</span
          >
          <div class="grid grid-cols-2 gap-3">
            <input
              id="credit-card-exp-month"
              type="text"
              data-testid="credit-card-exp-month"
              bind:value={state.expirationMonth}
              placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderExpirationMonth)}
              aria-label={vault.t(I18N_KEYS.AddSecretPlaceholderExpirationMonth)}
              autocomplete="cc-exp-month"
              inputmode="numeric"
              maxlength="2"
              class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
            />
            <input
              id="credit-card-exp-year"
              type="text"
              data-testid="credit-card-exp-year"
              bind:value={state.expirationYear}
              placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderExpirationYear)}
              aria-label={vault.t(I18N_KEYS.AddSecretPlaceholderExpirationYear)}
              autocomplete="cc-exp-year"
              inputmode="numeric"
              maxlength="4"
              class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
            />
          </div>
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="credit-card-cvv"
            >{vault.t(I18N_KEYS.VaultFieldsCvv)}</label
          >
          <div class="relative">
            <input
              id="credit-card-cvv"
              type={state.showCvv ? 'text' : 'password'}
              data-testid="credit-card-cvv"
              bind:value={state.cardCvv}
              placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderCvv)}
              autocomplete="cc-csc"
              inputmode="numeric"
              spellcheck="false"
              class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 py-2 pl-3 pr-10 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
            />
            <button
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={state.showCvv
                ? vault.t(I18N_KEYS.VaultHideValue)
                : vault.t(I18N_KEYS.VaultShowValue)}
              data-testid="toggle-cvv-visibility"
              onclick={() => (state.showCvv = !state.showCvv)}
            >
              {#if state.showCvv}
                <EyeOff class="size-4" />
              {:else}
                <Eye class="size-4" />
              {/if}
            </button>
          </div>
        </div>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="credit-card-notes"
          >{vault.t(I18N_KEYS.AddSecretNotesLabel)}</label
        >
        <textarea
          id="credit-card-notes"
          data-testid="credit-card-notes"
          bind:value={state.cardNotes}
          rows="3"
          placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderNotes)}
          class="flex w-full rounded-md border border-border/45 bg-background/80 px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        ></textarea>
      </div>
    {:else if selectedType === SecretType.FileAttachment}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="file-attachment-title"
          >{vault.t(I18N_KEYS.VaultFieldsTitle)}</label
        >
        <input
          id="file-attachment-title"
          data-testid="file-attachment-title"
          bind:value={state.fileTitle}
          placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderFileTitle)}
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="file-attachment-input"
          >{vault.t(I18N_KEYS.VaultFieldsFile)}</label
        >
        <input
          id="file-attachment-input"
          type="file"
          data-testid="file-attachment-input"
          onchange={(event) => void handleFileSelected(event)}
          class="flex w-full rounded-md border border-border/45 bg-background/80 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
        <p class="text-xs text-muted-foreground text-pretty">
          {(() => { const tArgs2: Parameters<typeof vault.t>[1] = {
            max: formatFileSize(FILE_ATTACHMENT_MAX_BYTES),
          }; return vault.t(I18N_KEYS.AddSecretFileAttachmentHint, tArgs2); })()}
        </p>
        {#if state.fileInputError}
          <p
            class="text-sm text-destructive"
            role="alert"
            data-testid="file-attachment-error"
          >
            {state.fileInputError}
          </p>
        {/if}
        {#if state.fileName}
          <div
            class="rounded-md border border-border/40 bg-muted/15 px-3 py-2 text-xs"
            data-testid="file-attachment-selected"
          >
            <p class="truncate font-medium text-foreground">{state.fileName}</p>
            <p class="mt-0.5 text-muted-foreground">
              {formatFileSize(state.fileSizeBytes)}
              {#if state.fileMimeType}
                · {state.fileMimeType}
              {/if}
            </p>
          </div>
        {/if}
      </div>
    {:else}
      <div class="shrink-0 space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t(I18N_KEYS.VaultFieldsTitle)}</label
        >
        <input
          id="secret-label"
          data-testid="secret-label"
          bind:value={state.noteTitle}
          placeholder="Recovery instructions"
          required
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
      <div class="flex min-h-0 min-w-0 max-w-full flex-1 flex-col gap-1.5">
        <span class="shrink-0 text-xs font-medium"
          >{vault.t(I18N_KEYS.VaultFieldsNote)}
          <span class="text-muted-foreground">(Markdown)</span></span
        >
        <MarkdownEditor
          bind:value={state.noteBody}
          placeholder={vault.t(I18N_KEYS.AddSecretPlaceholderNote)}
          fill
        />
      </div>
    {/if}
