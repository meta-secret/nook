<!--
What a connecting extension asks for and which device it is, beside its
request and its approval: one tile per permission, then the device's
fingerprint, its public keys folded under it.
-->
<script lang="ts">
  import { ChevronDown } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import type { ExtensionConnectRequest } from '$lib/extension/connect'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    ExtensionConsentScopeIcon,
    ExtensionConsentScopeTranslation,
  } from './extension-connect-consent-state'
  import {
    ExtensionConsentIdentityText,
    type ExtensionConsentIdentityTextLayout,
  } from './extension-consent-identity-text'

  let {
    vault,
    request,
  }: { vault: VaultState; request: ExtensionConnectRequest } = $props()

  /** The device id in groups of four, as fingerprints read elsewhere. */
  const deviceGroups = $derived(
    request.deviceId.toUpperCase().match(/.{1,4}/g) || [],
  )
  const keyLayout: ExtensionConsentIdentityTextLayout = { head: 14, tail: 10 }
  const keys = $derived([
    {
      label: vault.t(I18N_KEYS.ExtensionConsentEncryptionKey),
      full: request.devicePublicKey,
      shown: new ExtensionConsentIdentityText(request.devicePublicKey).truncate(
        keyLayout,
      ),
    },
    {
      label: vault.t(I18N_KEYS.ExtensionConsentSigningKey),
      full: request.deviceSigningPublicKey,
      shown: new ExtensionConsentIdentityText(
        request.deviceSigningPublicKey,
      ).truncate(keyLayout),
    },
  ])
</script>

<dl class="nk-subpanel-recessed grid content-start gap-5 p-5 text-sm">
  <div class="grid gap-2">
    <dt class="nk-subpanel-head">
      {vault.t(I18N_KEYS.ExtensionConsentRequestedAccess)}
    </dt>
    <dd>
      <ul class="grid grid-cols-2 gap-2" data-testid="extension-connect-scopes">
        {#each request.scopes as scope (scope)}
          {@const Icon = new ExtensionConsentScopeIcon(scope).component}
          <li
            class="flex min-w-0 items-center gap-2 border border-border/50 px-3 py-2 text-foreground"
            data-scope={scope}
          >
            <Icon
              class="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span class="truncate">
              {vault.t(new ExtensionConsentScopeTranslation(scope).key)}
            </span>
          </li>
        {/each}
      </ul>
    </dd>
  </div>
  <div class="grid gap-2">
    <dt class="nk-subpanel-head">
      {vault.t(I18N_KEYS.ExtensionConsentDevice)}
    </dt>
    <dd>
      <details class="group" data-testid="extension-connect-device">
        <summary
          class="flex w-fit cursor-pointer list-none items-center gap-2 font-mono text-sm tracking-[0.08em] text-foreground [&::-webkit-details-marker]:hidden"
          data-testid="extension-request-device"
        >
          {deviceGroups.join(' ')}
          <ChevronDown
            class="size-3.5 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <dl class="mt-2 grid gap-1 font-mono text-[11px] text-muted-foreground">
          {#each keys as key (key.label)}
            <div class="flex min-w-0 gap-2">
              <dt class="shrink-0">{key.label}</dt>
              <dd class="truncate" title={key.full}>{key.shown}</dd>
            </div>
          {/each}
        </dl>
      </details>
    </dd>
  </div>
</dl>
