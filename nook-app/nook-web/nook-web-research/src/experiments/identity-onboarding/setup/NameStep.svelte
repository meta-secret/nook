<!-- Creating a new identity in the Drive folder: it needs a name, sealed so
only its members see it. -->
<script lang="ts">
  import { Folder } from '@lucide/svelte'
  import Heading from './Heading.svelte'
  import type { SetupFlow } from './flow.svelte'
  import { folder } from './model'
  import { ui } from './ui'

  let { flow }: { flow: SetupFlow } = $props()

  const ready = $derived(flow.newName.trim() !== '')
</script>

<Heading eyebrow="Step 3 of 3 · Identity" title="Name your identity" sub="Only its members see the name." />

<input class={ui.input} bind:value={flow.newName} placeholder="Personal" aria-label="Identity name" />
<p class="mt-4 inline-flex items-center gap-2 font-mono text-[12px] text-[#80858c]">
  <Folder class="size-3.5" aria-hidden="true" /> {folder.join(' › ')}
</p>

<div class="mt-auto pt-10">
  <button type="button" class={ui.primary} disabled={!ready} onclick={() => flow.createIdentity()}>Create in Google Drive</button>
</div>
