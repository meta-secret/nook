<!--
The panel's gate views (setup, locked, a new identity's key, failure) as one
companion keytag card centred in the page: the key chain or a square icon
tile, then the view's own heading and controls.
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
    /** What leads the card instead of the icon tile: the key chain. */
    readonly lead?: Snippet
    readonly children: Snippet
  }

  let { icon, lead, children }: SidePanelGateProps = $props()
</script>

<div class="side-panel-gate" data-gate={icon}>
  <div
    class="side-panel-keytag side-panel-gate-card"
    data-tone={icon === SidePanelGateIcon.Failure ? 'failure' : 'neutral'}
  >
    <div class="side-panel-keytag-body side-panel-gate-body">
      {#if lead}
        {@render lead()}
      {:else if icon === SidePanelGateIcon.Failure}
        <span
          class="side-panel-gate-icon"
          data-tone="failure"
          aria-hidden="true"
        >
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
  </div>
</div>
