<script lang="ts">
  import { onMount } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import { getVaultManager, type NookVaultManager } from '$lib/nook'
  import type { AppKind } from '$lib/app-kind'
  import type { VaultState } from '$lib/vault.svelte'

  let { vault, appKind }: { vault: VaultState; appKind: AppKind } = $props()

  let manager = $state<NookVaultManager | undefined>(undefined)
  let requestJson = $state('')
  let capsuleReady = $state(false)
  let importedCount = $state(0)
  let busy = $state(false)
  let errorMessage = $state('')
  let sourceWindow: Window | undefined = undefined

  onMount(() => {
    void getVaultManager().then((value) => {
      manager = value
    })
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== 'https://nokey.sh' ||
        event.source !== sourceWindow ||
        typeof event.data !== 'object' ||
        !event.data
      ) {
        return
      }
      const message = event.data as { kind?: string; capsule?: string }
      if (message.kind === 'nook-migration-ready' && requestJson) {
        sourceWindow?.postMessage(
          { kind: 'nook-migration-request', request: requestJson },
          'https://nokey.sh',
        )
      } else if (
        message.kind === 'nook-migration-capsule' &&
        message.capsule &&
        manager
      ) {
        void acceptCapsule(message.capsule)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  })

  async function startMigration() {
    if (!manager || (appKind !== 'simple' && appKind !== 'sentinel')) return
    busy = true
    errorMessage = ''
    try {
      requestJson = manager.beginVaultMigration(
        appKind,
        Date.now() + 5 * 60 * 1000,
      )
      sourceWindow = window.open(
        'https://nokey.sh/migration.html',
        'nook-legacy-migration',
        'popup,width=620,height=760',
      ) ?? undefined
      if (!sourceWindow) throw new Error(vault.t('migration.popup_blocked'))
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
    }
  }

  async function acceptCapsule(capsule: string) {
    if (!manager || !requestJson) return
    busy = true
    errorMessage = ''
    try {
      await manager.acceptVaultMigrationCapsule(
        requestJson,
        capsule,
        Date.now(),
      )
      capsuleReady = true
      sourceWindow?.close()
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
    }
  }

  async function finishMigration() {
    if (!manager) return
    busy = true
    errorMessage = ''
    try {
      importedCount = await manager.finishVaultMigrationWithPasskey(
        window.location.hostname,
        appKind === 'sentinel' ? 'Nook Sentinel Vault' : 'Nook Simple Vault',
        vault.t('migration.passkey_label'),
      )
      capsuleReady = false
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
    }
  }
</script>

<section class="mx-auto max-w-2xl rounded-xl border border-border bg-card p-6 shadow-lg">
  <p class="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
    {vault.t('migration.eyebrow')}
  </p>
  <h1 class="mt-2 text-2xl font-semibold text-foreground">
    {vault.t('migration.destination_title')}
  </h1>
  <p class="mt-3 text-sm leading-6 text-muted-foreground">
    {vault.t('migration.destination_description')}
  </p>

  {#if importedCount > 0}
    <p class="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm" role="status">
      {vault.t('migration.complete', { count: String(importedCount) })}
    </p>
  {:else if capsuleReady}
    <Button class="mt-5" disabled={busy} onclick={() => void finishMigration()}>
      {vault.t('migration.create_passkey')}
    </Button>
  {:else}
    <Button class="mt-5" disabled={busy || !manager} onclick={() => void startMigration()}>
      {busy ? vault.t('migration.working') : vault.t('migration.start')}
    </Button>
  {/if}

  {#if errorMessage}
    <p class="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
      {errorMessage}
    </p>
  {/if}
</section>
