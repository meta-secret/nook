<script lang="ts">
  import { ArrowRight, Fingerprint, X } from '@lucide/svelte'
  import { KeyStore, storeLabel } from '../_shared/key-graph'
  import { storeInk } from './console-ui'

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

  let primary = $state<HTMLButtonElement>()

  $effect(() => {
    primary?.focus()
  })

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose()
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
  <button
    type="button"
    class="absolute inset-0 bg-black/70 backdrop-blur-sm"
    aria-label="Close"
    onclick={onClose}
  ></button>

  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="add-identity-title"
    class="relative max-h-[92svh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-white/12 bg-[#151517] sm:rounded-2xl"
  >
    <div class="p-6 sm:p-7">
      <div class="flex items-start gap-4">
        <div class="min-w-0 flex-1">
          <h2 id="add-identity-title" class="text-[22px] leading-tight">
            Add existing identity
          </h2>
          <p class="mt-1.5 text-[13px] text-white/45">
            Choose a method to continue
          </p>
        </div>
        <button
          type="button"
          class="rounded-md p-1.5 text-white/55 transition hover:bg-white/10 hover:text-white motion-reduce:transition-none"
          aria-label="Close"
          onclick={onClose}
        >
          <X class="size-5" aria-hidden="true" />
        </button>
      </div>

      <button
        bind:this={primary}
        type="button"
        class="mt-6 flex w-full items-center justify-center gap-2.5 rounded-xl bg-white px-4 py-4 text-[15px] font-medium text-black transition hover:bg-white/85 motion-reduce:transition-none"
      >
        <Fingerprint class="size-5" aria-hidden="true" />
        Select a passkey
      </button>

      <ul class="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {#each stores as store (store)}
          <li>
            <button
              type="button"
              class="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border border-white/12 px-2 py-4 transition hover:border-white/35 motion-reduce:transition-none"
            >
              <span
                class="flex size-7 items-center justify-center rounded-lg"
                style={`background:${storeInk(store)}1f;border:1px solid ${storeInk(store)}59`}
                aria-hidden="true"
              >
                <Fingerprint
                  class="size-3.5"
                  style={`color:${storeInk(store)}`}
                />
              </span>
              <span class="text-center text-[12px] leading-tight">
                {storeLabel(store)}
              </span>
            </button>
          </li>
        {/each}
      </ul>

      <div class="mt-6 space-y-3.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-[13px] text-white/45">
            Add identity from another device
          </span>
          <span class="flex items-center gap-2 text-[13px]">
            <button type="button" class="hover:underline">URL</button>
            <span class="text-white/25" aria-hidden="true">|</span>
            <button type="button" class="hover:underline">QR code</button>
          </span>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-[13px] text-white/45">
            Lost access to your identity?
          </span>
          <button type="button" class="text-[13px] hover:underline">
            Recover
          </button>
        </div>
      </div>
    </div>

    <div
      class="flex flex-wrap items-center gap-4 border-t border-white/10 p-6 sm:p-7"
    >
      <div class="min-w-0 flex-1">
        <p class="text-[15px]">Create new identity</p>
        <p class="mt-1 text-[13px] text-white/45">
          A new passkey, in the manager you choose.
        </p>
      </div>
      <button
        type="button"
        class="flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2.5 text-[13px] transition hover:border-white/45 motion-reduce:transition-none"
      >
        Create
        <ArrowRight class="size-4" aria-hidden="true" />
      </button>
    </div>
  </div>
</div>
