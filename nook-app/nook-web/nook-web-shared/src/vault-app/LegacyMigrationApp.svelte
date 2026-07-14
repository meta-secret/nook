<script lang="ts">
  import { onMount } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import { getVaultManager, type NookVaultManager } from '$lib/nook'
  import { resolveAppLocaleFromTags, translate } from '$app-wasm'

  const locale = resolveAppLocaleFromTags([...navigator.languages])
  const t = (key: string) => translate(locale, key)

  let manager = $state<NookVaultManager | undefined>(undefined)
  let requestJson = $state('')
  let destinationOrigin = $state('')
  let protectionStatus = $state('loading')
  let pin = $state('')
  let busy = $state(false)
  let complete = $state(false)
  let errorMessage = $state('')
  let destinationWindow: Window | undefined = undefined

  onMount(() => {
    document.title = t('migration.page_title')
    void getVaultManager().then((value) => {
      manager = value
      void refreshProtectionStatus()
    })
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (
        (event.origin !== 'https://simple.nokey.sh' &&
          event.origin !== 'https://sentinel.nokey.sh') ||
        event.source !== window.opener ||
        typeof event.data !== 'object' ||
        !event.data
      ) {
        return
      }
      const message = event.data as { kind?: string; request?: string }
      if (message.kind !== 'nook-migration-request' || !message.request) return
      requestJson = message.request
      destinationOrigin = event.origin
      destinationWindow = event.source as Window
    }
    window.addEventListener('message', handleMessage)
    window.opener?.postMessage({ kind: 'nook-migration-ready' }, '*')
    return () => window.removeEventListener('message', handleMessage)
  })

  async function refreshProtectionStatus() {
    if (!manager) return
    protectionStatus = await manager.deviceProtectionStatus()
  }

  async function authorizeAndSend() {
    if (!manager || !requestJson || !destinationWindow) return
    busy = true
    errorMessage = ''
    try {
      if (protectionStatus === 'passkey') {
        await manager.unlockDeviceProtectionWithPasskey(window.location.hostname)
      } else if (protectionStatus === 'pin') {
        await manager.unlockPinDeviceIdentity(pin)
        pin = ''
      } else if (protectionStatus !== 'unlocked') {
        throw new Error(t('migration.no_legacy_identity'))
      }
      const capsule = await manager.buildVaultMigrationCapsule(
        requestJson,
        Date.now(),
      )
      destinationWindow.postMessage(
        { kind: 'nook-migration-capsule', capsule },
        destinationOrigin,
      )
      complete = true
      manager.lockDeviceIdentity()
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
      await refreshProtectionStatus()
    }
  }
</script>

<main class="min-h-screen bg-background px-4 py-10 text-foreground">
  <section class="mx-auto max-w-xl rounded-xl border border-border bg-card p-6 shadow-lg">
    <p class="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
      {t('migration.eyebrow')}
    </p>
    <h1 class="mt-2 text-2xl font-semibold">{t('migration.source_title')}</h1>
    <p class="mt-3 text-sm leading-6 text-muted-foreground">
      {t('migration.source_description')}
    </p>

    {#if protectionStatus === 'pin' && requestJson && !complete}
      <label class="mt-5 block text-sm font-medium" for="migration-pin">
        {t('migration.pin_label')}
      </label>
      <input
        id="migration-pin"
        type="password"
        class="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2"
        bind:value={pin}
        autocomplete="current-password"
      />
    {/if}

    {#if complete}
      <p class="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm" role="status">
        {t('migration.source_complete')}
      </p>
    {:else}
      <Button
        class="mt-5"
        disabled={busy || !requestJson || !manager || (protectionStatus === 'pin' && !pin.trim())}
        onclick={() => void authorizeAndSend()}
      >
        {busy ? t('migration.working') : t('migration.authorize')}
      </Button>
    {/if}

    {#if errorMessage}
      <p class="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
        {errorMessage}
      </p>
    {/if}
  </section>
</main>
