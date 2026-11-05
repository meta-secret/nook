<!--
The keyring's recovery passphrases, as keys on its ring: one row each with
its name and strength, removed from the row, and a dashed slot that adds
the next. A removed passphrase's words stop adding devices at once.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { KeyRound, Plus, Trash2 } from '@lucide/svelte'
  import type { IdentityRecoveryPassphraseView } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import type { RecoveryPassphraseRemoval } from '$lib/vault/identity-control.svelte'
  import { RecoveryWordsText } from '$lib/vault/recovery-words'
  import RecoveryPassphraseAdd from './RecoveryPassphraseAdd.svelte'
  import {
    RecoveryManagement,
    RecoveryPanelKind,
    RecoveryRemovalKind,
    recoveryManagement,
    type RecoveryRemoval,
  } from './recovery-passphrase-state'

  let { vault }: { vault: VaultState } = $props()

  const control = $derived(vault.identityControl)
  const snapshot = $derived(control.snapshot)
  const passphrases = $derived(
    snapshot === false ? [] : snapshot.recoveryPassphrases,
  )
  const management = $derived(
    snapshot === false
      ? RecoveryManagement.Unavailable
      : recoveryManagement(snapshot.standing),
  )
  const text = $derived(new RecoveryWordsText(vault))
  const busy = $derived(control.busy || vault.isVerifying)
  let panel = $state<RecoveryPanelKind>(RecoveryPanelKind.Listing)
  let removal = $state<RecoveryRemoval>({ kind: RecoveryRemovalKind.Idle })

  onMount(() => {
    void control.loadSnapshot()
  })

  function translated(
    ...[key, label]: readonly [string, string]
  ): string {
    const request: Parameters<typeof vault.t>[0] = {
      key,
      replacements: { label },
    }
    return vault.t(request)
  }

  function confirming(passphrase: IdentityRecoveryPassphraseView): boolean {
    return (
      removal.kind === RecoveryRemovalKind.Confirming &&
      removal.id === passphrase.id
    )
  }

  async function remove(
    passphrase: IdentityRecoveryPassphraseView,
  ): Promise<void> {
    const request: RecoveryPassphraseRemoval = {
      id: passphrase.id,
      label: passphrase.label,
    }
    await control.removeRecoveryPassphrase(request)
    removal = { kind: RecoveryRemovalKind.Idle }
  }
</script>

{#if management === RecoveryManagement.Allowed}
  <section class="grid gap-3" data-testid="recovery-passphrases">
    <h3 class="text-sm font-semibold text-foreground">
      {vault.t(I18N_KEYS.RecoveryPassphraseTitle)}
    </h3>
    {#if passphrases.length > 0}
      <ul
        class="grid gap-2"
        aria-label={vault.t(I18N_KEYS.RecoveryPassphraseListLabel)}
        data-testid="recovery-passphrase-list"
      >
        {#each passphrases as passphrase (passphrase.id)}
          <li
            class="grid gap-3 border border-border p-3"
            data-testid="recovery-passphrase"
            data-id={passphrase.id}
          >
            <div class="flex flex-wrap items-center gap-3">
              <span class="nk-tile nk-tile-sm shrink-0" aria-hidden="true">
                <KeyRound class="size-4" />
              </span>
              <span
                class="min-w-0 flex-[1_1_8rem] truncate text-sm font-semibold text-foreground"
                data-testid="recovery-passphrase-label"
              >
                {passphrase.label}
              </span>
              <span
                class="nk-tag shrink-0"
                data-testid="recovery-passphrase-strength"
                data-strength={passphrase.strength}
              >
                {text.strength(passphrase.strength)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                class="px-2 text-muted-foreground hover:text-destructive"
                aria-label={translated(
                  I18N_KEYS.RecoveryPassphraseRemoveLabel,
                  passphrase.label,
                )}
                data-testid="recovery-passphrase-remove"
                disabled={busy}
                onclick={() =>
                  (removal = {
                    kind: RecoveryRemovalKind.Confirming,
                    id: passphrase.id,
                  })}
              >
                <Trash2 class="size-3.5" />
              </Button>
            </div>
            {#if confirming(passphrase)}
              <div
                class="flex flex-col gap-2 border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive sm:flex-row sm:items-center sm:justify-between"
                data-testid="recovery-passphrase-remove-confirm"
              >
                <p>
                  {translated(
                    I18N_KEYS.RecoveryPassphraseRemoveConfirm,
                    passphrase.label,
                  )}
                </p>
                <div class="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    class="h-8 border-destructive/30 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy}
                    onclick={() =>
                      (removal = { kind: RecoveryRemovalKind.Idle })}
                  >
                    {vault.t(I18N_KEYS.CommonCancel)}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    class="h-8"
                    disabled={busy}
                    data-testid="recovery-passphrase-remove-confirm-btn"
                    onclick={() => void remove(passphrase)}
                  >
                    {vault.t(I18N_KEYS.RecoveryPassphraseRemove)}
                  </Button>
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if panel === RecoveryPanelKind.Adding}
      <RecoveryPassphraseAdd
        {vault}
        onClose={() => (panel = RecoveryPanelKind.Listing)}
      />
    {:else}
      <button
        type="button"
        class="flex w-full items-center gap-3 border border-dashed border-border px-3 py-3 text-left transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
        data-testid="recovery-passphrase-add"
        disabled={busy}
        onclick={() => (panel = RecoveryPanelKind.Adding)}
      >
        <span class="nk-tile nk-tile-sm shrink-0" aria-hidden="true">
          <Plus class="size-4" />
        </span>
        <span class="grid min-w-0">
          <span class="text-sm font-medium text-foreground">
            {vault.t(I18N_KEYS.RecoveryPassphraseAdd)}
          </span>
          <span class="text-xs text-pretty text-muted-foreground">
            {vault.t(I18N_KEYS.RecoveryPassphraseAddHint)}
          </span>
        </span>
      </button>
    {/if}
  </section>
{/if}
