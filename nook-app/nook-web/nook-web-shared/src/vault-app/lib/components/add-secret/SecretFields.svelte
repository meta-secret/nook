<script lang="ts">
  import {
    ChevronDown,
    Eye,
    EyeOff,
    KeyRound,
    RefreshCw,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import type { VaultItemType } from "$lib/nook";
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
    selectedType: VaultItemType;
    onGeneratePassword: (
      length: number,
      lowercase: boolean,
      uppercase: boolean,
      numbers: boolean,
      symbols: boolean,
    ) => string;
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
      state.fileInputError = vault.t("add_secret.file_empty");
      input.value = "";
      return;
    }
    if (file.size > FILE_ATTACHMENT_MAX_BYTES) {
      state.fileInputError = vault.t("add_secret.file_too_large", {
        max: formatFileSize(FILE_ATTACHMENT_MAX_BYTES),
      });
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
    state.password = onGeneratePassword(
      state.generationLength,
      state.generationLowercase,
      state.generationUppercase,
      state.generationNumbers,
      state.generationSymbols,
    );
  }
</script>

    {#if selectedType === 'login'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t('add_secret.website_label')}</label
        >
        <input
          id="secret-label"
          type="text"
          data-testid="secret-label"
          bind:value={state.websiteUrl}
          placeholder={vault.t('add_secret.placeholder_website')}
          required
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
    {:else if selectedType === 'api-key'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t('add_secret.website_label')}</label
        >
        <input
          id="secret-label"
          type="text"
          data-testid="secret-label"
          bind:value={state.websiteUrl}
          placeholder={vault.t('add_secret.placeholder_website')}
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
        <p class="text-xs text-muted-foreground text-pretty">
          {vault.t('add_secret.api_key_website_hint')}
        </p>
      </div>
    {/if}

    {#if selectedType === 'login'}
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="login-username"
            >{vault.t('vault.fields.username')}</label
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
            >{vault.t('vault.fields.password')}</label
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
                ? vault.t('vault.hide_value')
                : vault.t('vault.show_value')}
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
          >{vault.t('add_secret.notes_label')}</label
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
            {vault.t('add_secret.generate_password')}
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
                >{vault.t('add_secret.length')}</label
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
                {vault.t('add_secret.symbols')}</label
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
              {vault.t('add_secret.generate_btn')}
            </Button>
          </div>
        {/if}
      </div>
    {:else if selectedType === 'api-key'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-value"
          >{vault.t('vault.fields.key')}</label
        >
        <textarea
          id="secret-value"
          data-testid="secret-value"
          bind:value={state.apiKey}
          rows="4"
          placeholder={vault.t('add_secret.placeholder_key')}
          required
          spellcheck="false"
          class="flex w-full rounded-md border border-border/45 bg-background/80 px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        ></textarea>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="api-key-expiration"
          >{vault.t('vault.fields.expires')}</label
        >
        <input
          id="api-key-expiration"
          type="date"
          data-testid="api-key-expiration"
          bind:value={state.expiresAt}
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
    {:else if selectedType === 'seed-phrase'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t('vault.fields.account')}</label
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
          >{vault.t('vault.types.seed_phrase')}</span
        >
        <SeedPhraseGrid
          {vault}
          bind:value={state.seedPhrase}
          bind:valid={state.seedPhraseValid}
        />
      </div>
    {:else if selectedType === 'authenticator'}
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="authenticator-issuer"
            >{vault.t('vault.fields.issuer')}</label
          >
          <input
            id="authenticator-issuer"
            data-testid="authenticator-issuer"
            bind:value={state.authenticatorIssuer}
            placeholder={vault.t('add_secret.placeholder_issuer')}
            class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="authenticator-account"
            >{vault.t('vault.fields.account')}</label
          >
          <input
            id="authenticator-account"
            data-testid="authenticator-account"
            bind:value={state.authenticatorAccount}
            placeholder={vault.t('add_secret.placeholder_authenticator_account')}
            class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
          />
        </div>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="authenticator-website"
          >{vault.t('vault.fields.website')}</label
        >
        <input
          id="authenticator-website"
          type="text"
          data-testid="authenticator-website"
          bind:value={state.websiteUrl}
          placeholder={vault.t('add_secret.placeholder_authenticator_website')}
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
        <p class="text-xs text-muted-foreground text-pretty">
          {vault.t('add_secret.authenticator_website_hint')}
        </p>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="authenticator-secret"
          >{vault.t('vault.fields.authenticator_secret')}</label
        >
        <textarea
          id="authenticator-secret"
          data-testid="authenticator-secret"
          bind:value={state.authenticatorSecret}
          rows="3"
          required
          spellcheck="false"
          placeholder={vault.t('add_secret.placeholder_authenticator_secret')}
          class="flex w-full rounded-md border border-border/45 bg-background/80 px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        ></textarea>
        <p class="text-xs text-muted-foreground text-pretty">
          {vault.t('add_secret.authenticator_secret_hint')}
        </p>
      </div>
    {:else if selectedType === 'credit-card'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t('vault.fields.title')}</label
        >
        <input
          id="secret-label"
          type="text"
          data-testid="secret-label"
          bind:value={state.cardTitle}
          placeholder={vault.t('add_secret.placeholder_title')}
          required
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="credit-card-cardholder"
          >{vault.t('vault.fields.cardholder_name')}</label
        >
        <input
          id="credit-card-cardholder"
          type="text"
          data-testid="credit-card-cardholder"
          bind:value={state.cardholderName}
          placeholder={vault.t('add_secret.placeholder_cardholder')}
          autocomplete="cc-name"
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="credit-card-number"
          >{vault.t('vault.fields.card_number')}</label
        >
        <div class="relative">
          <input
            id="credit-card-number"
            type={state.showCardNumber ? 'text' : 'password'}
            data-testid="credit-card-number"
            bind:value={state.cardNumber}
            placeholder={vault.t('add_secret.placeholder_card_number')}
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
              ? vault.t('vault.hide_value')
              : vault.t('vault.show_value')}
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
            >{vault.t('vault.fields.expiration')}</span
          >
          <div class="grid grid-cols-2 gap-3">
            <input
              id="credit-card-exp-month"
              type="text"
              data-testid="credit-card-exp-month"
              bind:value={state.expirationMonth}
              placeholder={vault.t('add_secret.placeholder_expiration_month')}
              aria-label={vault.t('add_secret.placeholder_expiration_month')}
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
              placeholder={vault.t('add_secret.placeholder_expiration_year')}
              aria-label={vault.t('add_secret.placeholder_expiration_year')}
              autocomplete="cc-exp-year"
              inputmode="numeric"
              maxlength="4"
              class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
            />
          </div>
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="credit-card-cvv"
            >{vault.t('vault.fields.cvv')}</label
          >
          <div class="relative">
            <input
              id="credit-card-cvv"
              type={state.showCvv ? 'text' : 'password'}
              data-testid="credit-card-cvv"
              bind:value={state.cardCvv}
              placeholder={vault.t('add_secret.placeholder_cvv')}
              autocomplete="cc-csc"
              inputmode="numeric"
              spellcheck="false"
              class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 py-2 pl-3 pr-10 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
            />
            <button
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={state.showCvv
                ? vault.t('vault.hide_value')
                : vault.t('vault.show_value')}
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
          >{vault.t('add_secret.notes_label')}</label
        >
        <textarea
          id="credit-card-notes"
          data-testid="credit-card-notes"
          bind:value={state.cardNotes}
          rows="3"
          placeholder={vault.t('add_secret.placeholder_notes')}
          class="flex w-full rounded-md border border-border/45 bg-background/80 px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        ></textarea>
      </div>
    {:else if selectedType === 'file-attachment'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="file-attachment-title"
          >{vault.t('vault.fields.title')}</label
        >
        <input
          id="file-attachment-title"
          data-testid="file-attachment-title"
          bind:value={state.fileTitle}
          placeholder={vault.t('add_secret.placeholder_file_title')}
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="file-attachment-input"
          >{vault.t('vault.fields.file')}</label
        >
        <input
          id="file-attachment-input"
          type="file"
          data-testid="file-attachment-input"
          onchange={(event) => void handleFileSelected(event)}
          class="flex w-full rounded-md border border-border/45 bg-background/80 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
        <p class="text-xs text-muted-foreground text-pretty">
          {vault.t('add_secret.file_attachment_hint', {
            max: formatFileSize(FILE_ATTACHMENT_MAX_BYTES),
          })}
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
          >{vault.t('vault.fields.title')}</label
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
          >{vault.t('vault.fields.note')}
          <span class="text-muted-foreground">(Markdown)</span></span
        >
        <MarkdownEditor
          bind:value={state.noteBody}
          placeholder={vault.t('add_secret.placeholder_note')}
          fill
        />
      </div>
    {/if}
