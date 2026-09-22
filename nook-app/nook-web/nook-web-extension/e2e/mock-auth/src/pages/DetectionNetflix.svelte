<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  import {
    NETFLIX_MOCK_USERNAME,
    NetflixAuthMockScenario,
    NetflixAuthTransitionKind,
  } from '../lib/netflix-auth-flow'
  import { navigate } from '../lib/navigation'

  const EVIDENCE_KEY = 'netflix-submission-evidence'
  const PASSWORD_AUTOCOMPLETE: HTMLInputAttributes['autocomplete'] = 'password'
  let username = $state('')
  let password = $state('')
  let hiddenPasswordField: HTMLInputElement
  let auxiliaryActivationCount = $state(0)
  let error = $state('')

  function recordAuxiliary(event: Event): void {
    event.preventDefault()
    auxiliaryActivationCount += 1
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const submittedControl =
      event.submitter instanceof HTMLButtonElement
        ? ((label) => (label ? label.trim() : ''))(event.submitter.textContent)
        : ''
    const completed =
      NetflixAuthMockScenario.transition({
        username,
        hiddenPassword: hiddenPasswordField.value,
        submittedControl,
        formMethod: form.method,
        formHasAction: form.hasAttribute('action'),
        auxiliaryActivationCount,
      }) === NetflixAuthTransitionKind.Completed
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        submittedControl,
        identifierMatched: username === NETFLIX_MOCK_USERNAME,
        hiddenPasswordUntouched: hiddenPasswordField.value === '',
        postWithoutAction:
          form.method === 'post' && !form.hasAttribute('action'),
        auxiliaryControlsUntouched: auxiliaryActivationCount === 0,
      }),
    )
    if (!completed) {
      error = 'Authentication was not completed.'
      return
    }
    navigate('/plain/success')
  }
</script>

<main>
  <h1>Enter your info to sign in</h1>
  <p data-testid="mock-auth-scenario">netflix-identifier</p>
  {#if error}<p role="alert">{error}</p>{/if}
  <h2 data-uia="subheader">Or get started with a new account.</h2>
  <form
    method="post"
    data-uia="responsive-full-page-container-layout+container"
    data-testid="netflix-login-form"
    onsubmit={submit}
  >
    <div
      data-uia="field-userLoginId+container"
      data-hcw-form-control-container="true"
    >
      <label for=":R5akql6l9allbaldakkm:" data-uia="field-userLoginId+label"
        >Email or mobile number</label
      ><input
        id=":R5akql6l9allbaldakkm:"
        name="userLoginId"
        type="text"
        autocomplete="email"
        data-uia="field-userLoginId"
        data-hcw-form-control-element="true"
        bind:value={username}
      />
    </div>
    <div
      style="height: 0; overflow: hidden"
      data-testid="netflix-hidden-password-container"
    >
      <div
        data-uia="field-password+container"
        data-hcw-form-control-container="true"
      >
        <label for=":R59lal6l9allbaldakkm:" data-uia="field-password+label"
          >Password</label
        ><input
          id=":R59lal6l9allbaldakkm:"
          bind:this={hiddenPasswordField}
          name="password"
          type="password"
          autocomplete={PASSWORD_AUTOCOMPLETE}
          data-uia="field-password"
          data-hcw-form-control-element="true"
          bind:value={password}
        />
      </div>
    </div>
    <button type="submit" data-uia="continue-button">Continue</button>
    <button
      type="button"
      data-uia="help-menu-toggle-expanded"
      onclick={recordAuxiliary}>Get Help</button
    >
  </form>
  <div
    class="grecaptcha-badge"
    style="visibility: hidden; overflow: hidden; height: 60px"
    data-testid="netflix-invisible-recaptcha"
  >
    <div class="grecaptcha-logo" style="visibility: hidden">
      <iframe
        title="reCAPTCHA"
        src="about:blank#recaptcha-enterprise-size-invisible"
        style="visibility: hidden; width: 256px; height: 60px"
      ></iframe>
    </div>
  </div>
  <p data-testid="netflix-recaptcha-disclosure">
    This page is protected by reCAPTCHA to ensure you're not a bot.
  </p>
  <footer>
    <a href="/help" onclick={recordAuxiliary}>Questions? Contact us.</a>
    <a href="/terms" onclick={recordAuxiliary}>Terms of Use</a>
    <a href="/privacy" onclick={recordAuxiliary}>Privacy</a>
    <label
      >Language<select onchange={recordAuxiliary}
        ><option>English</option></select
      ></label
    >
  </footer>
</main>
