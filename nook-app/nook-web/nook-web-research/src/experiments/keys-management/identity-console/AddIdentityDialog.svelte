<script lang="ts">
  import { ArrowRight, X } from '@lucide/svelte'
  import { KeyStore, storeLabel } from '../_shared/key-graph'
  import { ACCENT, CAPS, RULE } from './console-ui'
  import {
    currentOpener,
    focusPrimary,
    keepFocusInside,
    panelById,
    PanelKind,
    restore,
  } from './focus-trap'

  interface Props {
    onClose: () => void
  }

  let { onClose }: Props = $props()

  const stores: KeyStore[] = [
    KeyStore.ApplePasswords,
    KeyStore.Bitwarden,
    KeyStore.OnePassword,
    KeyStore.SecurityKey,
  ]

  const PANEL_ID = 'add-identity-panel'
  const opener = currentOpener()

  $effect(() => {
    const panel = panelById(PANEL_ID)
    if (panel.kind === PanelKind.Mounted) focusPrimary(panel.node)
    return () => restore(opener)
  })

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose()
      return
    }
    const panel = panelById(PANEL_ID)
    if (panel.kind === PanelKind.Mounted) keepFocusInside(panel.node, event)
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
  <button
    type="button"
    class="absolute inset-0 bg-[#08090a]/85 backdrop-blur-sm"
    aria-label="Close"
    onclick={onClose}
  ></button>

  <div
    id={PANEL_ID}
    role="dialog"
    aria-modal="true"
    aria-labelledby="add-identity-title"
    class="relative max-h-[92svh] w-full max-w-xl overflow-y-auto border {RULE} border-t-2 bg-[#08090a] px-6 py-8 sm:px-10 sm:py-10"
    style={`border-top-color:${ACCENT}`}
  >
    <button
      type="button"
      class="absolute top-5 right-5 text-[#6d6d6a] transition hover:text-[#f4f3f0] motion-reduce:transition-none"
      aria-label="Close"
      onclick={onClose}
    >
      <X class="size-5" aria-hidden="true" />
    </button>

    <p class={CAPS} style={`color:${ACCENT}`}>Add identity</p>
    <h2
      id="add-identity-title"
      class="mt-5 max-w-md text-[1.6rem] leading-[1.14] font-medium tracking-[-0.03em] sm:text-4xl"
    >
      Present a passkey you already hold.
    </h2>

    <button
      data-primary
      type="button"
      class="mt-8 rounded-full px-6 py-3 text-sm font-medium text-[#08090a] transition hover:opacity-90 motion-reduce:transition-none"
      style={`background:${ACCENT}`}
    >
      Select a passkey
    </button>

    <p class="{CAPS} mt-10 text-[#6d6d6a]">Or name the manager holding it</p>
    <ul class="mt-1">
      {#each stores as store (store)}
        <li class="border-t {RULE}">
          <button
            type="button"
            class="flex w-full items-center justify-between py-3.5 text-left text-base text-[#9d9c98] transition hover:text-[#f4f3f0] motion-reduce:transition-none"
          >
            {storeLabel(store)}
            <ArrowRight class="size-4 shrink-0" aria-hidden="true" />
          </button>
        </li>
      {/each}
    </ul>

    <dl class="mt-10 grid gap-x-8 gap-y-5 sm:grid-cols-2">
      <div>
        <dt class="{CAPS} text-[#6d6d6a]">On another device</dt>
        <dd class="mt-2 flex items-center gap-4 text-sm">
          <button
            type="button"
            class="text-[#c9c8c4] transition hover:text-[#f4f3f0] motion-reduce:transition-none"
          >
            URL
          </button>
          <span class="text-[#3a3b3d]" aria-hidden="true">|</span>
          <button
            type="button"
            class="text-[#c9c8c4] transition hover:text-[#f4f3f0] motion-reduce:transition-none"
          >
            QR code
          </button>
        </dd>
      </div>
      <div>
        <dt class="{CAPS} text-[#6d6d6a]">Lost every identity</dt>
        <dd class="mt-2 text-sm">
          <button
            type="button"
            class="text-[#c9c8c4] transition hover:text-[#f4f3f0] motion-reduce:transition-none"
          >
            Recover
          </button>
        </dd>
      </div>
    </dl>

    <div class="mt-10 border-t {RULE} pt-6">
      <p class="text-base">Or create a new identity.</p>
      <button
        type="button"
        class="{CAPS} mt-3 flex items-center gap-3 text-left text-[#6d6d6a] transition hover:text-[#f4f3f0] motion-reduce:transition-none"
      >
        A new passkey, in the manager you choose
        <ArrowRight class="size-4" aria-hidden="true" />
      </button>
    </div>
  </div>
</div>
