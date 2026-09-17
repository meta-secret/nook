<script lang="ts">
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { Search } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import type { WebsiteAuthenticatorOption } from '../lib/login-fill-messages'
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
  }: {
    i18n: ExtensionI18n
    requestId: string
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
      chrome.runtime.sendMessage(message, (response: unknown) => {
        if (
          message.type ===
          AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery
        ) {
          const decoded = runConcreteDecoder(
            AuthenticatorPickerQueryResponse.decode,
            response,
          )
          resolve(
            decoded.kind === ConcreteDecoderResultKind.Decoded
              ? {
                  kind: AuthenticatorPickerRuntimeResponseKind.Query,
                  response: decoded.value,
                }
              : { kind: AuthenticatorPickerRuntimeResponseKind.Rejected },
          )
          return
        }
        const decoded = runConcreteDecoder(
          AuthenticatorPickerSelectResponse.decode,
          response,
        )
        resolve(
          decoded.kind === ConcreteDecoderResultKind.Decoded
            ? { kind: AuthenticatorPickerRuntimeResponseKind.Selected }
            : { kind: AuthenticatorPickerRuntimeResponseKind.Rejected },
        )
      })
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
      window.close()
      return
    }
    busy = false
    error = translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerFailed)
  }

  $effect(() => {
    void loadAccounts(query)
  })

  onMount(() => {
    const searchInput = document.getElementById('authenticator-search')
    if (searchInput instanceof HTMLInputElement) searchInput.focus()
    const cancelPendingPicker = () => {
      if (completed) return
      completed = true
      const message: AuthenticatorPickerRuntimeMessage = {
        type: AuthenticatorPickerCancelMessageType.NookAuthenticatorPickerCancel,
        payload: { requestId },
      }
      void chrome.runtime.sendMessage(message)
    }
    window.addEventListener('pagehide', cancelPendingPicker)
    return () => window.removeEventListener('pagehide', cancelPendingPicker)
  })
</script>

<main class="authenticator-picker" data-testid="authenticator-picker">
  <p class="step-label">
    {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerStepLabel)}
  </p>
  <NookIcon src="../icons/nook.png" alt="" class="popup-logo companion-logo" />
  <h1>{translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerTitle)}</h1>
  <p class="description">
    {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerDescription)}
  </p>
  {#if destinationOrigin}
    <p class="destination-origin" data-testid="authenticator-destination">
      {destinationLabel(destinationOrigin)}
    </p>
  {/if}

  <div class="picker-filter">
    <Search aria-hidden="true" size={18} />
    <label for="authenticator-search">
      {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerSearchLabel)}
    </label>
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
  </div>
  <p class="filter-chip">
    {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerFilterLabel)}
  </p>

  {#if error}
    <p class="error-message" role="alert">{error}</p>
  {:else if loading}
    <p class="picker-status">
      {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerLoading)}
    </p>
  {:else if accounts.length === 0}
    <p class="picker-status">
      {translatePlain(I18N_KEYS.ExtensionAuthenticatorPickerNoResults)}
    </p>
  {:else}
    <div class="authenticator-results" data-testid="authenticator-results">
      {#each accounts as account (account.vaultStoreId + account.secretId)}
        <button
          type="button"
          class="authenticator-result secondary-button"
          disabled={busy}
          onclick={() => choose(account)}
        >
          <strong>{account.issuer}</strong>
          <span>{account.account}</span>
          <small>{account.vaultName}</small>
        </button>
      {/each}
    </div>
  {/if}
</main>
