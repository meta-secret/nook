<!--
The identity this browser is about to create. A vault always belongs to an
identity, so the first vault is created from here: the identity and its
first key are made together with that vault.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { Fingerprint, Lock } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { StatusMark, StatusTag } from '$lib/components/ui/status-tag'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    children,
  }: {
    vault: VaultState
    /** The first-vault setup: create here or open an existing vault. */
    children: Snippet
  } = $props()
</script>

<article
  class="nk-frame-keytag col-span-full grid min-w-0 grid-cols-1 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]"
  aria-label={vault.t(I18N_KEYS.WorkspaceFirstIdentityTitle)}
  data-testid="identity-draft-card"
>
  <span class="nk-edge-glint" aria-hidden="true"></span>
  <div class="flex min-w-0 flex-col gap-4 px-4 pb-5 pt-5 sm:px-5">
    <header class="flex items-start gap-3.5">
      <span
        class="nk-monogram grid place-items-center border border-dashed border-input bg-transparent text-muted-foreground"
        aria-hidden="true"
      >
        <Fingerprint class="size-5" />
      </span>
      <div class="min-w-0 flex-1 pr-4">
        <h3 class="text-lg font-semibold tracking-tight text-foreground">
          {vault.t(I18N_KEYS.WorkspaceFirstIdentityTitle)}
        </h3>
        <div class="mt-2">
          <StatusTag
            mark={StatusMark.Icon}
            label={vault.t(I18N_KEYS.WorkspaceFirstIdentityStatus)}
          >
            {#snippet icon()}
              <Lock class="size-3" aria-hidden="true" />
            {/snippet}
          </StatusTag>
        </div>
      </div>
    </header>
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.WorkspaceFirstIdentityDescription)}
    </p>
  </div>
  <section
    class="min-w-0 border-t border-border p-5 sm:p-6 lg:border-l lg:border-t-0 lg:px-7"
    aria-label={vault.t(I18N_KEYS.WorkspaceFirstIdentityVaultLabel)}
  >
    <p class="nk-label nk-lockup mb-4">
      {vault.t(I18N_KEYS.WorkspaceFirstIdentityVaultLabel)}
    </p>
    {@render children()}
  </section>
</article>
