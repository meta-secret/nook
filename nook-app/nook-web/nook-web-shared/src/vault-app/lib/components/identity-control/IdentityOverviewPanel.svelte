<!--
The current identity's overview, opened beside its card on the hub: actions
first, details after. The same panel serves an identity with a vault open
and one unlocked without any.
-->
<script lang="ts">
  import { X } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { NookIdentityHealth } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import type { WorkspaceSection } from '$lib/vault/state/ui.svelte'
  import { Button } from '$lib/components/ui/button'
  import type { KeyringRename } from '$lib/vault/identity-control.svelte'
  import { IdentityStandingPresentation } from './identity-standing'
  import IdentityPanel from './IdentityPanel.svelte'

  let {
    vault,
    health,
    onOpen,
    onAddSyncProvider,
    onClose,
  }: {
    vault: VaultState
    health: NookIdentityHealth
    onOpen: (section: WorkspaceSection) => void
    onAddSyncProvider: () => void
    onClose: () => void
  } = $props()

  const control = $derived(vault.identityControl)
  const snapshot = $derived(control.snapshot)
  const canRename = $derived(
    new IdentityStandingPresentation(snapshot).isMember(),
  )
  let editingId = $state('')
  let draft = $state('')
  let renameError = $state('')
  const editing = $derived(
    snapshot !== false && editingId === snapshot.identityId,
  )

  function beginRename(): void {
    if (snapshot === false) return
    editingId = snapshot.identityId
    draft = snapshot.identityLabel
    renameError = ''
  }

  async function saveRename(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (!editing || control.busy) return
    renameError = ''
    const request: KeyringRename = { identityId: editingId, label: draft }
    const renamed = await control.renameKeyring(request)
    if (renamed.isOk()) editingId = ''
    else renameError = vault.t(renamed.error.translationKey)
  }
</script>

<div class="grid gap-4">
  <header class="flex items-center justify-between gap-3">
    <h2 class="text-lg font-semibold tracking-tight text-foreground">
      {vault.t(I18N_KEYS.IdentityOverviewEyebrow)}
    </h2>
    <div class="flex flex-wrap items-center justify-end gap-2">
      {#if canRename && !editing}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={control.busy}
          data-testid="identity-overview-rename"
          onclick={beginRename}
        >
          {vault.t(I18N_KEYS.IdentityControlRenameKeyring)}
        </Button>
      {/if}
      <button
        type="button"
        class="grid size-8 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
        title={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
        data-testid="identity-overview-close"
        onclick={onClose}
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>
  </header>
  {#if canRename && editing}
    <form class="grid gap-2" onsubmit={saveRename}>
      <label for="identity-rename-input" class="text-sm font-medium">
        {vault.t(I18N_KEYS.NewIdentityNameLabel)}
      </label>
      <p id="identity-rename-visibility" class="text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.FirstRunNameBody)}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <input
          id="identity-rename-input"
          type="text"
          required
          maxlength="64"
          autocomplete="off"
          aria-describedby="identity-rename-visibility"
          disabled={control.busy}
          class="h-9 min-w-0 flex-1 border border-border bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          bind:value={draft}
          data-testid="identity-rename-input"
        />
        <Button
          type="submit"
          size="sm"
          disabled={control.busy}
          data-testid="identity-rename-save"
        >
          {vault.t(I18N_KEYS.CommonSave)}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={control.busy}
          data-testid="identity-rename-cancel"
          onclick={() => (editingId = '')}
        >
          {vault.t(I18N_KEYS.CommonCancel)}
        </Button>
      </div>
      {#if renameError}
        <p class="text-xs text-destructive" role="alert">{renameError}</p>
      {/if}
    </form>
  {/if}
  <IdentityPanel {vault} {health} {onOpen} {onAddSyncProvider} />
</div>
