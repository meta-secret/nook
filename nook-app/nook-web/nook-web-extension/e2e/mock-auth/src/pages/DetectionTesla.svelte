<script lang="ts">
  import {
    TeslaAuthMockScenario,
    TeslaAuthPresentationState,
    TeslaAuthPrimaryActivationState,
    TeslaAuthTransitionKind,
  } from '../lib/tesla-auth-flow'
  import { navigate } from '../lib/navigation'

  const EVIDENCE_KEY = 'tesla-submission-evidence'

  let email = $state('')
  let password = $state('')
  let passwordStage = $state(false)
  let identifierActivation = $state(TeslaAuthPrimaryActivationState.Untouched)
  let passwordActivation = $state(TeslaAuthPrimaryActivationState.Untouched)
  let auxiliaryActivationCount = $state(0)
  let presentationState = $state(TeslaAuthPresentationState.Ready)

  function recordAuxiliary(event: MouseEvent): void {
    event.preventDefault()
    auxiliaryActivationCount += 1
  }

  function activateNext(event: SubmitEvent): void {
    event.preventDefault()
    const control = event.submitter
    if (!(control instanceof HTMLButtonElement)) return
    identifierActivation =
      TeslaAuthMockScenario.nextPrimaryActivation(identifierActivation)
    const submittedControl = TeslaAuthMockScenario.submittedControl(
      control.innerText,
    )
    const transition = TeslaAuthMockScenario.transition({
      email,
      submittedControl,
      primaryActivation: identifierActivation,
      auxiliaryActivationCount,
    })
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        submittedControl,
        emailMatch: TeslaAuthMockScenario.emailMatch(email),
        identifierActivation,
        auxiliaryControlsUntouched: auxiliaryActivationCount === 0,
      }),
    )
    if (transition === TeslaAuthTransitionKind.Rejected) {
      presentationState = TeslaAuthPresentationState.Rejected
      return
    }
    passwordStage = true
  }

  function activateSignIn(event: SubmitEvent): void {
    event.preventDefault()
    const control = event.submitter
    if (!(control instanceof HTMLButtonElement)) return
    passwordActivation =
      TeslaAuthMockScenario.nextPrimaryActivation(passwordActivation)
    const submittedControl = TeslaAuthMockScenario.submittedControl(
      control.innerText,
    )
    const transition = TeslaAuthMockScenario.passwordTransition({
      password,
      submittedControl,
      primaryActivation: passwordActivation,
      auxiliaryActivationCount,
    })
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        identifierControl: TeslaAuthMockScenario.submittedControl('Next'),
        emailMatch: TeslaAuthMockScenario.emailMatch(email),
        identifierActivation,
        passwordControl: submittedControl,
        passwordMatch: TeslaAuthMockScenario.passwordMatch(password),
        passwordActivation,
        auxiliaryControlsUntouched: auxiliaryActivationCount === 0,
      }),
    )
    if (transition === TeslaAuthTransitionKind.Rejected) {
      presentationState = TeslaAuthPresentationState.Rejected
      return
    }
    navigate('/plain/success')
  }
</script>

<svelte:head><title>Tesla Auth - Sign In</title></svelte:head>

<header>
  <a
    href="https://www.tesla.com/"
    aria-label="Tesla home"
    onclick={recordAuxiliary}>Tesla</a
  >
</header>
<main>
  <p data-testid="mock-auth-scenario">
    {passwordStage ? 'tesla-password-second' : 'tesla-email-first'}
  </p>
  {#if presentationState === TeslaAuthPresentationState.Rejected}
    <p role="alert">Authentication was not completed.</p>
  {/if}

  <form
    data-testid="tesla-auth-form"
    onsubmit={passwordStage ? activateSignIn : activateNext}
  >
    <div class="tds-form-layout">
      <div class="_formHeader_hykg1_1"><h1>Sign In</h1></div>
      {#if !passwordStage}
        <div class="tds-form-item">
          <div class="tds-form-label">
            <label class="tds-form-label-text" for="identity">Email</label>
            <div
              class="tds-form-label-tooltip tds-text--regular"
              tabindex="0"
              role="button"
              aria-label="If your account is linked to an email you no longer have access to, sign in to your account and update your email under account settings"
              onclick={recordAuxiliary}
              onkeydown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                auxiliaryActivationCount += 1
              }}
            ></div>
          </div>
          <div class="tds-form-input tds-form-input--default">
            <input
              class="tds-form-input-text"
              id="identity"
              name="identity"
              autocomplete="email webauthn"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              dir="ltr"
              data-sentry-block="true"
              style="text-align: left"
              bind:value={email}
            />
          </div>
        </div>
      {:else}
        <div style="max-width: 100%; width: 100%;">
          <div
            style="display: flex; justify-content: space-between; width: 100%;"
          >
            <div data-visual-mask="true">{email}</div>
            <div>
              <button type="button" class="tds-link" onclick={recordAuxiliary}
                >Change</button
              >
            </div>
          </div>
        </div>
        <div class="tds-form-item">
          <label class="tds-form-label" for="password">Password</label>
          <div class="tds-form-input tds-form-input--default">
            <input
              class="tds-form-input-text"
              id="password"
              dir="ltr"
              autocomplete="current-password"
              autocapitalize="none"
              data-sentry-block="true"
              type="password"
              name="password"
              style="text-align: left"
              bind:value={password}
            />
            <div class="tds-form-input-trailing">
              <button
                aria-label="Show"
                class="tds-icon-btn"
                type="button"
                onclick={recordAuxiliary}
              ></button>
            </div>
          </div>
        </div>
      {/if}
      <div class="tds-btn_group tds-btn_group--vertical">
        {#if !passwordStage}
          <button
            class="tds-btn tds-btn--width-full"
            type="submit"
            disabled={email.trim().length === 0}
            aria-label="Next">Next</button
          >
        {:else}
          <button
            class="tds-btn"
            type="submit"
            disabled={password.length === 0}
            aria-label="Sign In">Sign In</button
          >
        {/if}
        <button
          class="tds-btn tds-btn--tertiary tds-btn--width-full"
          type="button"
          aria-label="Cancel"
          onclick={recordAuxiliary}>Cancel</button
        >
      </div>
    </div>
  </form>

  {#if !passwordStage}
    <a
      href="https://tesla.com/support/troubleshoot-account?redirect=no"
      target="_blank"
      rel="noopener noreferrer"
      onclick={recordAuxiliary}>Trouble Signing In?</a
    >
  {:else}
    <a
      class="tds-link"
      href="/user/password/forgot?client_id=accounts"
      onclick={recordAuxiliary}>Forgot password?</a
    >
  {/if}
  <button type="button" onclick={recordAuxiliary}>Select Language</button>
</main>
<footer>
  <a href="/privacy" onclick={recordAuxiliary}>Privacy</a>
  <a href="/contact" onclick={recordAuxiliary}>Contact</a>
</footer>
