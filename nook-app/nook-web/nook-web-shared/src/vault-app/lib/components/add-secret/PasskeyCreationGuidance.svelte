<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { ArrowLeft, KeyRound } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import type { VaultState } from "$lib/vault.svelte";

  let {
    vault,
    onBack,
    onDone,
  }: {
    vault: VaultState;
    onBack: () => void;
    onDone: () => void;
  } = $props();
</script>

<div class="space-y-4" data-testid="passkey-creation-guidance">
    <div
      class="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/40 pb-3"
    >
      <div class="flex min-w-0 items-center gap-2">
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        data-testid="change-secret-type-btn"
        onclick={onBack}
      >
          <ArrowLeft class="size-3.5" />
          {vault.t(I18N_KEYS.AddSecretChangeType)}
        </button>
        <span class="text-muted-foreground/50" aria-hidden="true">·</span>
        <h3 class="truncate text-sm font-semibold text-foreground">
          {vault.t(I18N_KEYS.AddSecretTitleNewPasskey)}
        </h3>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="sm:min-w-[5rem]"
        data-testid="add-secret-cancel-btn"
        onclick={onDone}
      >
        {vault.t(I18N_KEYS.CommonDone)}
      </Button>
    </div>

    <div
      class="rounded-xl border border-border/40 bg-muted/15 p-5 sm:border-border"
    >
      <div
        class="mb-4 flex size-12 items-center justify-center rounded-xl border border-border/60 bg-background text-primary"
      >
        <KeyRound class="size-6" />
      </div>
      <h4 class="text-base font-semibold text-foreground">
        {vault.t(I18N_KEYS.AddSecretPasskeyCreationTitle)}
      </h4>
      <p class="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
        {vault.t(I18N_KEYS.AddSecretPasskeyCreationDescription)}
      </p>
      <p class="mt-3 text-xs leading-relaxed text-muted-foreground text-pretty">
        {vault.t(I18N_KEYS.AddSecretPasskeyCreationHint)}
      </p>
    </div>
</div>
