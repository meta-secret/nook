<!--
The Nook Pilot's Fill 2FA code, answered in the side panel: search every
2FA item of the vaults this page may use and fill the chosen one's code. The
request belongs to the page that asked; the worker fills only that page, and
the panel shows where the code goes.
-->
<script lang="ts">
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import {
    CircleAlert,
    LoaderCircle,
    Search,
    ShieldCheck,
  } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import type { WebsiteAuthenticatorOption } from '../lib/login-fill-messages'
  import type { BrowserRuntimeMessageValue } from '../lib/browser-runtime-message'
  import {
    ConcreteDecoderResultKind,
    runConcreteDecoder,
  } from '../lib/concrete-decoder'
  import {
    AuthenticatorPickerCancelMessageType,
    AuthenticatorPickerQueryMessageType,
    AuthenticatorPickerQueryResponse,
    AuthenticatorPickerRuntimeResponseKind,
    AuthenticatorPickerSelectMessageType,
    AuthenticatorPickerSelectResponse,
    type AuthenticatorPickerCancelMessage,
    type AuthenticatorPickerQueryMessage,
    type AuthenticatorPickerRequestMessage,
    type AuthenticatorPickerRuntimeResponse,
    type AuthenticatorPickerSelectMessage,
  } from '../lib/authenticator-picker-messages'
  type AuthenticatorPickerRuntimeMessage =
    | AuthenticatorPickerQueryMessage
    | AuthenticatorPickerSelectMessage
    | AuthenticatorPickerCancelMessage
  import {
    ExtensionTranslationRequestKind,
    type ExtensionI18n,
    type ExtensionTranslationRequest,
    extensionLocaleCatalog,
  } from '../lib/i18n'

  let {
    i18n,
    requestId,
    ondone,
  }: {
    i18n: ExtensionI18n
    requestId: string
    /** The code was filled or the request was dropped: the panel shows
     * This site again. */
    ondone: () => void
  } = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  let query = $state('')
  let accounts = $state<WebsiteAuthenticatorOption[]>([])
  let destinationOrigin = $state('')
  let loading = $state(true)
  let busy = $state(false)
  let error = $state('')
  let querySequence = 0
  let completed = false

  function sendRuntimeMessage(
    message: AuthenticatorPickerRequestMessage,
  ): Promise<AuthenticatorPickerRuntimeResponse> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        message,
        (response: BrowserRuntimeMessageValue) => {
          if (
            message.type ===
            AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery
          ) {
            const decoded = runConcreteDecoder(
              AuthenticatorPickerQueryResponse.decode,
              response,
            )
            const queryResponse: AuthenticatorPickerRuntimeResponse =
              decoded.kind === ConcreteDecoderResultKind.Decoded
                ? {
                    kind: AuthenticatorPickerRuntimeResponseKind.Query,
                    response: decoded.value,
                  }
                : { kind: AuthenticatorPickerRuntimeResponseKind.Rejected }
            resolve(queryResponse)
            return
          }
          const decoded = runConcreteDecoder(
            AuthenticatorPickerSelectResponse.decode,
            response,
          )
          const selectionResponse: AuthenticatorPickerRuntimeResponse =
            decoded.kind === ConcreteDecoderResultKind.Decoded
              ? { kind: AuthenticatorPickerRuntimeResponseKind.Selected }
              : { kind: AuthenticatorPickerRuntimeResponseKind.Rejected }
          resolve(selectionResponse)
        },
      )
    })
  }

  function destinationLabel(origin: string): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionAuthenticatorPickerDestination,
      replacements: { origin },
    }
    return i18n.t(request)
  }

  /** Distinct names, so two items of one service stay apart. */
  function fillLabel(account: WebsiteAuthenticatorOption): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionActionFillCodeFor,
      replacements: {
        login: [account.issuer, account.account]
          .filter((part) => part !== '')
          .join(' '),
        vault: account.vaultName,
      },
    }
    return i18n.t(request)
  }

  /** "account · vault", leaving out an item saved without an account. */
  function subtitle(account: WebsiteAuthenticatorOption): string {
    return [account.account, account.vaultName]
      .filter((part) => part !== '')
      .join(' · ')
  }

  async function loadAccounts(searchQuery: string): Promise<void> {
    const sequence = ++querySequence
    loading = true
    error = ''
    const message: Parameters<typeof sendRuntimeMessage>[0] = {
      type: AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery,
      payload: { requestId, query: searchQuery },
    }
    const response = await sendRuntimeMessage(message)
    if (sequence !== querySequence) return
    loading = false
    if (response.kind !== AuthenticatorPickerRuntimeResponseKind.Query) {
      accounts = []
      destinationOrigin = ''
      error = translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerFailed)
      return
    }
    destinationOrigin = response.response.origin
    accounts = response.response.accounts
  }

  async function choose(account: WebsiteAuthenticatorOption): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    const message: Parameters<typeof sendRuntimeMessage>[0] = {
      type: AuthenticatorPickerSelectMessageType.NookAuthenticatorPickerSelect,
      payload: {
        requestId,
        vaultStoreId: account.vaultStoreId,
        secretId: account.secretId,
      },
    }
    const response = await sendRuntimeMessage(message)
    if (response.kind === AuthenticatorPickerRuntimeResponseKind.Selected) {
      completed = true
      ondone()
      return
    }
    busy = false
    error = translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerFailed)
  }

  /** The page's Nook Pilot hears the request is over and offers it again. */
  function cancel(): void {
    if (completed) return
    completed = true
    const message: AuthenticatorPickerRuntimeMessage = {
      type: AuthenticatorPickerCancelMessageType.NookAuthenticatorPickerCancel,
      payload: { requestId },
    }
    void chrome.runtime.sendMessage(message)
  }

  function dismiss(): void {
    cancel()
    ondone()
  }

  $effect(() => {
    void loadAccounts(query)
  })

  onMount(() => {
    const searchInput = document.getElementById('authenticator-search')
    if (searchInput instanceof HTMLInputElement) searchInput.focus()
    // Closing the panel ends the request, as closing its window did.
    window.addEventListener('pagehide', cancel)
    return () => window.removeEventListener('pagehide', cancel)
  })
</script>

<section
  class="side-panel-section side-panel-authenticator-picker"
  aria-labelledby="authenticator-picker-title"
  data-testid="authenticator-picker"
>
  <!-- Laid out as This site's heading: the label, then the name. -->
  <h1 id="authenticator-picker-title" class="side-panel-site-heading">
    <span class="side-panel-label">
      {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerStepLabel)}
    </span>
    <span class="side-panel-site-host">
      {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerTitle)}
    </span>
    {#if destinationOrigin}
      <span
        class="side-panel-authenticator-destination"
        data-testid="authenticator-destination"
      >
        {destinationLabel(destinationOrigin)}
      </span>
    {/if}
  </h1>

  <div class="side-panel-field side-panel-authenticator-search">
    <label for="authenticator-search">
      {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerSearchLabel)}
    </label>
    <span class="side-panel-authenticator-search-field">
      <Search size={14} aria-hidden="true" />
      <input
        id="authenticator-search"
        data-testid="authenticator-search"
        type="search"
        bind:value={query}
        maxlength="200"
        autocomplete="off"
        placeholder={translatePlain(
          I18N_KEYS.ExtensionAuthenticatorPickerSearchPlaceholder,
        )}
      />
    </span>
  </div>

  {#if error}
    <div class="side-panel-site-status">
      <p class="side-panel-site-status-failed" role="alert">
        <CircleAlert size={14} aria-hidden="true" />
        {error}
      </p>
    </div>
  {:else if loading}
    <div class="side-panel-site-status" role="status">
      <p class="side-panel-note">
        <LoaderCircle size={14} class="side-panel-spin" aria-hidden="true" />
        {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerLoading)}
      </p>
    </div>
  {:else if accounts.length === 0}
    <div class="side-panel-site-status">
      <p class="side-panel-note">
        {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerNoResults)}
      </p>
    </div>
  {:else}
    <ul class="side-panel-logins" data-testid="authenticator-results">
      {#each accounts as account (account.vaultStoreId + account.secretId)}
        <li class="side-panel-login" data-testid="authenticator-result">
          <span class="side-panel-login-icon" aria-hidden="true">
            <ShieldCheck size={16} />
          </span>
          <div class="side-panel-login-copy">
            <span class="side-panel-login-name" title={account.issuer}
              >{account.issuer}</span
            >
            {#if subtitle(account) !== ''}
              <span class="side-panel-login-vault">{subtitle(account)}</span>
            {/if}
          </div>
          <button
            type="button"
            class="side-panel-fill secondary-button"
            aria-label={fillLabel(account)}
            aria-disabled={busy}
            data-testid="authenticator-fill"
            onclick={() => void choose(account)}
          >
            {translatePlain(I18N_KEYS.ExtensionActionFillCode)}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="side-panel-authenticator-actions">
    <button
      type="button"
      class="side-panel-text-button"
      data-testid="authenticator-cancel"
      onclick={dismiss}
    >
      {translatePlain(I18N_KEYS.CommonCancel)}
    </button>
  </div>
</section>
