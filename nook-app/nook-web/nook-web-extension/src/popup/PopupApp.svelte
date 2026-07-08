<script lang="ts">
  import { onMount } from 'svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import type {
    PasswordFormSummary,
    ScanPasswordFieldsResponse,
  } from '../../../nook-web-shared/src/extension/runtime-messages'
  import type { ExtensionI18n } from '../lib/i18n'
  import { generateSuggestedPassword } from '../lib/nook-wasm'

  type PopupState =
    | { status: 'loading'; tabTitle: string }
    | { status: 'unavailable'; tabTitle: string; message: string }
    | {
        status: 'ready'
        tabTitle: string
        summary: PasswordFormSummary
        generatedPassword?: string | undefined
      }

  let { i18n }: { i18n: ExtensionI18n } = $props()

  let state = $state<PopupState>({
    status: 'loading',
    tabTitle: '',
  })

  function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs[0])
      })
    })
  }

  function scanTab(tabId: number): Promise<ScanPasswordFieldsResponse> {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage<ScanPasswordFieldsResponse>(
        tabId,
        { type: 'nook:scan-password-fields' },
        (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve({ ok: false })
            return
          }

          resolve(response)
        },
      )
    })
  }

  async function loadPopup() {
    const activeTab = await queryActiveTab()
    const tabTitle = activeTab?.title ?? i18n.t('extension.popup.current_page')

    if (typeof activeTab?.id !== 'number') {
      state = {
        status: 'unavailable',
        tabTitle,
        message: i18n.t('extension.popup.open_web_page'),
      }
      return
    }

    const response = await scanTab(activeTab.id)

    if (!response.ok || !response.summary) {
      state = {
        status: 'unavailable',
        tabTitle,
        message: i18n.t('extension.popup.cannot_inspect_page'),
      }
      return
    }

    state = {
      status: 'ready',
      tabTitle,
      summary: response.summary,
    }

    if (response.summary.passwordFieldCount > 0) {
      state = {
        ...state,
        generatedPassword: await generateSuggestedPassword(),
      }
    }
  }

  onMount(() => {
    void loadPopup()
  })
</script>

<main class="popup-shell">
  <header class="popup-header">
    <NookIcon src="../icons/nook.png" alt="" class="popup-logo" />
    <div>
      <h1>Nook</h1>
      <p>{state.tabTitle || i18n.t('extension.popup.checking_this_page')}</p>
    </div>
    <button
      class="scan-button"
      type="button"
      data-testid="scan-active-tab"
      aria-label={i18n.t('extension.popup.scan_active_tab')}
      onclick={() => {
        void loadPopup()
      }}
    >
      {i18n.t('extension.popup.scan')}
    </button>
  </header>

  <section class="status-panel" aria-live="polite">
    <div>
      <span class="metric-label"
        >{i18n.t('extension.popup.password_fields')}</span
      >
      <strong
        data-testid="password-field-count"
        >{state.status === 'ready'
          ? state.summary.passwordFieldCount
          : '-'}</strong
      >
    </div>
    <div>
      <span class="metric-label">{i18n.t('extension.popup.login_fields')}</span>
      <strong
        data-testid="username-field-count"
        >{state.status === 'ready' ? state.summary.usernameFieldCount : '-'}</strong
      >
    </div>
    <div>
      <span class="metric-label">{i18n.t('extension.popup.forms')}</span>
      <strong data-testid="form-count"
        >{state.status === 'ready' ? state.summary.formCount : '-'}</strong
      >
    </div>
  </section>

  {#if state.status === 'loading'}
    <p class="status-message">{i18n.t('extension.popup.scanning_active_tab')}</p>
  {:else if state.status === 'unavailable'}
    <p class="status-message">{state.message}</p>
  {:else if state.summary.passwordFieldCount > 0}
    <p class="status-message">
      {i18n.t('extension.popup.found_password_fields')}
    </p>
    {#if state.generatedPassword}
      <section class="password-suggestion">
        <span>{i18n.t('extension.popup.suggested_password')}</span>
        <code data-testid="suggested-password">{state.generatedPassword}</code>
      </section>
    {/if}
  {:else}
    <p class="status-message">{i18n.t('extension.popup.no_password_fields')}</p>
  {/if}
</main>
