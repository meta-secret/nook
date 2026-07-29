<script lang="ts">
  import { DemoVaultPresence as Presence } from './nook-auth-state'

  interface Props {
    presence: Presence
    onPresence: (next: Presence) => void
    light?: boolean
  }

  let { presence, onPresence, light = false }: Props = $props()
</script>

<div
  class={`fixed top-5 right-5 z-50 flex items-center gap-1 rounded-full border p-1 text-[11px] font-semibold tracking-wide backdrop-blur-md ${light ? 'border-black/15 bg-white/75 text-black' : 'border-white/15 bg-black/45 text-white'}`}
  role="group"
  aria-label="Demo presence"
>
  <button
    class={`rounded-full px-3 py-1.5 transition ${presence === Presence.Empty ? (light ? 'bg-black text-white' : 'bg-white text-black') : 'opacity-60 hover:opacity-100'}`}
    onclick={() => onPresence(Presence.Empty)}
  >
    Empty
  </button>
  <button
    class={`rounded-full px-3 py-1.5 transition ${presence === Presence.Existing ? (light ? 'bg-black text-white' : 'bg-white text-black') : 'opacity-60 hover:opacity-100'}`}
    onclick={() => onPresence(Presence.Existing)}
  >
    Vault exists
  </button>
</div>
