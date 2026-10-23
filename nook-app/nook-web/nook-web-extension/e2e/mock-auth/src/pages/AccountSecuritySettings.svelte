<script lang="ts">
  import { MOCK_AUTH_ACCOUNTS } from '../../accounts'
  import { verifyTotpCode } from '../lib/totp'
  import {
    DialogStep,
    QrLoad,
    SETUP_QR_EDGE_PX,
    SetupQrVariant,
    fetchSetupQrObjectUrl,
    nativeModalDialog,
    paintSetupQr,
    setupQrSvgPath,
    setupQrVariant,
  } from '../lib/setup-qr'

  /**
   * A signed-in account settings page modeled on a payments dashboard: the
   * authenticator dialog is a portal appended to <body> after a click on the
   * already-loaded page, with a fade-in, an asynchronously rendered QR code,
   * an "Enter code manually" reveal, and a verify step.
   */
  const enrollAccountCandidate = MOCK_AUTH_ACCOUNTS.find(
    (account) => account.totpSecret,
  )
  if (!enrollAccountCandidate?.totpSecret) {
    throw new Error('TOTP enrollment fixture account is missing')
  }
  const enrollSecret = enrollAccountCandidate.totpSecret
  const displayedSetupKey = enrollSecret.replace(/(.{4})(?=.)/gu, '$1 ')
  const variant = setupQrVariant(location.search)
  const nativeModal = nativeModalDialog(location.search)

  let step = $state(DialogStep.Closed)
  let qrLoad = $state(QrLoad.Pending)
  let qrImageUrl = $state('')
  let manualKeyShown = $state(false)
  let verifyError = $state('')
  let busy = $state(false)
  let updated = $state(false)

  function portal(node: HTMLElement) {
    document.body.append(node)
    return {
      destroy() {
        node.remove()
      },
    }
  }

  /** A native modal dialog renders in the top layer and makes the rest inert. */
  function modal(dialog: HTMLDialogElement) {
    dialog.showModal()
  }

  function paintedQr(canvas: HTMLCanvasElement) {
    paintSetupQr(canvas)
  }

  async function openDialog() {
    step = DialogStep.Scan
    qrLoad = QrLoad.Pending
    manualKeyShown = false
    verifyError = ''
    switch (variant) {
      case SetupQrVariant.AsyncImage:
        qrImageUrl = await fetchSetupQrObjectUrl()
        break
      case SetupQrVariant.InlineSvg:
      case SetupQrVariant.Canvas:
        await new Promise((resolve) => window.setTimeout(resolve, 400))
        break
    }
    qrLoad = QrLoad.Ready
  }

  function closeDialog() {
    step = DialogStep.Closed
    if (qrImageUrl) URL.revokeObjectURL(qrImageUrl)
    qrImageUrl = ''
  }

  async function onverify(event: SubmitEvent) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const code = new FormData(form).get('code')
    if (typeof code !== 'string') return
    busy = true
    verifyError = ''
    try {
      if (!(await verifyTotpCode(enrollSecret, code))) {
        verifyError = 'The code you entered is incorrect.'
        return
      }
      updated = true
      closeDialog()
    } finally {
      busy = false
    }
  }
</script>

<div class="dashboard" data-testid="mock-auth-account-security">
  <header class="topbar">
    <strong>Mock Auth</strong>
    <input
      type="search"
      name="search"
      placeholder="Search"
      aria-label="Search"
    />
  </header>
  <section class="panel">
    <h1>Personal details</h1>
    <p>{enrollAccountCandidate.username}</p>
    <label>
      Language
      <select name="language">
        <option>English (United States)</option>
        <option>Deutsch</option>
      </select>
    </label>
  </section>
  <section class="panel">
    <h2>Two-step authentication</h2>
    <table>
      <tbody>
        <tr>
          <td>Passkey</td>
          <td>MacBook Pro</td>
          <td><button type="button">Remove</button></td>
        </tr>
        <tr>
          <td>Authenticator app</td>
          <td>Added 2 months ago</td>
          <td>
            <button
              type="button"
              data-testid="mock-auth-update-authenticator"
              onclick={openDialog}>Update</button
            >
          </td>
        </tr>
      </tbody>
    </table>
    {#if updated}
      <p data-testid="mock-auth-authenticator-updated">
        Authenticator app updated
      </p>
    {/if}
  </section>
</div>

{#snippet dialogContent()}
  <header>
    <h2 id="authenticator-dialog-title">Update authenticator app</h2>
  </header>
  {#if step === DialogStep.Scan}
    <div class="body">
      <div>
        Scan this QR code to set up your account using your preferred
        authenticator app. Popular choices include <a
          href="https://support.google.com/accounts/answer/1066447"
          >Google Authenticator</a
        >,
        <a href="https://www.microsoft.com/security/mobile-authenticator-app"
          >Microsoft Authenticator</a
        >, and <a href="https://authy.com">Authy</a>.
      </div>
      {#if manualKeyShown}
        <h3>Enter this setup key in your authenticator app</h3>
        <div class="setup-key" data-testid="mock-auth-setup-key">
          {displayedSetupKey}
        </div>
        <button
          type="button"
          class="link"
          onclick={() => (manualKeyShown = false)}>Scan QR code instead</button
        >
      {:else}
        <div class="qr">
          {#if qrLoad === QrLoad.Pending}
            <div class="spinner" aria-label="Loading"></div>
          {:else if variant === SetupQrVariant.AsyncImage}
            <img data-testid="mock-auth-setup-qr" src={qrImageUrl} alt="" />
          {:else if variant === SetupQrVariant.InlineSvg}
            <svg
              data-testid="mock-auth-setup-qr"
              width={SETUP_QR_EDGE_PX}
              height={SETUP_QR_EDGE_PX}
              viewBox={`0 0 ${SETUP_QR_EDGE_PX} ${SETUP_QR_EDGE_PX}`}
              xmlns="http://www.w3.org/2000/svg"
              ><rect
                width={SETUP_QR_EDGE_PX}
                height={SETUP_QR_EDGE_PX}
                fill="#ffffff"
              /><path fill="#000000" d={setupQrSvgPath()} /></svg
            >
          {:else}
            <canvas
              data-testid="mock-auth-setup-qr"
              width={SETUP_QR_EDGE_PX}
              height={SETUP_QR_EDGE_PX}
              use:paintedQr
            ></canvas>
          {/if}
        </div>
        <button
          type="button"
          class="link"
          data-testid="mock-auth-enter-code-manually"
          onclick={() => (manualKeyShown = true)}>Enter code manually</button
        >
      {/if}
    </div>
    <footer>
      <button type="button" onclick={closeDialog}>Cancel</button>
      <button
        type="button"
        data-testid="mock-auth-setup-continue"
        onclick={() => (step = DialogStep.Verify)}>Continue</button
      >
    </footer>
  {:else}
    <form class="body" onsubmit={onverify}>
      <p>Enter the 6-digit code from your authenticator app.</p>
      {#if verifyError}
        <p class="error" role="alert">{verifyError}</p>
      {/if}
      <input
        data-testid="mock-auth-setup-code"
        name="code"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        aria-label="Authentication code"
      />
      <footer>
        <button type="button" onclick={closeDialog}>Cancel</button>
        <button type="submit" disabled={busy}>Verify</button>
      </footer>
    </form>
  {/if}
{/snippet}

{#if step !== DialogStep.Closed}
  {#if nativeModal}
    <dialog
      class="dialog"
      aria-labelledby="authenticator-dialog-title"
      data-testid="mock-auth-authenticator-dialog"
      use:portal
      use:modal
    >
      {@render dialogContent()}
    </dialog>
  {:else}
    <div class="backdrop" use:portal>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="authenticator-dialog-title"
        data-testid="mock-auth-authenticator-dialog"
      >
        {@render dialogContent()}
      </div>
    </div>
  {/if}
{/if}

<style>
  .dashboard {
    width: min(760px, calc(100vw - 32px));
    display: grid;
    gap: 16px;
  }
  .topbar {
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;
  }
  .panel {
    padding: 20px;
    border: 1px solid #d8dce5;
    border-radius: 12px;
    background: #fff;
  }
  table {
    width: 100%;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 35%);
    animation: fade-in 200ms ease-out;
  }
  .dialog {
    border: 0;
    width: min(440px, calc(100vw - 48px));
    padding: 24px;
    border-radius: 12px;
    background: #fff;
    animation: rise-in 240ms ease-out;
  }
  .dialog h2 {
    margin: 0 0 12px;
    font-size: 20px;
  }
  .body {
    display: grid;
    gap: 12px;
  }
  .qr {
    display: grid;
    place-items: center;
    min-height: 220px;
  }
  .spinner {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 3px solid #d8dce5;
    border-top-color: #635bff;
  }
  .setup-key {
    text-align: center;
    font:
      600 18px ui-monospace,
      monospace;
    letter-spacing: 0.08em;
  }
  .link {
    justify-self: center;
    border: 0;
    background: none;
    color: #635bff;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 35%);
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @keyframes rise-in {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.96);
    }
  }
</style>
