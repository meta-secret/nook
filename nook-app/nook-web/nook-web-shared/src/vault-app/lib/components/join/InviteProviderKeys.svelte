<!--
The keys a join asks for: one compact form per provider of the invite whose
key this device adds, each under the location it reaches. An S3 provider
takes an access key ID and its secret, GitHub a token; secrets are password
inputs with no reveal and no name. Rust validates what is typed when the
join goes on.
-->
<script lang="ts">
  import { Archive, KeyRound } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    InviteKeyKind,
    InviteKeyNeed,
    InviteKeyRequestKind,
    type InviteKeyEntry,
    type InviteKeyProvider,
  } from '$lib/vault/invite-join-keys'

  let {
    vault,
    entries = $bindable([]),
    disabled,
  }: {
    vault: VaultState
    /** One entry per provider the join asks a key for, in invite order. */
    entries: InviteKeyEntry[]
    disabled: boolean
  } = $props()

  const request = $derived(vault.inviteKeyRequest)

  function providerOf(entry: InviteKeyEntry): InviteKeyProvider | false {
    switch (request.kind) {
      case InviteKeyRequestKind.None:
        return false
      case InviteKeyRequestKind.Asked:
        return (
          request.providers.find(
            (provider) => provider.index === entry.index,
          ) || false
        )
    }
  }

  const needKey = $derived.by(() => {
    switch (request.kind) {
      case InviteKeyRequestKind.None:
        return ''
      case InviteKeyRequestKind.Asked:
        switch (request.need) {
          case InviteKeyNeed.AtLeastOne:
            return I18N_KEYS.JoinKeysRequired
          case InviteKeyNeed.Optional:
            return I18N_KEYS.JoinKeysOptional
        }
    }
  })

  const fieldClass =
    'h-10 w-full border border-border bg-card px-3 font-mono text-xs text-foreground outline-none focus-visible:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'
</script>

{#if needKey}
  <fieldset class="grid gap-3" data-testid="join-provider-keys">
    <legend class="nk-label">{vault.t(I18N_KEYS.JoinKeysTitle)}</legend>
    <p
      class="text-xs text-muted-foreground"
      data-testid="join-provider-keys-need"
    >
      {vault.t(needKey)}
    </p>
    {#each entries as entry (entry.index)}
      {@const provider = providerOf(entry)}
      {#if provider}
        <div
          class="grid gap-2 border border-dashed border-border p-3"
          data-testid="join-provider-key-{entry.index}"
        >
          <p
            class="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground"
          >
            {#if entry.kind === InviteKeyKind.S3}
              <Archive
                class="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            {:else}
              <KeyRound
                class="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            {/if}
            <span class="truncate" data-testid="join-provider-key-label"
              >{provider.label}</span
            >
          </p>
          {#if entry.kind === InviteKeyKind.S3}
            <label class="grid gap-1 text-xs text-muted-foreground">
              {vault.t(I18N_KEYS.ProviderSetupS3AccessKeyIdLabel)}
              <input
                type="text"
                class={fieldClass}
                autocomplete="off"
                spellcheck="false"
                autocapitalize="none"
                {disabled}
                data-testid="join-s3-access-key-id-input"
                bind:value={entry.accessKeyId}
              />
            </label>
            <label class="grid gap-1 text-xs text-muted-foreground">
              {vault.t(I18N_KEYS.ProviderSetupS3SecretAccessKeyLabel)}
              <input
                type="password"
                class={fieldClass}
                autocomplete="off"
                spellcheck="false"
                autocapitalize="none"
                {disabled}
                data-testid="join-s3-secret-access-key-input"
                bind:value={entry.secretAccessKey}
              />
            </label>
          {:else}
            <label class="grid gap-1 text-xs text-muted-foreground">
              {vault.t(I18N_KEYS.ProviderSetupPatLabel)}
              <input
                type="password"
                class={fieldClass}
                autocomplete="off"
                spellcheck="false"
                autocapitalize="none"
                {disabled}
                data-testid="join-github-token-input"
                bind:value={entry.token}
              />
            </label>
          {/if}
        </div>
      {/if}
    {/each}
  </fieldset>
{/if}
