<!--
Last step of the first-vault setup, shown once the vault exists. Backing up
is offered, never forced: skipping opens the vault, and the Sync rail entry
keeps its warning until a provider is added.
-->
<script lang="ts">
  import { Copy } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
  import FirstRunProgress from "./FirstRunProgress.svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import { FirstRunStage } from "$lib/vault/state/ui.svelte";

  let {
    vault,
    onSetUpBackup,
    onSkip,
  }: {
    vault: VaultState;
    onSetUpBackup: () => void;
    onSkip: () => void;
  } = $props();

  const body = $derived.by(() => {
    const bodyRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.FirstRunBackupBody,
      replacements: { vault: vault.firstRunVaultName },
    };
    return vault.t(bodyRequest);
  });
</script>

<section
  class="mx-auto grid w-full max-w-xl gap-6 py-6 sm:py-10"
  data-testid="first-run-backup-step"
>
  <FirstRunProgress {vault} current={FirstRunStage.Backup} />
  <div class="space-y-3">
    <span class="nk-tile nk-tile-lg" aria-hidden="true">
      <Copy class="size-5" />
    </span>
    <h1 class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground">
      {vault.t(I18N_KEYS.FirstRunBackupTitle)}
    </h1>
    <p class="max-w-[60ch] text-sm text-pretty text-muted-foreground">
      {body}
    </p>
  </div>
  <div class="flex flex-wrap items-center gap-3">
    <Button
      type="button"
      data-testid="first-run-backup-btn"
      onclick={onSetUpBackup}
    >
      {vault.t(I18N_KEYS.FirstRunBackupCta)}
    </Button>
    <Button
      type="button"
      variant="ghost"
      data-testid="first-run-backup-skip"
      onclick={onSkip}
    >
      {vault.t(I18N_KEYS.FirstRunBackupSkip)}
    </Button>
  </div>
</section>
