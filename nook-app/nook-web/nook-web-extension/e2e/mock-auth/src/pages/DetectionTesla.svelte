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
  let primaryActivation = $state(TeslaAuthPrimaryActivationState.Untouched)
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
    primaryActivation =
      TeslaAuthMockScenario.nextPrimaryActivation(primaryActivation)
    const submittedControl = TeslaAuthMockScenario.submittedControl(
      control.innerText,
    )
    const transition = TeslaAuthMockScenario.transition({
      email,
      submittedControl,
      primaryActivation,
      auxiliaryActivationCount,
    })
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        submittedControl,
        emailMatch: TeslaAuthMockScenario.emailMatch(email),
        primaryActivation,
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
  <h1>Sign In</h1>
  <p data-testid="mock-auth-scenario">tesla-email-first</p>
  {#if presentationState === TeslaAuthPresentationState.Rejected}
    <p role="alert">Authentication was not completed.</p>
  {/if}

  <form data-testid="tesla-auth-form" onsubmit={activateNext}>
    <label
      >Email<input
        name="identity"
        autocomplete="email webauthn"
        aria-label="Email"
        bind:value={email}
      /></label
    >
    <button type="submit" disabled={email.trim().length === 0}>Next</button>
  </form>

  <a href="/forgot" onclick={recordAuxiliary}>Trouble Signing In?</a>
  <p>Or</p>
  <button type="button" onclick={recordAuxiliary}>Create Account</button>
  <button type="button" onclick={recordAuxiliary}>Select Language</button>
</main>
<footer>
  <a href="/privacy" onclick={recordAuxiliary}>Privacy</a>
  <a href="/contact" onclick={recordAuxiliary}>Contact</a>
</footer>
