<!--
The quiet "or" between the identities a provider holds and the option to
create a new one.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'

  let { vault }: { vault: VaultState } = $props()
</script>

<div class="flex items-center gap-3" aria-hidden="true">
  <span class="h-px flex-1 bg-border"></span>
  <span class="nk-spec tracking-[0.2em] uppercase">
    {vault.t(I18N_KEYS.FirstRunOr)}
  </span>
  <span class="h-px flex-1 bg-border"></span>
</div>
