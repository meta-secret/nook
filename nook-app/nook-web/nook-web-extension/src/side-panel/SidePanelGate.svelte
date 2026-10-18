<!--
One centred column for the panel's gate views (setup, locked, no identity,
failure): an icon tile, then the view's own heading and controls.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import {
    CircleAlert,
    Fingerprint,
    KeyRound,
    Link2,
    Lock,
  } from '@lucide/svelte'
  import { SidePanelGateIcon } from './side-panel-state'

  type SidePanelGateProps = {
    readonly icon: SidePanelGateIcon
    readonly children: Snippet
  }

  let { icon, children }: SidePanelGateProps = $props()
</script>

<div class="side-panel-gate" data-gate={icon}>
  {#if icon === SidePanelGateIcon.Failure}
    <span class="side-panel-gate-icon" data-tone="failure" aria-hidden="true">
      <CircleAlert size={20} />
    </span>
  {:else}
    <span class="side-panel-gate-icon" aria-hidden="true">
      {#if icon === SidePanelGateIcon.Setup}
        <KeyRound size={20} />
      {:else if icon === SidePanelGateIcon.PinLocked}
        <Lock size={20} />
      {:else if icon === SidePanelGateIcon.PasskeyLocked}
        <Fingerprint size={20} />
      {:else}
        <Link2 size={20} />
      {/if}
    </span>
  {/if}
  {@render children()}
</div>
