<!--
The way to the Nook tab. While the next connect step is the person's on the
page beside the panel, a strip right on top of the connect card points at
that page with chevrons marching toward its edge; pointing at it speeds them
up.
Clicking it brings the Nook tab forward. The connect card's step line says
what to do there; the strip only shows the way.
-->
<script lang="ts">
  import { ChevronLeft, ChevronRight } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { type ExtensionI18n, extensionLocaleCatalog } from '../lib/i18n'
  import { SidePanelTabPointer } from './side-panel-connect-state'

  type SidePanelTabGuideProps = {
    readonly i18n: ExtensionI18n
    /** Left or Right; the panel renders no strip for None. */
    readonly pointer: SidePanelTabPointer
    readonly onfocustab: () => void
  }

  let { i18n, pointer, onfocustab }: SidePanelTabGuideProps = $props()

  /** The chevron nearest the page lights last, so the march leads there. */
  const chevrons = [3, 2, 1, 0]
</script>

<button
  type="button"
  class="side-panel-tab-pointer"
  data-testid="side-panel-tab-pointer"
  data-direction={pointer}
  aria-label={i18n.t(
    extensionLocaleCatalog.plainExtensionTranslation(
      I18N_KEYS.ExtensionConnectTabShowTab,
    ),
  )}
  onclick={onfocustab}
>
  {#each chevrons as step (step)}
    <span
      class="side-panel-tab-pointer-chevron"
      style:--side-panel-pointer-step={step}
      aria-hidden="true"
    >
      {#if pointer === SidePanelTabPointer.Right}
        <ChevronRight size={36} strokeWidth={2.5} />
      {:else}
        <ChevronLeft size={36} strokeWidth={2.5} />
      {/if}
    </span>
  {/each}
</button>
